// Minimal public-API stand-in for exercising the real plugin dialog in jsdom.
// The production bundle always uses Obsidian itself, not this module.
function decorateElements(): void {
  Object.defineProperties(HTMLElement.prototype, {
    empty: { configurable: true, value(this: HTMLElement) { this.replaceChildren(); } },
    setText: { configurable: true, value(this: HTMLElement, text: string) { this.textContent = text; } },
    addClass: { configurable: true, value(this: HTMLElement, name: string) { this.classList.add(name); } },
    createEl: {
      configurable: true,
      value(this: HTMLElement, tag: string, options: { text?: string; cls?: string; type?: string; attr?: Record<string, string> } = {}) {
        const element = document.createElement(tag);
        if (options.text) element.textContent = options.text;
        if (options.cls) element.className = options.cls;
        if (options.type) element.setAttribute("type", options.type);
        for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, value);
        this.append(element);
        return element;
      },
    },
  });
}
decorateElements();

export class TAbstractFile { constructor(public path: string) {} }
export class TFolder extends TAbstractFile { children: TAbstractFile[] = []; }
export class TFile extends TAbstractFile {
  get name(): string { return this.path.split("/").pop()!; }
  get extension(): string { return this.name.split(".").pop()!; }
  stat = { size: 0 };
}

export class Notice {
  static messages: string[] = [];
  constructor(message: string) { Notice.messages.push(message); }
}

export class Plugin {
  commands: { id: string; callback: () => void }[] = [];
  ribbon?: () => void;
  savedData: unknown = null;
  settingsTabs: unknown[] = [];
  constructor(public app: unknown) {}
  async loadData(): Promise<unknown> { return this.savedData; }
  async saveData(data: unknown): Promise<void> { this.savedData = data; }
  addRibbonIcon(_icon: string, _name: string, callback: () => void): void { this.ribbon = callback; }
  addCommand(command: { id: string; callback: () => void }): void { this.commands.push(command); }
  registerEvent(): void {}
  addSettingTab(tab: unknown): void { this.settingsTabs.push(tab); }
}

export class Modal {
  static latest?: Modal;
  contentEl = document.createElement("div");
  constructor(public app: unknown) {}
  onOpen(): void {}
  onClose(): void {}
  open(): void { Modal.latest = this; document.body.append(this.contentEl); this.onOpen(); }
  close(): void { this.onClose(); this.contentEl.remove(); }
}

class Button {
  buttonEl: HTMLButtonElement;
  disabled = false;
  private clickCallback?: () => void;
  constructor(parent: HTMLElement) {
    this.buttonEl = parent.createEl("button");
    // Real Obsidian checks the component flag, not just the DOM disabled attribute.
    this.buttonEl.addEventListener("click", () => { if (!this.disabled) this.clickCallback?.(); });
  }
  setButtonText(text: string): this { this.buttonEl.textContent = text; return this; }
  setCta(): this { this.buttonEl.classList.add("mod-cta"); return this; }
  setDisabled(value: boolean): this { this.disabled = value; this.buttonEl.disabled = value; return this; }
  onClick(callback: () => void): this { this.clickCallback = callback; return this; }
}
class Text {
  inputEl: HTMLInputElement;
  constructor(parent: HTMLElement) { this.inputEl = parent.createEl("input", { type: "text" }); }
  setValue(value: string): this { this.inputEl.value = value; return this; }
  setPlaceholder(value: string): this { this.inputEl.placeholder = value; return this; }
  onChange(callback: (value: string) => void): this { this.inputEl.addEventListener("input", () => callback(this.inputEl.value)); return this; }
}
class Dropdown {
  selectEl: HTMLSelectElement;
  constructor(parent: HTMLElement) { this.selectEl = parent.createEl("select"); }
  addOption(value: string, label: string): this {
    this.selectEl.createEl("option", { text: label, attr: { value } }); return this;
  }
  setValue(value: string): this { this.selectEl.value = value; return this; }
  onChange(callback: (value: string) => void): this { this.selectEl.addEventListener("change", () => callback(this.selectEl.value)); return this; }
}
class Toggle {
  toggleEl: HTMLInputElement;
  constructor(parent: HTMLElement) { this.toggleEl = parent.createEl("input", { type: "checkbox" }); }
  setValue(value: boolean): this { this.toggleEl.checked = value; return this; }
  onChange(callback: (value: boolean) => void): this { this.toggleEl.addEventListener("change", () => callback(this.toggleEl.checked)); return this; }
}
export class Setting {
  settingEl: HTMLElement;
  controlEl: HTMLElement;
  private description: HTMLElement;
  constructor(parent: HTMLElement) {
    this.settingEl = parent.createEl("div");
    this.description = this.settingEl.createEl("div");
    this.controlEl = this.settingEl.createEl("div");
  }
  setName(_name: string): this { return this; }
  setDesc(value: string): this { this.description.textContent = value; return this; }
  setClass(name: string): this { this.settingEl.classList.add(name); return this; }
  addButton(callback: (control: Button) => void): this { callback(new Button(this.controlEl)); return this; }
  addText(callback: (control: Text) => void): this { callback(new Text(this.controlEl)); return this; }
  addDropdown(callback: (control: Dropdown) => void): this { callback(new Dropdown(this.controlEl)); return this; }
  addToggle(callback: (control: Toggle) => void): this { callback(new Toggle(this.controlEl)); return this; }
}
export class PluginSettingTab {
  containerEl = document.createElement("div");
  constructor(_app: unknown, _plugin: unknown) {}
}

export function mockApp() {
  const files = new Map<string, TAbstractFile>();
  const contents = new Map<string, string | Uint8Array>();
  const opened: string[] = [];
  const insert = (file: TAbstractFile) => {
    if (files.has(file.path)) throw new Error("File already exists");
    files.set(file.path, file);
    const parent = files.get(file.path.slice(0, file.path.lastIndexOf("/")));
    if (parent instanceof TFolder) parent.children.push(file);
    return file;
  };
  return {
    contents, opened,
    vault: {
      getAllLoadedFiles: () => [...files.values()],
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      async createFolder(path: string) { return insert(new TFolder(path)); },
      async create(path: string, content: string) { const file = insert(new TFile(path)); contents.set(path, content); return file; },
      async createBinary(path: string, content: ArrayBuffer) { const file = insert(new TFile(path)); contents.set(path, new Uint8Array(content)); return file; },
      async delete(file: TAbstractFile) {
        files.delete(file.path); contents.delete(file.path);
        for (const folder of files.values()) if (folder instanceof TFolder) folder.children = folder.children.filter(child => child !== file);
      },
    },
    workspace: {
      on: () => ({}),
      getLeaf: () => ({ async openFile(file: TFile) { opened.push(file.path); } }),
    },
  };
}
