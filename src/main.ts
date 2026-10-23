import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, type TAbstractFile, type Vault } from "obsidian";
import { MAX_EPUB_BYTES, parseEpub } from "./epub";
import { readEpubFile, readSourceBytes } from "./file-reader";
import { writeImportPlan } from "./importer";
import { createImportPlan } from "./markdown";
import { destinationPath } from "./paths";
import { checkCancelled, type ImportMode, type VaultAccess } from "./types";

interface ImporterSettings {
  destination: string;
  mode: ImportMode;
  openAfterImport: boolean;
}

const DEFAULT_SETTINGS: ImporterSettings = {
  destination: "Books", mode: "single", openAfterImport: true,
};

interface EpubSource {
  name: string;
  size: number;
  read(signal?: AbortSignal): Promise<ArrayBuffer>;
}

function vaultAccess(vault: Vault): VaultAccess {
  // Reserve names case-insensitively so the same vault is portable across OSes.
  const paths = new Map(vault.getAllLoadedFiles().map(file => [file.path.toLowerCase(), file]));
  const find = (path: string): TAbstractFile | undefined =>
    vault.getAbstractFileByPath(path) ?? paths.get(path.toLowerCase());
  return {
    kind(path) {
      const file = find(path);
      return file ? file instanceof TFolder ? "folder" : "file" : undefined;
    },
    async mkdir(path) {
      const folder = await vault.createFolder(path);
      paths.set(path.toLowerCase(), folder);
    },
    async writeText(path, content) {
      const file = await vault.create(path, content);
      paths.set(path.toLowerCase(), file);
    },
    async writeBinary(path, content) {
      const buffer = new ArrayBuffer(content.byteLength);
      new Uint8Array(buffer).set(content);
      const file = await vault.createBinary(path, buffer);
      paths.set(path.toLowerCase(), file);
    },
    async remove(path) {
      const file = find(path);
      if (file) await vault.delete(file);
      paths.delete(path.toLowerCase());
    },
    children(path) {
      const folder = find(path);
      return folder instanceof TFolder ? folder.children.map(child => child.path) : [];
    },
  };
}

export default class EpubImporterPlugin extends Plugin {
  settings: ImporterSettings = { ...DEFAULT_SETTINGS };
  importController?: AbortController;

