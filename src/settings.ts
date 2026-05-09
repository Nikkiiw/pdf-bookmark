import { App, PluginSettingTab, Setting } from 'obsidian';
import type PdfBookmarkPlugin from '../main';
import type { PdfBookmarkSettings } from './types';

/**
 * Settings tab registered via addSettingTab().
 * Uses .setHeading() for section headers (rule 17).
 * All labels use sentence case (rule 11).
 */
export class PdfBookmarkSettingTab extends PluginSettingTab {
  plugin: PdfBookmarkPlugin;

  constructor(app: App, plugin: PdfBookmarkPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Link format' });

    new Setting(containerEl)
      .setName('Show page numbers in link text')
      .setDesc(
        'When enabled, inserted links include the page number after the bookmark title.',
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showPageNumbers)
          .onChange(async (value) => {
            this.plugin.settings.showPageNumbers = value;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl('h2', { text: 'Updates' });

    new Setting(containerEl)
      .setName('Auto-detect PDF updates')
      .setDesc(
        'When a PDF is modified, prompt to scan and update existing links.',
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoDetectUpdates)
          .onChange(async (value) => {
            this.plugin.settings.autoDetectUpdates = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
