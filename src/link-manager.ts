import { Notice, TFile, normalizePath } from 'obsidian';
import type PdfBookmarkPlugin from '../main';
import type { BookmarkNode, LinkMapping } from './types';

/**
 * Regex to match PDF links in notes.
 * Matches: [link text](path/to/file.pdf#page=N)
 * Groups: $1 = link text, $2 = PDF path, $3 = page number
 *
 * No regex lookbehind — safe for iOS < 16.4.
 */
const PDF_LINK_RE =
  /\[([^\]]*)\]\(([^)]*\.pdf)#page=(\d+)\)/gi;

/**
 * Result of scanning a note for PDF bookmark links.
 */
interface PdfLinkMatch {
  /** Full matched string, e.g. [Title](file.pdf#page=5) */
  fullMatch: string;
  /** The link text, e.g. "Title" */
  linkText: string;
  /** The PDF vault path, e.g. "notes/file.pdf" */
  pdfPath: string;
  /** The current page number in the link */
  page: number;
  /** Index in the note content where the match starts */
  index: number;
}

/**
 * Result of a link update operation.
 */
export interface UpdateResult {
  /** Number of links updated */
  updated: number;
  /** Number of links that couldn't be remapped */
  failed: number;
  /** List of note paths that were modified */
  modifiedNotes: string[];
}

/**
 * Manages creating, scanning, and updating PDF bookmark links in notes.
 */
export class LinkManager {
  private plugin: PdfBookmarkPlugin;

  constructor(plugin: PdfBookmarkPlugin) {
    this.plugin = plugin;
  }

  /**
   * Insert a PDF bookmark link at the current cursor position.
   * Called from BookmarkView when a user clicks a bookmark.
   *
   * Example output: [Introduction](notes/doc.pdf#page=3)
   */
  insertLink(editor: { replaceSelection: (text: string) => void }, pdfPath: string, node: BookmarkNode): void {
    const linkText = this.plugin.settings.showPageNumbers
      ? `${node.title} (p. ${node.page})`
      : node.title;

    const link = `[${linkText}](${pdfPath}#page=${node.page})`;
    editor.replaceSelection(link);
  }

  /**
   * Scan a single note's content for PDF bookmark links.
   */
  scanNoteContent(content: string): PdfLinkMatch[] {
    const matches: PdfLinkMatch[] = [];
    let match: RegExpExecArray | null;

    // Reset lastIndex for fresh scan
    PDF_LINK_RE.lastIndex = 0;

    while ((match = PDF_LINK_RE.exec(content)) !== null) {
      matches.push({
        fullMatch: match[0],
        linkText: match[1],
        pdfPath: match[2],
        page: parseInt(match[3], 10),
        index: match.index,
      });
    }

    return matches;
  }

  /**
   * Scan all markdown files in the vault for PDF bookmark links.
   * Returns matches grouped by PDF path.
   */
  async scanAllNotes(): Promise<Map<string, { note: TFile; matches: PdfLinkMatch[] }[]>> {
    const byPdf = new Map<string, { note: TFile; matches: PdfLinkMatch[] }[]>();
    const mdFiles = this.plugin.app.vault.getMarkdownFiles();

    for (const file of mdFiles) {
      const content = await this.plugin.app.vault.read(file);
      const matches = this.scanNoteContent(content);

      for (const match of matches) {
        // Normalize the path to handle relative vs absolute references
        const resolvedPdfPath = this.resolvePdfPath(match.pdfPath, file.path);

        if (!resolvedPdfPath) continue;

        match.pdfPath = resolvedPdfPath;

        let entries = byPdf.get(resolvedPdfPath);
        if (!entries) {
          entries = [];
          byPdf.set(resolvedPdfPath, entries);
        }

        // Avoid duplicate note entries
        let noteEntry = entries.find((e) => e.note.path === file.path);
        if (!noteEntry) {
          noteEntry = { note: file, matches: [] };
          entries.push(noteEntry);
        }
        noteEntry.matches.push(match);
      }
    }

    return byPdf;
  }

  /**
   * Resolve a PDF link path relative to a note's location to a vault-relative path.
   * Uses Vault.getAbstractFileByPath for lookup (rule 21).
   */
  private resolvePdfPath(pdfLinkPath: string, notePath: string): string | null {
    // If the path is already vault-absolute, use it directly
    const absFile = this.plugin.app.vault.getAbstractFileByPath(pdfLinkPath);
    if (absFile instanceof TFile && absFile.extension === 'pdf') {
      return absFile.path;
    }

    // Try resolving relative to the note's directory
    const noteDir = notePath.substring(0, notePath.lastIndexOf('/') + 1);
    const resolved = normalizePath(noteDir + pdfLinkPath);
    const resolvedFile = this.plugin.app.vault.getAbstractFileByPath(resolved);
    if (resolvedFile instanceof TFile && resolvedFile.extension === 'pdf') {
      return resolvedFile.path;
    }

    return null;
  }

