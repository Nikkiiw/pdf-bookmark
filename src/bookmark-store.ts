import { type TFile } from 'obsidian';
import type PdfBookmarkPlugin from '../main';
import { parseBookmarksFromData } from './pdf-parser';
import type { BookmarkNode, LinkMapping } from './types';

/**
 * Manages persistent storage and caching of PDF bookmark data.
 *
 * Bookmarks are cached in plugin data keyed by PDF vault path.
 * When a PDF's mtime changes, the cache is invalidated and re-parsed.
 * Link mappings are stored for use during link-update operations.
 */
export class BookmarkStore {
  private plugin: PdfBookmarkPlugin;

  constructor(plugin: PdfBookmarkPlugin) {
    this.plugin = plugin;
  }

  /**
   * Get bookmarks for a PDF file. Uses cached data if the file hasn't changed
   * since the last parse, otherwise re-parses.
   */
  async getBookmarks(pdfFile: TFile): Promise<BookmarkNode[]> {
    const data = this.plugin.data;
    const pdfPath = pdfFile.path;
    const cached = data.pdfBookmarks[pdfPath];

    // Use Vault.getAbstractFileByPath for lookup (rule 21)
    const currentMtime = pdfFile.stat.mtime;

    if (cached && cached.lastModified === currentMtime) {
      return cached.bookmarks;
    }

    // Always read PDF as binary via Obsidian API — avoids cross-platform
    // file-path issues (Electron file:// URLs, mobile sandboxing, etc.).
    const pdfData = await this.plugin.app.vault.adapter.readBinary(pdfFile.path);
    const bookmarks = await parseBookmarksFromData(pdfData);

    // Update cache
    data.pdfBookmarks[pdfPath] = {
      lastModified: currentMtime,
      bookmarks,
    };
    await this.plugin.saveData(data);

    return bookmarks;
  }

  /**
   * Force re-parse a PDF and update the cache.
   */
  async refreshBookmarks(pdfFile: TFile): Promise<BookmarkNode[]> {
    const data = this.plugin.data;
    const pdfPath = pdfFile.path;
    // Remove cached entry so getBookmarks does a fresh parse
    delete data.pdfBookmarks[pdfPath];
    await this.plugin.saveData(data);
    return this.getBookmarks(pdfFile);
  }

  /**
   * Remove cached bookmark data for a PDF.
   */
  async invalidate(pdfPath: string): Promise<void> {
    const data = this.plugin.data;
    delete data.pdfBookmarks[pdfPath];
    await this.plugin.saveData(data);
  }

  /**
   * Store a link mapping for future remapping.
   */
  async saveLinkMapping(mapping: LinkMapping): Promise<void> {
    const data = this.plugin.data;
    // Avoid duplicate mappings for the same link position
    data.linkMappings = data.linkMappings.filter(
      (m) =>
        !(
          m.notePath === mapping.notePath &&
          m.pdfPath === mapping.pdfPath &&
          m.bookmarkPath.join('/') === mapping.bookmarkPath.join('/')
        ),
    );
    data.linkMappings.push(mapping);
    await this.plugin.saveData(data);
  }

  /**
   * Get all link mappings for a specific PDF file.
   */
  getLinkMappingsForPdf(pdfPath: string): LinkMapping[] {
    return this.plugin.data.linkMappings.filter(
      (m) => m.pdfPath === pdfPath,
    );
  }

  /**
   * Get all stored link mappings.
   */
  getAllLinkMappings(): LinkMapping[] {
    return this.plugin.data.linkMappings;
  }

  /**
   * Remove mappings that reference a specific note (when a note is deleted).
   */
  async removeMappingsForNote(notePath: string): Promise<void> {
    const data = this.plugin.data;
    data.linkMappings = data.linkMappings.filter(
      (m) => m.notePath !== notePath,
    );
    await this.plugin.saveData(data);
  }

  /**
   * Clear all link mappings across all notes.
   */
  async clearAllMappings(): Promise<void> {
    const data = this.plugin.data;
    data.linkMappings = [];
    await this.plugin.saveData(data);
  }
}
