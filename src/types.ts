/**
 * Represents a single node in the PDF bookmark (outline) tree.
 */
export interface BookmarkNode {
  /** Display title of the bookmark */
  title: string;
  /** 1-based page number the bookmark points to */
  page: number;
  /** Child bookmarks, if any */
  children: BookmarkNode[];
  /** Full path from root as array of titles, used for identity during remapping */
  path: string[];
}

/**
 * Cached bookmark data for a single PDF file.
 */
export interface PdfBookmarkData {
  /** mtime of the PDF when bookmarks were parsed, used to detect updates */
  lastModified: number;
  /** Root-level bookmark nodes */
  bookmarks: BookmarkNode[];
}

/**
 * Stored mapping linking a note's PDF reference to its bookmark identity.
 * Used to remap page numbers when the PDF is updated.
 */
export interface LinkMapping {
  /** Vault-relative path to the markdown note */
  notePath: string;
  /** Vault-relative path to the PDF file */
  pdfPath: string;
  /** Bookmark identity by full title path, e.g. ["Chapter 1", "Section 1.1"] */
  bookmarkPath: string[];
  /** The page number currently written in the link */
  page: number;
}

/**
 * Plugin settings persisted to data.json.
 */
export interface PdfBookmarkSettings {
  /** Whether to include the page number after the bookmark title in inserted links */
  showPageNumbers: boolean;
  /** Whether to automatically detect PDF changes and prompt for link updates */
  autoDetectUpdates: boolean;
}

export const DEFAULT_SETTINGS: PdfBookmarkSettings = {
  showPageNumbers: false,
  autoDetectUpdates: true,
};

/**
 * Shape of the plugin's data.json.
 */
export interface PdfBookmarkPluginData {
  settings: PdfBookmarkSettings;
  /** PDF path (vault-relative) → cached bookmark data */
  pdfBookmarks: Record<string, PdfBookmarkData>;
  /** All stored link mappings for remapping */
  linkMappings: LinkMapping[];
}