  /**
   * Find a bookmark node by its full path array.
   */
  findBookmarkByPath(bookmarks: BookmarkNode[], path: string[]): BookmarkNode | null {
    if (path.length === 0 || bookmarks.length === 0) return null;

    for (const node of bookmarks) {
      if (node.path.join('/') === path.join('/')) {
        return node;
      }
      if (node.children.length > 0) {
        const found = this.findBookmarkByPath(node.children, path);
        if (found) return found;
      }
    }

    return null;
  }

  /**
   * Find a bookmark node by title in the tree (depth-first, case-insensitive).
   */
  findBookmarkByTitle(bookmarks: BookmarkNode[], title: string): BookmarkNode | null {
    const normalizedTitle = title.trim().toLowerCase();

    for (const node of bookmarks) {
      if (node.title.trim().toLowerCase() === normalizedTitle) {
        return node;
      }
      if (node.children.length > 0) {
        const found = this.findBookmarkByTitle(node.children, title);
        if (found) return found;
      }
    }

    return null;
  }

  /**
   * Update all PDF bookmark links in the vault.
   *
   * For each linked PDF:
   *  1. Re-parse bookmarks from the updated PDF
   *  2. Match each existing link to a bookmark (by stored mapping or title)
   *  3. Update the page number in the note
   *
   * Uses Vault.process() for atomic background modifications (rule 19).
   */
  async updateAllLinks(): Promise<UpdateResult> {
    const result: UpdateResult = {
      updated: 0,
      failed: 0,
      modifiedNotes: [],
    };

    const byPdf = await this.scanAllNotes();

    if (byPdf.size === 0) {
      new Notice('No PDF bookmark links found in the vault.');
      return result;
    }

    const mappings = this.plugin.store.getAllLinkMappings();

    // Collect notes that need modification, grouped by note path
    const noteModifications = new Map<string, Map<number, { old: string; newPage: number }>>();

    for (const [pdfPath, noteEntries] of byPdf) {
      // Re-parse the PDF
      const pdfFile = this.plugin.app.vault.getAbstractFileByPath(pdfPath);
      if (!(pdfFile instanceof TFile)) {
        result.failed += noteEntries.reduce((sum, e) => sum + e.matches.length, 0);
        continue;
      }

      let bookmarks: BookmarkNode[];
      try {
        bookmarks = await this.plugin.store.refreshBookmarks(pdfFile);
      } catch {
        result.failed += noteEntries.reduce((sum, e) => sum + e.matches.length, 0);
        continue;
      }

      for (const { note, matches } of noteEntries) {
        for (const match of matches) {
          let newPage: number | null = null;

          // Strategy 1: Use stored link mapping
          const storedMapping = mappings.find(
            (m) =>
              m.notePath === note.path &&
              m.pdfPath === pdfPath &&
              m.page === match.page,
          );

          if (storedMapping) {
            const found = this.findBookmarkByPath(bookmarks, storedMapping.bookmarkPath);
            if (found) {
              newPage = found.page;
            }
          }

          // Strategy 2: Match by link text (title search)
          if (newPage === null) {
            const found = this.findBookmarkByTitle(bookmarks, match.linkText);
            if (found) {
              newPage = found.page;
            }
          }

          if (newPage !== null && newPage !== match.page) {
            // Queue the modification
            let mods = noteModifications.get(note.path);
            if (!mods) {
              mods = new Map();
              noteModifications.set(note.path, mods);
            }
            mods.set(match.index, { old: match.fullMatch, newPage });
          } else if (newPage === null) {
            result.failed++;
          }
        }
      }
    }

    // Apply modifications using Vault.process() for atomicity
    for (const [notePath, mods] of noteModifications) {
      const noteFile = this.plugin.app.vault.getAbstractFileByPath(notePath);
      if (!(noteFile instanceof TFile)) continue;

      await this.plugin.app.vault.process(noteFile, (content) => {
        // We need to apply modifications from end to start to preserve indices.
        // Since Vault.process gives us the raw content, we'll re-scan and replace.
        // Sort by index descending so replacements don't shift indices.
        const sortedMods = Array.from(mods.entries()).sort(
          (a, b) => b[0] - a[0],
        );

        let modified = content;
        let totalUpdated = 0;

        for (const [index, { old: oldMatch, newPage }] of sortedMods) {
          // Verify the content at this position still matches
          const actual = modified.substring(index, index + oldMatch.length);
          const scannedLinks = this.scanNoteContent(actual);
          if (scannedLinks.length === 1 && scannedLinks[0].index === 0) {
            const currentPage = scannedLinks[0].page;
            if (currentPage !== newPage) {
              const newLink = oldMatch.replace(
                /#page=\d+/,
                `#page=${newPage}`,
              );
              modified =
                modified.substring(0, index) +
                newLink +
                modified.substring(index + oldMatch.length);
              totalUpdated++;
            }
          }
        }

        if (totalUpdated > 0) {
          result.updated += totalUpdated;
          result.modifiedNotes.push(notePath);
        }

        return modified;
      });

      // Update stored mappings with new page numbers
      for (const [, { old: oldMatch, newPage }] of mods) {
        const scannedLinks = this.scanNoteContent(oldMatch);
        if (scannedLinks.length === 1) {
          const oldPage = scannedLinks[0].page;
          const mapping = mappings.find(
            (m) =>
              m.notePath === notePath &&
              m.pdfPath === scannedLinks[0].pdfPath &&
              m.page === oldPage,
          );
          if (mapping) {
            mapping.page = newPage;
            await this.plugin.store.saveLinkMapping(mapping);
          }
        }
      }
    }

    // Report results
    if (result.updated > 0) {
      new Notice(
        `Updated ${result.updated} link${result.updated > 1 ? 's' : ''} across ${result.modifiedNotes.length} note${result.modifiedNotes.length > 1 ? 's' : ''}.`,
      );
      if (result.failed > 0) {
        new Notice(
          `${result.failed} link${result.failed > 1 ? 's' : ''} could not be remapped.`,
        );
      }
    } else if (result.failed > 0) {
      new Notice(
        `No links were updated. ${result.failed} link${result.failed > 1 ? 's' : ''} could not be remapped.`,
      );
    } else {
      new Notice('All PDF bookmark links are up to date.');
    }

    return result;
  }

