# PDF Bookmark

Browse PDF bookmarks (outline/TOC), insert hierarchical links into notes, and keep them valid when PDFs are updated.

## Features

- **Browse PDF outline** — View a collapsible tree of any PDF's bookmarks in the sidebar
- **Insert hierarchical links** — Click a bookmark to insert `[Chapter > Section](rel/path.pdf#page=42)` at the cursor, with relative paths and full bookmark path as link text
- **Keep links valid** — When a PDF is updated, run "Update all PDF bookmark links" to automatically remap page numbers
- **Context menu copy** — Right-click any bookmark in Obsidian's built-in PDF outline to copy a link with the full hierarchical path

## Usage

### Sidebar browser

1. Click the ribbon icon or run "Open PDF bookmark browser" from the command palette
2. Click **Select PDF** and pick a PDF from your vault
3. Browse the bookmark tree — click any title to insert a link and open the PDF at that page
4. Hover over a row and click the copy button (two overlapping squares) to copy without inserting

### Context menu (PDF reader)

1. Open a PDF in Obsidian and show its outline panel
2. Right-click any outline item
3. Choose **Copy bookmark link** — the link uses the full hierarchical path format

### Updating links

- When a PDF is modified, you'll be notified if it has existing links
- Run **"Update all PDF bookmark links"** from the command palette to remap all page numbers

## Settings

- **Show page numbers in link text** — Include `(p. 42)` after the bookmark path
- **Auto-detect PDF updates** — Show a notification when a linked PDF has been modified

## Link format

```
[Jeppesen > Air Traffic Control > COMMUNICATION](../docs/manual.pdf#page=1024)
```

Links use relative paths from the note to the PDF, so they survive vault relocation.
