import {
  MarkdownView,
  Menu,
  Notice,
  TFile,
  WorkspaceLeaf,
} from 'obsidian';
import type PdfBookmarkPlugin from '../main';
import type { BookmarkNode } from './types';
import { getRelativePath } from './path-utils';

/**
 * Each selector identifies exactly one outline item per DOM level.
 * Obsidian's tree structure: .tree-item > .tree-item-self > .tree-item-inner
 * plus .tree-item > .tree-item-children > .tree-item (recursive).
 */
const OUTLINE_ITEM_SELECTORS = [
  '.tree-item',
  '.outlineItem',
  '.outline-item',
  'li[role="treeitem"]',
  '[role="treeitem"]',
];

const OUTLINE_PANEL_SELECTORS = [
  '.pdf-outline-view',
  '.outlineView',
  '.outline-view',
  '#outlineView',
];

/**
 * Intercepts right-click on Obsidian's built-in PDF viewer outline panel
 * and replaces the default context menu with the plugin's own copy function
 * that uses the full hierarchical bookmark path.
 */
export class PdfContextMenuHandler {
  private plugin: PdfBookmarkPlugin;

  constructor(plugin: PdfBookmarkPlugin) {
    this.plugin = plugin;
  }

  install(): void {
    const handler = (evt: MouseEvent) => this.onContextMenu(evt);

    this.plugin.registerDomEvent(activeDocument, 'contextmenu', handler, true);

    this.plugin.registerEvent(
      this.plugin.app.workspace.on('window-open', (_win, win) => {
        this.plugin.registerDomEvent(win.document, 'contextmenu', handler, true);
      }),
    );
  }

  private async onContextMenu(evt: MouseEvent): Promise<void> {
    if (evt.defaultPrevented) return;

    const target = evt.target as HTMLElement;
    if (!target) return;

    const ctx = this.findPdfOutlineContext(target);
    if (!ctx) return;

    evt.preventDefault();
    evt.stopPropagation();

    const { file, outlineEl } = ctx;
    const title = this.extractOutlineTitle(outlineEl);

    if (!title) return;

    let node: BookmarkNode | null = null;
    try {
      const bookmarks = await this.plugin.store.getBookmarks(file);
      node = this.plugin.linkManager.findBookmarkByTitle(bookmarks, title);

      if (node) {
        const allMatches = this.findAllBookmarksByTitle(bookmarks, title);
        if (allMatches.length > 1) {
          const domPath = this.extractOutlinePath(outlineEl);
          if (domPath.length > 0) {
            const exact = this.plugin.linkManager.findBookmarkByPath(
              bookmarks,
              domPath,
            );
            if (exact) node = exact;
          }
        }
      }
    } catch {
      // getBookmarks may throw if PDF is corrupted
    }

    const link = node
      ? this.buildLink(node, file)
      : `[${title}](${file.path})`;

    this.showMenu(evt, title, link);
  }

