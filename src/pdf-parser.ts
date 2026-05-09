import * as pdfjsLib from 'pdfjs-dist';
import { Notice } from 'obsidian';
import type { BookmarkNode } from './types';

/**
 * Shape of a single outline/bookmark node returned by pdfjs getOutline().
 * pdfjs-dist v3.11 types don't export the Outline interface directly,
 * so we define our own minimal shape.
 */
interface PdfOutlineItem {
  title: string;
  dest?: string | Array<unknown>;
  items?: PdfOutlineItem[];
}

/**
 * Minimal shape of a PDF page reference used in destinations.
 */
interface PdfPageRef {
  num: number;
  gen: number;
}

/**
 * Configure the PDF.js worker via CDN. The worker is cached by the browser
 * after first load, so subsequent uses are instant and work offline.
 */
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/**
 * Recursively transform pdfjs outline nodes into our BookmarkNode tree.
 * Page numbers are set to 1 initially and resolved in a second pass.
 */
function transformOutlineNodes(
  items: PdfOutlineItem[],
  parentPath: string[],
): BookmarkNode[] {
  const result: BookmarkNode[] = [];

  for (const item of items) {
    const title = (item.title || 'Untitled').trim();
    const currentPath = [...parentPath, title];
    const children =
      item.items && item.items.length > 0
        ? transformOutlineNodes(item.items, currentPath)
        : [];

    result.push({
      title,
      page: 1, // resolved in resolvePageNumbers
      children,
      path: currentPath,
    });
  }

  return result;
}

/**
 * Resolve actual 1-based page numbers for bookmark nodes.
 *
 * PDF outline destinations come in three forms:
 *  1. A string — named destination, needs getDestination() lookup
 *  2. [0-based page index, 'XYZ', ...] — explicit page index
 *  3. [Ref{num,gen}, 'XYZ', ...] — indirect page reference
 */
async function resolvePageNumbers(
  nodes: BookmarkNode[],
  pdfDocument: pdfjsLib.PDFDocumentProxy,
  outlineItems: PdfOutlineItem[],
): Promise<void> {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const item = outlineItems[i];
    if (!item) continue;

    if (item.dest) {
      try {
        node.page = await resolveDestination(item.dest, pdfDocument);
      } catch {
        // Keep page = 1 if destination resolution fails.
      }
    }

    if (node.children.length > 0 && item.items) {
      await resolvePageNumbers(node.children, pdfDocument, item.items);
    }
  }
}

/**
 * Resolve a single outline destination to a 1-based page number.
 *
 * Handles:
 *  - String: named destination → getDestination() → array
 *  - Array[number, ...]: direct 0-based page index
 *  - Array[{num, gen}, ...]: Ref object → getPageIndex()
 */
async function resolveDestination(
  dest: string | Array<unknown>,
  pdfDocument: pdfjsLib.PDFDocumentProxy,
): Promise<number> {
  // Named destinations: resolve via the PDF document's name dictionary
  if (typeof dest === 'string') {
    try {
      const resolved = await pdfDocument.getDestination(dest);
      if (!resolved || !Array.isArray(resolved) || resolved.length === 0) {
        return 1;
      }
      return extractPageFromDestArray(resolved, pdfDocument);
    } catch {
      return 1;
    }
  }

  // Explicit destination array
  return extractPageFromDestArray(dest, pdfDocument);
}

/**
 * Extract 1-based page number from a destination array.
 */
async function extractPageFromDestArray(
  dest: Array<unknown>,
  pdfDocument: pdfjsLib.PDFDocumentProxy,
): Promise<number> {
  if (dest.length === 0) return 1;

  const first = dest[0];

  // Direct 0-based page index
  if (typeof first === 'number') {
    return first + 1;
  }

  // Ref object {num, gen}
  if (
    first &&
    typeof first === 'object' &&
    'num' in first &&
    'gen' in first
  ) {
    const pageIndex = await pdfDocument.getPageIndex(
      first as PdfPageRef,
    );
    return pageIndex + 1;
  }

  return 1;
}

/**
 * Parse bookmarks from binary PDF data.
 * Reads the PDF via Obsidian's vault.readBinary() — avoids all
 * cross-platform file-path issues (Electron file:// URLs, mobile sandboxing).
 *
 * @param data - Raw PDF bytes (from vault.readBinary)
 * @returns Promise resolving to the root-level bookmark nodes
 */
export async function parseBookmarksFromData(
  data: ArrayBuffer,
): Promise<BookmarkNode[]> {
  let pdfDocument: pdfjsLib.PDFDocumentProxy | null = null;

  try {
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data) });
    pdfDocument = await loadingTask.promise;

    const outline = (await pdfDocument.getOutline()) as PdfOutlineItem[] | null;

    if (!outline || outline.length === 0) {
      return [];
    }

    const bookmarks = transformOutlineNodes(outline, []);
    await resolvePageNumbers(bookmarks, pdfDocument, outline);

    return bookmarks;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    new Notice(`Failed to parse PDF bookmarks: ${message}`);
    return [];
  } finally {
    if (pdfDocument) {
      try {
        await pdfDocument.destroy();
      } catch {
        // Destroy can throw if the document is already torn down
      }
    }
  }
}

/**
 * Check if a file is a PDF by extension.
 */
export function isPdfFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.pdf');
}
