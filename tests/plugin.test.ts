import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";
import EpubImporterPlugin from "../src/main";
import { Modal, Notice, Plugin as MockPlugin, Setting as MockSetting, mockApp } from "./obsidian-mock";
import { makeEpub } from "./fixtures";

const manifest = { id: "epub-importer", name: "EPUB Importer", version: "1.0.0", minAppVersion: "1.5.0", author: "Contributors", description: "Test" } satisfies PluginManifest;

async function openPlugin() {
  const app = mockApp();
  const plugin = new EpubImporterPlugin(app as unknown as App, manifest);
  const registered = plugin as unknown as MockPlugin;
  await plugin.onload();
  registered.commands[0]!.callback();
  return { app, plugin, registered, modal: Modal.latest! };
}

function chooseFile(modal: Modal, name = "sample.epub", read?: () => Promise<ArrayBuffer>): void {
  const bytes = makeEpub();
  const input = modal.contentEl.querySelector<HTMLInputElement>('input[type="file"]')!;
  const source = new File([Uint8Array.from(bytes).buffer], name, { type: "application/epub+zip" });
  if (read) {
    vi.spyOn(FileReader.prototype, "readAsArrayBuffer").mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, "readyState", { configurable: true, value: FileReader.LOADING });
      void read().then(buffer => {
        if (!this.onload) return;
        Object.defineProperty(this, "result", { configurable: true, value: buffer });
        this.dispatchEvent(new ProgressEvent("load"));
      }, () => this.dispatchEvent(new ProgressEvent("error")));
    });
  }
  Object.defineProperty(input, "files", { configurable: true, value: [source] });
  input.dispatchEvent(new Event("change"));
}

function submit(modal: Modal): void {
  const button = Array.from(modal.contentEl.querySelectorAll("button")).find(button => button.textContent === "Import book")!;
  expect(button.disabled).toBe(false);
  button.click();
}

beforeEach(() => { Notice.messages = []; document.body.replaceChildren(); });
afterEach(() => { Modal.latest?.close(); vi.restoreAllMocks(); });