  private findPdfOutlineContext(
    target: HTMLElement,
  ): { file: TFile; outlineEl: HTMLElement } | null {
    const targetDoc = target.ownerDocument;

    let foundFile: TFile | null = null;

    this.plugin.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
      if (leaf.view.getViewType() !== 'pdf') return;
      if (leaf.view.containerEl.ownerDocument !== targetDoc) return;
      if (leaf.view.containerEl.contains(target)) {
        const f = (leaf.view as { file?: TFile }).file;
        if (f instanceof TFile) foundFile = f;
      }
    });

    if (!foundFile) return null;

    const outlineEl = this.findOutlineItemElement(target);
    if (!outlineEl) return null;

    return { file: foundFile, outlineEl };
  }

  /**
   * Walk up from the target to the nearest .tree-item, which represents
   * exactly one outline level in Obsidian's DOM.
   */
  private findOutlineItemElement(target: HTMLElement): HTMLElement | null {
    let el: HTMLElement | null = target;

    while (el && el !== el.ownerDocument.body) {
      if (OUTLINE_ITEM_SELECTORS.some((sel) => el!.matches?.(sel))) {
        return el;
      }
      // Broad fallback: any element with text inside a known outline panel
      if (
        el.textContent?.trim() &&
        OUTLINE_PANEL_SELECTORS.some((sel) => el!.closest?.(sel))
      ) {
        return el;
      }
      el = el.parentElement;
    }

    return null;
  }

  /**
   * Extract an outline item's own title text.
   *
   * For .tree-item elements the title lives inside
   * .tree-item-self > .tree-item-inner, so we include a deep fallback
   * constrained to :scope > .tree-item-self to avoid picking up children's
   * titles that live inside .tree-item-children.
   */
  private extractOutlineTitle(outlineEl: HTMLElement): string | null {
    // Direct child title elements
    const titleEl =
      outlineEl.querySelector(':scope > .outlineItemTitle') ??
      outlineEl.querySelector(':scope > .outline-item-title') ??
      outlineEl.querySelector(':scope > [class*="title"]') ??
      outlineEl.querySelector(':scope > span');

    if (titleEl) {
      const text = titleEl.textContent?.trim();
      if (text) return text;
    }

    // Deep fallback for Obsidian's .tree-item > .tree-item-self > .tree-item-inner
    const inner =
      outlineEl.querySelector(':scope > .tree-item-self .tree-item-inner');
    if (inner) {
      const text = inner.textContent?.trim();
      if (text) return text;
    }

    // Direct text nodes only (not descendant element text)
    let text = '';
    for (const child of Array.from(outlineEl.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent || '';
      }
    }
    text = text.trim();
    if (!text) return null;

    text = text.replace(/\s*\(p\.?\s*\d+\)\s*$/, '').trim();

    return text || null;
  }

  /**
   * Reconstruct the full hierarchical path by walking up via parentElement.
   * Each .tree-item is one outline level; .tree-item-children wrappers and
   * .tree-item-self/.tree-item-inner inner elements are skipped.
   */
  private extractOutlinePath(outlineEl: HTMLElement): string[] {
    const path: string[] = [];
    let el: HTMLElement | null = outlineEl;

    while (el && el !== el.ownerDocument.body) {
      if (OUTLINE_PANEL_SELECTORS.some((s) => el!.matches?.(s))) break;

      if (OUTLINE_ITEM_SELECTORS.some((s) => el!.matches?.(s))) {
        const title = this.extractOutlineTitle(el);
        if (title) {
          path.unshift(title);
        }
      }

      el = el.parentElement;
    }

    return path;
  }

  private findAllBookmarksByTitle(
    bookmarks: BookmarkNode[],
    title: string,
  ): BookmarkNode[] {
    const results: BookmarkNode[] = [];
    const normalized = title.trim().toLowerCase();

    const search = (nodes: BookmarkNode[]) => {
      for (const node of nodes) {
        if (node.title.trim().toLowerCase() === normalized) {
          results.push(node);
        }
        if (node.children.length > 0) {
          search(node.children);
        }
      }
    };

    search(bookmarks);
    return results;
  }

  private buildLink(node: BookmarkNode, pdfFile: TFile): string {
    const pdfPath = pdfFile.path;
    const activeView =
      this.plugin.app.workspace.getActiveViewOfType(MarkdownView);

    let linkPath: string;
    if (activeView?.file) {
      linkPath = getRelativePath(activeView.file.path, pdfPath);
    } else {
      linkPath = pdfPath;
    }

    const fullTitle = node.path.join(' > ');
    const linkText = this.plugin.settings.showPageNumbers
      ? `${fullTitle} (p. ${node.page})`
      : fullTitle;

    return `[${linkText}](${linkPath}#page=${node.page})`;
  }

  private showMenu(
    evt: MouseEvent,
    title: string,
    link: string,
  ): void {
    const menu = new Menu();

    menu.addItem((item) =>
      item
        .setTitle('Copy bookmark link')
        .setIcon('link')
        .onClick(async () => {
          try {
            await navigator.clipboard.writeText(link);
            new Notice(`Copied: ${title}`);
          } catch {
            new Notice('Failed to copy to clipboard.');
          }
        }),
    );

    menu.showAtMouseEvent(evt);
  }
}
