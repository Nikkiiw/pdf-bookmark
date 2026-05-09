import { FuzzySuggestModal, TFile, type App } from 'obsidian';

/**
 * Modal that lets the user fuzzy-search for a PDF file in the vault.
 * Only shows files ending with .pdf.
 */
export class PdfSelectModal extends FuzzySuggestModal<TFile> {
  private onSelect: (file: TFile) => void;

  constructor(app: App, onSelect: (file: TFile) => void) {
    super(app);
    this.onSelect = onSelect;
    this.setPlaceholder('Search for a PDF file...');
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter(
      (file) => file.extension === 'pdf',
    );
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onSelect(file);
  }
}