describe("plugin and import dialog", () => {
  it("models Obsidian's separate component-disabled click guard", () => {
    let clicks = 0;
    new MockSetting(document.body).addButton(button => {
      button.setDisabled(true).onClick(() => { clicks++; });
      button.buttonEl.disabled = false;
      button.buttonEl.click();
      expect(clicks).toBe(0);
      button.setDisabled(false);
      button.buttonEl.click();
      expect(clicks).toBe(1);
    });
  });

  it("registers the command, ribbon entry, and settings tab", async () => {
    const { registered, modal } = await openPlugin();
    expect(registered.commands[0]?.id).toBe("import-epub");
    expect(registered.ribbon).toBeTypeOf("function");
    expect(registered.settingsTabs).toHaveLength(1);
    expect(modal.contentEl.querySelector('input[type="file"]')?.getAttribute("accept")).toContain(".epub");
    const dropdown = modal.contentEl.querySelector("select")!;
    expect(Array.from(dropdown.options, option => option.value)).toEqual(["single", "chapters"]);
    expect(dropdown.value).toBe("single");
  });

  it.each(["single", "chapters"] as const)("imports the chosen file through the dialog in %s mode", async mode => {
    const { app, plugin, modal } = await openPlugin();
    chooseFile(modal);
    const dropdown = modal.contentEl.querySelector("select")!;
    dropdown.value = mode;
    dropdown.dispatchEvent(new Event("change"));
    const destination = modal.contentEl.querySelector<HTMLInputElement>('input[type="text"]')!;
    destination.value = "Reading";
    destination.dispatchEvent(new Event("input"));
    submit(modal);
    await vi.waitFor(() => expect(Notice.messages.some(message => message.startsWith("Imported"))).toBe(true));
    const entry = mode === "single" ? "Reading/A Test Book.md" : "Reading/A Test Book/Book.md";
    expect(app.contents.get(entry)).toContain("## Contents");
    if (mode === "single") expect(app.contents.get(entry)).toContain("Hello");
    if (mode === "chapters") {
      expect(app.contents.get(entry)).not.toContain("Hello");
      expect(app.contents.get("Reading/A Test Book/01 - Start.md")).toContain("Hello");
    }
    expect([...app.contents.keys()].filter(path => path.endsWith(".md"))).toHaveLength(mode === "single" ? 1 : 3);
    expect(app.opened).toEqual([entry]);
    expect(plugin.importController).toBeUndefined();
    expect(plugin.settings.mode).toBe(mode);
    expect(plugin.settings.destination).toBe("Reading");
  });

  it("re-enables the component after clearing and reselecting a file", async () => {
    const { app, modal } = await openPlugin();
    const button = modal.contentEl.querySelector<HTMLButtonElement>(".mod-cta")!;
    expect(button.disabled).toBe(true);
    chooseFile(modal);
    expect(button.disabled).toBe(false);
    const input = modal.contentEl.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [] });
    input.dispatchEvent(new Event("change"));
    expect(button.disabled).toBe(true);
    chooseFile(modal);
    submit(modal);
    await vi.waitFor(() => expect(app.contents.has("Books/A Test Book.md")).toBe(true));
  });

  it("shows a useful validation error without touching the vault", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { app, modal, plugin } = await openPlugin();
    chooseFile(modal, "not-an-epub.pdf");
    submit(modal);
    await vi.waitFor(() => expect(modal.contentEl.querySelector('[role="alert"]')?.textContent).toContain("ending in .epub"));
    expect(app.contents.size).toBe(0);
    expect(plugin.importController).toBeUndefined();
    expect(modal.contentEl.querySelector('input[type="file"]')?.hasAttribute("disabled")).toBe(false);
  });

  it("cancels an in-flight file read when the modal closes", async () => {
    const { app, modal, plugin } = await openPlugin();
    let resolveRead!: (value: ArrayBuffer) => void;
    const read = vi.fn(() => new Promise<ArrayBuffer>(resolve => { resolveRead = resolve; }));
    chooseFile(modal, "sample.epub", read);
    submit(modal);
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    modal.close();
    // Cancellation must release the lock even before a phone's file provider responds.
    await vi.waitFor(() => expect(plugin.importController).toBeUndefined());
    expect(app.contents.size).toBe(0);
    expect(Notice.messages.join()).toContain("cancelled");
    resolveRead(Uint8Array.from(makeEpub()).buffer);
  });

  it("shows immediate feedback and does not depend on the button's setText extension", async () => {
    const { app, modal } = await openPlugin();
    chooseFile(modal);
    const cancel = Array.from(modal.contentEl.querySelectorAll("button")).find(button => button.textContent === "Cancel")!;
    Object.defineProperty(cancel, "setText", { value: undefined });
    submit(modal);
    expect(Notice.messages.join()).toContain("Importing “sample.epub”…");
    expect(modal.contentEl.querySelector('[role="status"]')?.textContent).toContain("Reading EPUB file");
    await vi.waitFor(() => expect(app.contents.has("Books/A Test Book.md")).toBe(true));
  });

  it("does not block a book import on a stalled preferences write", async () => {
    const { app, plugin, modal } = await openPlugin();
    vi.spyOn(plugin, "saveSettings").mockImplementation(() => new Promise(() => {}));
    chooseFile(modal);
    submit(modal);
    await vi.waitFor(() => expect(app.contents.has("Books/A Test Book.md")).toBe(true));
    expect(Notice.messages.some(message => message.startsWith("Imported"))).toBe(true);
    expect(plugin.importController).toBeUndefined();
  });

  it("shows a readable error when the Android file provider cannot read the file", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { app, plugin, modal } = await openPlugin();
    vi.spyOn(FileReader.prototype, "readAsArrayBuffer").mockImplementation(function (this: FileReader) {
      this.dispatchEvent(new ProgressEvent("error"));
    });
    chooseFile(modal);
    submit(modal);
    await vi.waitFor(() => expect(modal.contentEl.querySelector('[role="alert"]')?.textContent).toContain("save it to Downloads"));
    expect(app.contents.size).toBe(0);
    expect(plugin.importController).toBeUndefined();
    expect(Notice.messages.join()).toContain("EPUB import failed");
  });
});
