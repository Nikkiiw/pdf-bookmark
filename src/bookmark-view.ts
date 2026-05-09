import {
  ItemView,
  MarkdownView,
  Notice,
  TFile,
  WorkspaceLeaf,
} from 'obsidian';
import type PdfBookmarkPlugin from '../main';
import type { BookmarkNode } from './types';
import { PdfSelectModal } from './pdf-select-modal';
import { clearAndRenderBookmarkTree } from './bookmark-tree';
import { getRelativePath } from './path-utils';

export const VIEW_TYPE_PDF_BOOKMARK = 'pdf-bookmark-view';

/**
 * Sidebar ItemView that lets the user:
 *  1. Select a PDF file from the vault
 *  2. Browse its bookmark outline in a collapsible tree
 *  3. Click a bookmark to insert a link at the cursor in the active editor
 */
export class BookmarkView extends ItemView {
  private plugin: PdfBookmarkPlugin;
  private currentPdfFile: TFile | null = null;
  private treeContainer: HTMLElement | null = null;
  private headerEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PdfBookmarkPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_PDF_BOOKMARK;
  }

  getDisplayText(): string {
    return 'PDF bookmarks';
  }

  getIcon(): string {
    return 'bookmark';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('pdf-bookmark-view');

    // Header: PDF selector area
    this.headerEl = container.createDiv({
      cls: 'pdf-bookmark-header',
    });

    this.renderEmptyState();

    // Tree container (populated when a PDF is selected)
    this.treeContainer = container.createDiv({
      cls: 'pdf-bookmark-tree-container',
    });
  }

  async onClose(): Promise<void> {
    // Obsidian handles cleanup. No manual detach needed (rule 8).
  }

  /**
   * Show the initial empty state with a "Select PDF" button.
   */
  private renderEmptyState(): void {
    if (!this.headerEl) return;

    this.headerEl.empty();

    const button = this.headerEl.createEl('button', {
      cls: 'pdf-bookmark-select-btn',
      text: 'Select PDF',
      attr: {
        'aria-label': 'Select a PDF file from the vault',
      },
    });

    button.addEventListener('click', () => {
      new PdfSelectModal(this.app, (file) => this.loadPdf(file)).open();
    });

    button.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        button.click();
      }
    });

    if (this.treeContainer) {
      this.treeContainer.empty();
      this.treeContainer.createDiv({
        cls: 'pdf-bookmark-tree-empty',
        text: 'Select a PDF to browse its bookmarks.',
      });
    }
  }

  /**
   * Load and display bookmarks for the selected PDF.
   */
  async loadPdf(file: TFile): Promise<void> {
    this.currentPdfFile = file;

    // Update header to show current PDF + change button
    if (this.headerEl) {
      this.headerEl.empty();

      const info = this.headerEl.createDiv({
        cls: 'pdf-bookmark-header-info',
      });

      info.createSpan({
        cls: 'pdf-bookmark-header-name',
        text: file.name,
        attr: { 'aria-label': `Current PDF: ${file.name}` },
      });

      const changeBtn = info.createEl('button', {
        cls: 'pdf-bookmark-change-btn',
        text: 'Change',
        attr: {
          'aria-label': 'Select a different PDF file',
          'data-tooltip-position': 'top',
        },
      });

      changeBtn.addEventListener('click', () => {
        new PdfSelectModal(this.app, (f) => this.loadPdf(f)).open();
      });

      changeBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          changeBtn.click();
        }
      });

      const refreshBtn = this.headerEl.createEl('button', {
        cls: 'pdf-bookmark-refresh-btn',
        text: 'Refresh',
        attr: {
          'aria-label': 'Re-parse bookmarks from the current PDF',
          'data-tooltip-position': 'top',
        },
      });

      refreshBtn.addEventListener('click', async () => {
        await this.plugin.store.refreshBookmarks(file);
        await this.renderBookmarks();
      });

      refreshBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          refreshBtn.click();
        }
      });
    }

    await this.renderBookmarks();
  }

  /**
   * Fetch and render the bookmark tree for the current PDF.
   */
  async renderBookmarks(): Promise<void> {
    if (!this.currentPdfFile || !this.treeContainer) return;

    let bookmarks: BookmarkNode[];

    try {
      bookmarks = await this.plugin.store.getBookmarks(this.currentPdfFile);
    } catch {
      this.treeContainer.empty();
      this.treeContainer.createDiv({
        cls: 'pdf-bookmark-tree-error',
        text: 'Failed to load bookmarks. The file may be corrupted or not a valid PDF.',
      });
      return;
    }

    clearAndRenderBookmarkTree(
      this.treeContainer,
      bookmarks,
      (node: BookmarkNode) => this.onBookmarkSelected(node),
      (node: BookmarkNode) => this.onBookmarkCopy(node),
      this.currentPdfFile.path,
    );
  }

  /**
   * Build the markdown link string for a bookmark.
   * Uses the first open Markdown note to compute a relative path.
   * Falls back to vault-absolute path if no note is open.
   */
  private buildLink(node: BookmarkNode): string {
    const pdfPath = this.currentPdfFile!.path;
    const activeView =
      this.app.workspace.getActiveViewOfType(MarkdownView);

    let linkPath: string;
    if (activeView?.file) {
      linkPath = getRelativePath(activeView.file.path, pdfPath);
    } else {
      linkPath = pdfPath;
    }

    // Build the full hierarchical path as link text: "Ch1 > §1.1 > Para A"
    const fullTitle = node.path.join(' > ');
    const linkText = this.plugin.settings.showPageNumbers
      ? `${fullTitle} (p. ${node.page})`
      : fullTitle;

    return `[${linkText}](${linkPath}#page=${node.page})`;
  }

  /**
   * Handle bookmark title click: open the PDF at the bookmark page.
   * If an editor is active, also insert a link at the cursor.
   */
  private async onBookmarkSelected(node: BookmarkNode): Promise<void> {
    if (!this.currentPdfFile) return;

    // Open the PDF at the bookmark page
    await this.app.workspace.openLinkText(
      `${this.currentPdfFile.path}#page=${node.page}`,
      '',
      true,
    );

    // If an editor is active, also insert a link at the cursor
    const activeView =
      this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = activeView?.editor;
    if (editor && activeView?.file) {
      const link = this.buildLink(node);
      editor.replaceSelection(link);

      await this.plugin.store.saveLinkMapping({
        notePath: activeView.file.path,
        pdfPath: this.currentPdfFile.path,
        bookmarkPath: node.path,
        page: node.page,
      });
    }
  }

  /**
   * Handle copy button click: copy the markdown link to clipboard.
   */
  private async onBookmarkCopy(node: BookmarkNode): Promise<void> {
    if (!this.currentPdfFile) return;

    const link = this.buildLink(node);
    await navigator.clipboard.writeText(link);

    new Notice(`Copied: ${node.title}`);
  }
}

