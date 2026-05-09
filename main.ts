import { Notice, parseLinktext, Plugin, TFile, Workspace, WorkspaceLeaf } from 'obsidian';
import {
  PdfBookmarkSettingTab,
} from './src/settings';
import { BookmarkStore } from './src/bookmark-store';
import { BookmarkView, VIEW_TYPE_PDF_BOOKMARK } from './src/bookmark-view';
import { PdfContextMenuHandler } from './src/pdf-context-menu';
import { LinkManager } from './src/link-manager';
import { PdfSelectModal } from './src/pdf-select-modal';
import type { PdfBookmarkPluginData, PdfBookmarkSettings } from './src/types';
import { DEFAULT_SETTINGS } from './src/types';

/**
 * PDF Bookmark Plugin
 *
 * Browse PDF bookmarks (outline/TOC), insert links into notes,
 * and automatically remap page numbers when PDFs are updated.
 */
export default class PdfBookmarkPlugin extends Plugin {
  data!: PdfBookmarkPluginData;
  settings!: PdfBookmarkSettings;
  store!: BookmarkStore;
  linkManager!: LinkManager;
  pdfContextMenu!: PdfContextMenuHandler;

  async onload(): Promise<void> {
    // Initialize plugin data with defaults
    this.data = Object.assign(
      { settings: DEFAULT_SETTINGS, pdfBookmarks: {}, linkMappings: [] },
      await this.loadData(),
    );
    this.settings = this.data.settings;

    this.store = new BookmarkStore(this);
    this.linkManager = new LinkManager(this);

    // Intercept PDF outline context menu
    this.pdfContextMenu = new PdfContextMenuHandler(this);
    this.pdfContextMenu.install();

    // Register the sidebar view
    this.registerView(
      VIEW_TYPE_PDF_BOOKMARK,
      (leaf) => new BookmarkView(leaf, this),
    );

    // Ribbon icon to open the bookmark browser
    this.addRibbonIcon(
      'bookmark',
      'Open PDF bookmark browser',
      () => this.activateView(),
    );

    // Command: open the bookmark browser sidebar
    this.addCommand({
      id: 'open-bookmark-browser',
      name: 'Open PDF bookmark browser',
      callback: () => this.activateView(),
    });

    // Command: insert a PDF bookmark link (via modal flow)
    this.addCommand({
      id: 'insert-bookmark-link',
      name: 'Insert PDF bookmark link',
      editorCallback: (_editor, _view) => {
        new PdfSelectModal(this.app, async (file) => {
          const bookmarks = await this.store.getBookmarks(file);

          if (bookmarks.length === 0) {
            new Notice('No bookmarks found in this PDF.');
            return;
          }

          // Show the bookmark browser and select the PDF
          await this.activateView();
          const leaf =
            this.app.workspace.getLeavesOfType(VIEW_TYPE_PDF_BOOKMARK)[0];
          if (leaf && leaf.view instanceof BookmarkView) {
            await leaf.view.loadPdf(file);
          }
        }).open();
      },
    });

    // Command: update all PDF bookmark links
    this.addCommand({
      id: 'update-bookmark-links',
      name: 'Update all PDF bookmark links',
      callback: () => this.linkManager.updateAllLinks(),
    });

    // Monkey-patch openLinkText so PDF links with #page=N open in a new
    // split pane — or, if the PDF is already open, just navigate that tab.
    // Ctrl/Cmd+Click still overrides (Obsidian passes newLeaf=true).
    const app = this.app;
    const origOpenLinkText = Workspace.prototype.openLinkText;

    Workspace.prototype.openLinkText = async function (
      linktext: string,
      sourcePath: string,
      newLeaf?: boolean | 'tab' | 'split' | 'window',
      openViewState?: Record<string, unknown>,
    ): Promise<void> {
      if (newLeaf || !/\.pdf#page=\d+/.test(linktext)) {
        return origOpenLinkText.call(
          this,
          linktext,
          sourcePath,
          newLeaf,
          openViewState,
        );
      }

      // Resolve the PDF file from the link text
      const { path: pdfPath } = parseLinktext(linktext);
      const targetFile = app.metadataCache.getFirstLinkpathDest(
        pdfPath,
        sourcePath,
      );

      // If the PDF is already open in any leaf, navigate it in-place
      if (targetFile) {
        let existingLeaf: WorkspaceLeaf | null = null;
        app.workspace.iterateAllLeaves((leaf) => {
          const viewFile = (leaf.view as { file?: TFile } | null)?.file;
          if (viewFile instanceof TFile && viewFile.path === targetFile.path) {
            existingLeaf = leaf;
          }
        });

        if (existingLeaf) {
          app.workspace.revealLeaf(existingLeaf);
          // Navigate the existing leaf directly.  openLinkText exists
          // on WorkspaceLeaf at runtime but is not in the public types.
          const leaf = existingLeaf as WorkspaceLeaf & {
            openLinkText(lt: string, sp: string): Promise<void>;
          };
          return leaf.openLinkText(linktext, sourcePath);
        }
      }

      // PDF not open yet — open in a new split pane
      return origOpenLinkText.call(
        this,
        linktext,
        sourcePath,
        'split',
        openViewState,
      );
    } as typeof Workspace.prototype.openLinkText;

    this.register(() => {
      Workspace.prototype.openLinkText = origOpenLinkText;
    });

    // Register settings tab
    this.addSettingTab(new PdfBookmarkSettingTab(this.app, this));

    // Auto-detect PDF changes and prompt for link updates
    if (this.settings.autoDetectUpdates) {
      this.registerEvent(
        this.app.vault.on('modify', async (file) => {
          if (!(file instanceof TFile)) return;
          if (file.extension === 'pdf') {
            const cached = this.data.pdfBookmarks[file.path];
            if (cached && cached.lastModified !== file.stat.mtime) {
              // Invalidate cache; the next getBookmarks call will re-parse
              await this.store.invalidate(file.path);

              // Check if there are links to this PDF
              const mappings =
                this.store.getLinkMappingsForPdf(file.path);
              if (mappings.length > 0) {
                new Notice(
                  `PDF "${file.name}" was modified. Use "Update all PDF bookmark links" to remap existing links.`,
                  8000,
                );
              }
            }
          }
        }),
      );
    }
  }

  async onunload(): Promise<void> {
    // Obsidian handles view cleanup via registerView.
    // No manual leaf detachment needed (rule 8).
  }

  async saveSettings(): Promise<void> {
    this.data.settings = this.settings;
    await this.saveData(this.data);
  }

  /**
   * Open or reveal the PDF bookmark sidebar view.
   */
  async activateView(): Promise<void> {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(VIEW_TYPE_PDF_BOOKMARK)[0];

    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({
          type: VIEW_TYPE_PDF_BOOKMARK,
          active: true,
        });
        leaf = workspace.getLeavesOfType(VIEW_TYPE_PDF_BOOKMARK)[0];
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }
}
