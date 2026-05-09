# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development

```bash
npm run build          # Type-check + bundle production minified main.js
npm run dev            # Watch mode with sourcemaps
npm run version        # Bump manifest.json version (ci only)
```

The build bundles `main.ts` and all `src/*.ts` into `main.js` (CJS, ES2020). `obsidian`, `electron`, and CodeMirror packages are marked as external in esbuild. `pdfjs-dist` is bundled into `main.js`.

No test suite exists for this project.

## Architecture

The plugin uses a **sidebar ItemView** (`BookmarkView`) as the primary UI. Users select a PDF, browse its outline tree, and click bookmarks to open the PDF and/or insert links into notes.

### Key Components

- **`main.ts`** — Plugin lifecycle, registers the sidebar view, ribbon icon, 3 commands, settings tab, file-modify listener, and most critically: a **monkey-patch on `Workspace.prototype.openLinkText`** that intercepts PDF links (`*.pdf#page=N`) to open them in a split pane or reuse an existing PDF leaf.

- **`pdf-parser.ts`** — Extracts PDF outline/bookmarks using `pdfjs-dist` v3.11.174. PDFs are loaded as binary data via `vault.readBinary()` to avoid cross-platform file-path issues. Destinations come in three forms: direct number (0-based page index), `Ref{num,gen}` object, or string (named destination requiring `getDestination()` lookup).

- **`bookmark-store.ts`** — Caches parsed bookmarks keyed by PDF mtime in `data.json`. Manages `LinkMapping` persistence: each mapping stores `{notePath, pdfPath, bookmarkPath: string[], page}` for remapping when PDFs change.

- **`bookmark-tree.ts`** — Pure DOM renderer. Recursively builds collapsible tree rows with chevron toggles, title wrappers (click to open/insert), and copy buttons (hidden until row hover, revealed via CSS).

- **`bookmark-view.ts`** — Sidebar `ItemView` (`VIEW_TYPE = 'pdf-bookmark-view'`). Contains PDF selector header + tree container. `buildLink()` constructs `[full > hierarchical > path](relative/path.pdf#page=N)` format links with relative paths computed from the active note's location.

- **`link-manager.ts`** — Scans notes for `\.pdf#page=\d+` links (no regex lookbehind for iOS compat), remaps page numbers using stored mappings or title matching. Uses `Vault.process()` for atomic file modifications.

- **`pdf-select-modal.ts`** — `FuzzySuggestModal<TFile>` filtered to `.pdf` files.

- **`settings.ts`** — Two toggles: `showPageNumbers` (include page in link text) and `autoDetectUpdates` (prompt on PDF modify).

### The monkey-patch (openLinkText)

Located in `main.ts` `onload()`. The override intercepts calls to `Workspace.prototype.openLinkText`:

1. If `newLeaf` is truthy (Ctrl/Cmd+click) or the linktext doesn't match `*.pdf#page=N` → passes through to original.
2. If the target PDF is already open in any leaf → calls `existingLeaf.openLinkText(linktext, sourcePath)` directly to navigate in-place (avoids creating a duplicate tab).
3. Otherwise → delegates to original with `'split'` to open in a new split pane.

The original function reference is saved and restored via `this.register()` on unload.

### Link Format & Remapping

Inserts: `[Chapter > Section](papers/doc.pdf#page=42)` — the link text is the full hierarchical path joined by ` > `; page number is the anchor.

For remapping, each insertion saves a `LinkMapping` with `bookmarkPath: ["Chapter", "Section"]` as identity. When a PDF is updated, the stored path is used to walk the new bookmark tree to find the new page number. Title-based fallback matching handles links inserted before mappings were tracked.

### Data Flow

```
User selects PDF → BookmarkStore.getBookmarks() → pdf-parser.ts → cache in data.json
User clicks bookmark → BookmarkView.onBookmarkSelected()
  → app.workspace.openLinkText(pdfPath#page=N)  [via monkey-patch]
  → editor.replaceSelection(link)                [if editor active]
  → BookmarkStore.saveLinkMapping()              [for future remapping]
PDF modified → vault.on('modify') → cache invalidated → user notified
User runs "Update all links" → LinkManager.updateAllLinks()
  → scanAllNotes() → re-parse PDF → match + Vault.process()
```

## Obsidian API Constraints

- `obsidian` and `pdfjs-dist` are the only runtime deps. Do NOT add new npm dependencies without strong justification.
- All Obsidian API imports come from the `obsidian` package.
- Use `vault.readBinary()` for file data, `vault.process()` for atomic note modifications, `vault.getAbstractFileByPath()` for lookups.
- `instanceof TFile` checks required on all vault lookups. `TAbstractFile` alone is not enough.
- DOM: use `createEl()` / `createDiv()` (never `innerHTML` for content from the vault). Use `registerDomEvent()` from MarkdownView for CodeMirror hooks.
- No `console.log` in production `onload`/`onunload`. Use `Notice` for user-visible messages.
- Regex: no lookbehind assertions (Safari/iOS < 16.4).
