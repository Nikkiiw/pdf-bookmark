import type { BookmarkNode } from './types';

/**
 * Callback invoked when the user selects (clicks or presses Enter/Space on)
 * a bookmark node in the tree — opens the PDF at the bookmark page.
 */
export type BookmarkSelectCallback = (node: BookmarkNode) => void;

/**
 * Callback invoked when the user clicks the copy button on a bookmark row.
 */
export type BookmarkCopyCallback = (node: BookmarkNode) => void;

/**
 * Recursively renders a collapsible bookmark tree into a container element.
 *
 * Each node shows:
 *  - A chevron toggle (if it has children)
 *  - The bookmark title
 *  - A page badge
 *  - A copy-link button
 *
 * Keyboard navigation: Tab through nodes, Enter/Space to select.
 */
export function renderBookmarkTree(
  container: HTMLElement,
  bookmarks: BookmarkNode[],
  onSelect: BookmarkSelectCallback,
  onCopy: BookmarkCopyCallback,
  pdfPath: string,
  depth: number = 0,
): void {
  for (const node of bookmarks) {
    const hasChildren = node.children.length > 0;

    // Row container
    const row = container.createDiv({
      cls: 'pdf-bookmark-tree-row',
    });
    row.style.paddingLeft = `${depth * 20}px`;

    // Chevron toggle for expand/collapse
    let chevron: HTMLElement | null = null;
    if (hasChildren) {
      chevron = row.createSpan({
        cls: 'pdf-bookmark-tree-chevron pdf-bookmark-tree-chevron-collapsed',
        text: '▶',
        attr: {
          'aria-label': `Expand ${node.title}`,
          'data-tooltip-position': 'top',
        },
      });
    } else {
      row.createSpan({
        cls: 'pdf-bookmark-tree-chevron pdf-bookmark-tree-chevron-placeholder',
        text: '▶',
      });
    }

    // Wrapper for title + page badge (the clickable open-in-PDF target)
    const titleWrapper = row.createDiv({
      cls: 'pdf-bookmark-tree-title-wrapper',
    });

    const titleEl = titleWrapper.createSpan({
      cls: 'pdf-bookmark-tree-title',
      text: node.title,
    });

    const pageEl = titleWrapper.createSpan({
      cls: 'pdf-bookmark-tree-page',
      text: `p. ${node.page}`,
    });

    // Make the title wrapper clickable and keyboard-accessible
    titleWrapper.setAttr('tabindex', '0');
    titleWrapper.setAttr('role', 'button');
    titleWrapper.setAttr(
      'aria-label',
      `Open ${node.title}, page ${node.page}`,
    );
    titleWrapper.setAttr('data-tooltip-position', 'top');

    titleWrapper.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelect(node);
    });

    titleWrapper.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        onSelect(node);
      }
    });

    // Copy-link button
    const copyBtn = row.createEl('button', {
      cls: 'pdf-bookmark-tree-copy-btn',
      attr: {
        'aria-label': `Copy link to ${node.title}`,
        'data-tooltip-position': 'top',
      },
    });
    copyBtn.setText('📋');
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onCopy(node);
    });

    // Child container (hidden by default)
    let childContainer: HTMLElement | null = null;
    if (hasChildren) {
      childContainer = container.createDiv({
        cls: 'pdf-bookmark-tree-children pdf-bookmark-tree-children-collapsed',
      });

      renderBookmarkTree(
        childContainer,
        node.children,
        onSelect,
        onCopy,
        pdfPath,
        depth + 1,
      );

      // Wire chevron toggle
      chevron!.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCollapsed = childContainer!.hasClass(
          'pdf-bookmark-tree-children-collapsed',
        );
        if (isCollapsed) {
          childContainer!.removeClass(
            'pdf-bookmark-tree-children-collapsed',
          );
          chevron!.removeClass('pdf-bookmark-tree-chevron-collapsed');
          chevron!.addClass('pdf-bookmark-tree-chevron-expanded');
          chevron!.setAttr('aria-label', `Collapse ${node.title}`);
        } else {
          childContainer!.addClass(
            'pdf-bookmark-tree-children-collapsed',
          );
          chevron!.removeClass('pdf-bookmark-tree-chevron-expanded');
          chevron!.addClass('pdf-bookmark-tree-chevron-collapsed');
          chevron!.setAttr('aria-label', `Expand ${node.title}`);
        }
      });

      chevron!.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          chevron!.click();
        }
      });

      chevron!.setAttr('tabindex', '0');
      chevron!.setAttr('role', 'button');
    }
  }
}

/**
 * Clear the bookmark tree and re-render.
 */
export function clearAndRenderBookmarkTree(
  container: HTMLElement,
  bookmarks: BookmarkNode[],
  onSelect: BookmarkSelectCallback,
  onCopy: BookmarkCopyCallback,
  pdfPath: string,
): void {
  container.empty();
  if (bookmarks.length === 0) {
    container.createDiv({
      cls: 'pdf-bookmark-tree-empty',
      text: 'No bookmarks found in this PDF.',
    });
    return;
  }
  renderBookmarkTree(container, bookmarks, onSelect, onCopy, pdfPath);
}
