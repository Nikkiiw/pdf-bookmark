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
 * CSS selectors for identifying PDF outline panel items in Obsidian's DOM.
 *
 * Obsidian's PDF viewer (based on pdfjs-dist v3.x) renders outline items
 * with class names that may include "outlineItem", "treeItem", etc.
 * These selectors are tried in order; the first match wins.
 *
 * If Obsidian updates its PDF viewer and breaks these selectors, inspect the
 * DOM with DevTools and update the arrays below.
 */
const OUTLINE_ITEM_SELECTORS = [
  '.outlineItem',
  '.outline-item',
  '.tree-item',
  'li[role="treeitem"]',
  '[role="treeitem"]',
];

const OUTLINE_PANEL_SELECTORS = [
  '.outlineView',
  '.outline-view',
  '#outlineView',
  '[class*="outline"]',
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

  /**
   * Install the contextmenu listener on the main window and all popout windows.
   * Cleanup is automatic via registerDomEvent/registerEvent.
   */
  install(): void {
    const handler = (evt: MouseEvent) => this.onContextMenu(evt);

    // Use capture phase so our handler fires before Obsidian's internal
    // handlers on child elements — otherwise we can't prevent the native menu.
    this.plugin.registerDomEvent(activeDocument, 'contextmenu', handler, true);

    // Popout windows
    this.plugin.registerEvent(
      this.plugin.app.workspace.on('window-open', (_win, win) => {
        this.plugin.registerDomEvent(win.document, 'contextmenu', handler, true);
      }),
    );
  }

  /**
   * Main contextmenu event handler.
   */
  private async onContextMenu(evt: MouseEvent): Promise<void> {
    if (evt.defaultPrevented) return;

    const target = evt.target as HTMLElement;
    if (!target) return;

    // Find the PDF leaf and outline element
    const ctx = this.findPdfOutlineContext(target);
    if (!ctx) return;

    evt.preventDefault();
    evt.stopPropagation();

    const { file, outlineEl } = ctx;
    const title = this.extractOutlineTitle(outlineEl);

    if (!title) return;

    // Look up the bookmark
    let node: BookmarkNode | null = null;
    try {
      const bookmarks = await this.plugin.store.getBookmarks(file);
      node = this.plugin.linkManager.findBookmarkByTitle(bookmarks, title);
    } catch {
      // getBookmarks may throw if PDF is corrupted
    }

    const link = node
      ? this.buildLink(node, file)
      : `[${title}](${file.path})`;

    this.showMenu(evt, node, title, link, file);
  }

  /**
   * Find the PDF leaf and the outline item element from a DOM target.
   */
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
   * Walk up the DOM tree to find an outline item element.
   */
  private findOutlineItemElement(target: HTMLElement): HTMLElement | null {
    let el: HTMLElement | null = target;

    while (el && el !== el.ownerDocument.body) {
      if (OUTLINE_ITEM_SELECTORS.some((sel) => el!.matches?.(sel))) {
        return el;
      }
      // Broader fallback: any element with text inside a known outline panel
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
   * Extract the bookmark title text from an outline item DOM element.
   */
  private extractOutlineTitle(outlineEl: HTMLElement): string | null {
    // Try dedicated title child elements first
    const titleCandidates = [
      outlineEl.querySelector('.outlineItemTitle'),
      outlineEl.querySelector('.outline-item-title'),
      outlineEl.querySelector('[class*="title"]'),
      outlineEl.querySelector('span'),
    ];

    for (const candidate of titleCandidates) {
      const text = candidate?.textContent?.trim();
      if (text) return text;
    }

    // Fallback: use the element's own text, stripping trailing page numbers
    let text = outlineEl.textContent?.trim() || '';
    if (!text) return null;

    text = text.replace(/\s*\(p\.?\s*\d+\)\s*$/, '').trim();

    return text || null;
  }

  /**
   * Build a markdown link string using the plugin's full hierarchical path format.
   */
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

  /**
   * Show the custom context menu at the mouse position.
   */
  private showMenu(
    evt: MouseEvent,
    node: BookmarkNode | null,
    title: string,
    link: string,
    pdfFile: TFile,
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

    // Open PDF at bookmark page (only if we have a matched node)
    if (node) {
      menu.addItem((item) =>
        item
          .setTitle('Open in PDF')
          .setIcon('file-text')
          .onClick(() => {
            this.plugin.app.workspace.openLinkText(
              `${pdfFile.path}#page=${node.page}`,
              '',
              false,
            );
          }),
      );
    }

    menu.showAtMouseEvent(evt);
  }
}