  /**
   * Update links for a specific PDF file only.
   */
  async updateLinksForPdf(pdfPath: string): Promise<UpdateResult> {
    const result: UpdateResult = {
      updated: 0,
      failed: 0,
      modifiedNotes: [],
    };

    const pdfFile = this.plugin.app.vault.getAbstractFileByPath(pdfPath);
    if (!(pdfFile instanceof TFile)) {
      new Notice(`PDF file not found: ${pdfPath}`);
      return result;
    }

    let bookmarks: BookmarkNode[];
    try {
      bookmarks = await this.plugin.store.refreshBookmarks(pdfFile);
    } catch {
      new Notice(`Failed to parse bookmarks from ${pdfFile.name}.`);
      return result;
    }

    const mappings = this.plugin.store.getLinkMappingsForPdf(pdfPath);

    for (const mapping of mappings) {
      const noteFile = this.plugin.app.vault.getAbstractFileByPath(mapping.notePath);
      if (!(noteFile instanceof TFile)) {
        result.failed++;
        continue;
      }

      const found = this.findBookmarkByPath(bookmarks, mapping.bookmarkPath);
      if (!found || found.page === mapping.page) {
        if (!found) result.failed++;
        continue;
      }

      await this.plugin.app.vault.process(noteFile, (content) => {
        const oldLink = `#page=${mapping.page}`;
        const oldPattern = new RegExp(
          `\\[([^\\]]*)\\]\\(${this.escapeRegex(mapping.pdfPath)}#page=${mapping.page}\\)`,
          'gi',
        );

        return content.replace(oldPattern, (fullMatch, linkText) => {
          const newLink = `[${linkText}](${mapping.pdfPath}#page=${found!.page})`;
          return newLink;
        });
      });

      // Update stored mapping
      mapping.page = found.page;
      await this.plugin.store.saveLinkMapping(mapping);

      result.updated++;
      if (!result.modifiedNotes.includes(mapping.notePath)) {
        result.modifiedNotes.push(mapping.notePath);
      }
    }

    if (result.updated > 0) {
      new Notice(
        `Updated ${result.updated} link${result.updated > 1 ? 's' : ''} to ${pdfFile.name}.`,
      );
    } else {
      new Notice(`No links needed updating for ${pdfFile.name}.`);
    }

    return result;
  }

  /**
   * Escape special regex characters in a string.
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