  async onload(): Promise<void> {
    const saved = await this.loadData() as Partial<ImporterSettings> | null;
    this.settings = {
      destination: typeof saved?.destination === "string" ? saved.destination : DEFAULT_SETTINGS.destination,
      mode: saved?.mode === "chapters" ? "chapters" : "single",
      openAfterImport: typeof saved?.openAfterImport === "boolean" ? saved.openAfterImport : true,
    };
    this.addRibbonIcon("book-open", "Import EPUB", () => new ImportModal(this.app, this).open());
    this.addCommand({
      id: "import-epub", name: "Import EPUB",
      callback: () => new ImportModal(this.app, this).open(),
    });
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFile) || file.extension.toLowerCase() !== "epub") return;
      menu.addItem(item => item.setTitle("Import EPUB as Markdown").setIcon("book-open").onClick(() => {
        new ImportModal(this.app, this, {
          name: file.name, size: file.stat.size, read: () => this.app.vault.readBinary(file),
        }).open();
      }));
    }));
    this.addSettingTab(new ImporterSettingTab(this.app, this));
  }

  onunload(): void {
    this.importController?.abort();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class ImportModal extends Modal {
  private source?: EpubSource;
  private controller?: AbortController;

  constructor(app: App, private readonly plugin: EpubImporterPlugin, source?: EpubSource) {
    super(app);
    this.source = source;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("epub-importer");
    contentEl.createEl("h2", { text: "Import an EPUB" });
    contentEl.createEl("p", {
      cls: "epub-importer-intro",
      text: "Turn a DRM-free ebook into editable Markdown. Everything stays in your vault; no upload or external service is used.",
    });

    const sourceLabel = contentEl.createEl("p", {
      cls: "epub-importer-source", text: this.source?.name ?? "No ebook selected.",
    });
    const fileSetting = new Setting(contentEl).setName("EPUB file").setDesc("Choose a .epub ebook (up to 100 MB).");
    const fileInput = fileSetting.controlEl.createEl("input", {
      type: "file", attr: { accept: ".epub,application/epub+zip", "aria-label": "Choose an EPUB file" },
    });
    let mode = this.plugin.settings.mode;
    let destination = this.plugin.settings.destination;
    const modeSetting = new Setting(contentEl).setName("Chapter layout");
    let modeControl!: HTMLSelectElement;
    modeSetting.addDropdown(dropdown => {
      modeControl = dropdown.selectEl;
      dropdown.addOption("single", "One note — all chapters")
        .addOption("chapters", "Separate notes — book folder")
        .setValue(mode).onChange(value => {
          mode = value as ImportMode;
          describeLayout();
        });
    });
    const describeLayout = () => modeSetting.setDesc(mode === "single" ?
      "Creates one book note with a linked contents list. Images go in a sibling assets folder." :
      "Creates a book folder containing a linked index, numbered chapter notes, and images.");
    describeLayout();

    let destinationControl!: HTMLInputElement;
    new Setting(contentEl).setName("Destination folder").setDesc("Vault-relative path. Leave blank for the vault root.")
      .addText(text => {
        destinationControl = text.inputEl;
        text.setPlaceholder("Books").setValue(destination).onChange(value => { destination = value; });
      });

    const status = contentEl.createEl("p", {
      cls: "epub-importer-status", attr: { role: "status", "aria-live": "polite" },
    });
    const errorEl = contentEl.createEl("p", {
      cls: "epub-importer-error", attr: { role: "alert" },
    });
    const buttons = new Setting(contentEl).setClass("epub-importer-actions");
    let cancelButton!: HTMLButtonElement;
    let importButton!: HTMLButtonElement;
    buttons.addButton(button => {
      cancelButton = button.buttonEl;
      button.setButtonText("Cancel").onClick(() => {
        if (this.controller) {
          this.controller.abort();
          cancelButton.disabled = true;
          status.setText("Cancelling and removing incomplete files…");
        } else this.close();
      });
    });
    buttons.addButton(button => {
      importButton = button.buttonEl;
      button.setButtonText("Import book").setCta().setDisabled(!this.source).onClick(() => { void run(); });
    });
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      this.source = file ? { name: file.name, size: file.size, read: signal => readEpubFile(file, signal) } : undefined;
      sourceLabel.setText(this.source?.name ?? "No ebook selected.");
      importButton.disabled = !this.source;
      errorEl.empty();
    });

    const setBusy = (busy: boolean) => {
      importButton.disabled = busy || !this.source;
      fileInput.disabled = modeControl.disabled = destinationControl.disabled = busy;
      cancelButton.disabled = false;
      cancelButton.textContent = busy ? "Cancel import" : "Cancel";
      contentEl.setAttribute("aria-busy", String(busy));
    };
    const run = async () => {
      const source = this.source;
      if (!source) return;
      if (this.plugin.importController) {
        errorEl.setText("Another EPUB import is already running.");
        return;
      }
      const controller = new AbortController();
      this.controller = this.plugin.importController = controller;
      try {
        errorEl.empty();
        setBusy(true);
        status.setText("Starting EPUB import…");
        new Notice(`Importing “${source.name}”…`, 5000);
        if (!/\.epub$/i.test(source.name)) throw new Error("Please choose a file ending in .epub.");
        if (source.size > MAX_EPUB_BYTES) throw new Error("This EPUB is too large. The limit is 100 MB.");
        const folder = destinationPath(destination);
        const access = vaultAccess(this.app.vault);
        for (let current = folder; current; current = current.slice(0, Math.max(0, current.lastIndexOf("/")))) {
          if (access.kind(current) === "file") throw new Error(`The destination is a file, not a folder: ${current}`);
        }
        this.plugin.settings.mode = mode;
        this.plugin.settings.destination = folder;
        // A stalled mobile preferences write must not prevent importing a book.
        void this.plugin.saveSettings().catch(error => {
          console.warn("EPUB Importer: could not save preferences", error);
          new Notice("Import will continue, but importer preferences could not be saved.");
        });
        status.setText("Reading EPUB file…");
        await new Promise<void>(resolve => window.setTimeout(resolve, 0));
        checkCancelled(controller.signal);
        const bytes = await readSourceBytes(() => source.read(controller.signal), controller.signal);
        const book = await parseEpub(bytes, source.name, controller.signal, message => status.setText(message));
        checkCancelled(controller.signal);
        status.setText(`Converting ${book.chapters.length} chapters to Markdown…`);
        await new Promise<void>(resolve => window.setTimeout(resolve, 0));
        checkCancelled(controller.signal);
        const plan = createImportPlan(book, { mode, destination: folder }, path => !!access.kind(path));
        await writeImportPlan(plan, access, controller.signal, message => status.setText(message));
        this.controller = undefined;
        this.close();
        new Notice(`Imported “${book.metadata.title}” (${book.chapters.length} chapters).`);
        if (plan.warnings.length) {
          console.warn("EPUB Importer:", plan.warnings);
          new Notice("EPUB import notes:\n" + plan.warnings.join("\n"), 15000);
        }
        if (this.plugin.settings.openAfterImport) {
          const file = this.app.vault.getAbstractFileByPath(plan.entryPath);
          if (file instanceof TFile) {
            try { await this.app.workspace.getLeaf(false).openFile(file); }
            catch { new Notice(`The book was saved to ${plan.entryPath}, but could not be opened automatically.`); }
          }
        }
      } catch (error) {
        const cancelled = error instanceof Error && error.name === "AbortError";
        const message = error instanceof Error ? error.message : "The EPUB could not be imported.";
        if (cancelled) {
          new Notice("EPUB import cancelled. Incomplete files were removed.");
          status.setText("Import cancelled.");
        } else {
          console.error("EPUB Importer:", error);
          errorEl.setText(message);
          status.setText("Import did not complete.");
          new Notice("EPUB import failed: " + message, 10000);
        }
      } finally {
        if (this.plugin.importController === controller) this.plugin.importController = undefined;
        this.controller = undefined;
        setBusy(false);
      }
    };
  }

  onClose(): void {
    this.controller?.abort();
    this.contentEl.empty();
  }
}

class ImporterSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: EpubImporterPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("Default destination folder")
      .setDesc("Vault-relative folder for new books. You can change it for each import.")
      .addText(text => text.setPlaceholder("Books").setValue(this.plugin.settings.destination).onChange(async value => {
        this.plugin.settings.destination = value;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl).setName("Default chapter layout")
      .addDropdown(dropdown => dropdown.addOption("single", "One note — all chapters")
        .addOption("chapters", "Separate notes — book folder").setValue(this.plugin.settings.mode).onChange(async value => {
          this.plugin.settings.mode = value as ImportMode;
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl).setName("Open book after importing")
      .setDesc("Open the combined note or the book index after a successful import.")
      .addToggle(toggle => toggle.setValue(this.plugin.settings.openAfterImport).onChange(async value => {
        this.plugin.settings.openAfterImport = value;
        await this.plugin.saveSettings();
      }));
  }
}
