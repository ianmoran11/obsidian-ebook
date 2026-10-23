import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseEpub } from "../src/epub";
import { writeImportPlan } from "../src/importer";
import { createImportPlan } from "../src/markdown";
import type { ImportPlan } from "../src/types";
import { COVER, makeEpub, MemoryVault, testBook } from "./fixtures";

function chapterPlan(): ImportPlan {
  return createImportPlan(testBook(), { mode: "chapters", destination: "Library/Books" });
}

describe("safe vault writes", () => {
  it("imports the distributable sample EPUB", async () => {
    const bytes = new Uint8Array(await readFile("examples/A Little EPUB.epub"));
    const book = await parseEpub(bytes, "A Little EPUB.epub");
    const plan = createImportPlan(book, { mode: "chapters", destination: "Books" });
    expect(book.chapters.map(chapter => chapter.title)).toEqual(["A New Shelf", "Room for Notes"]);
    expect(plan.files.some(file => file.path.endsWith("0001 - picture.svg"))).toBe(true);
    expect(plan.warnings).toEqual([]);
  });

  it.each(["single", "chapters"] as const)("imports a complete EPUB end-to-end in %s mode", async mode => {
    const book = await parseEpub(makeEpub(), "sample.epub");
    const plan = createImportPlan(book, { mode, destination: "Books" });
    const vault = new MemoryVault({ "Personal.md": "Keep me" });
    const progress: string[] = [];
    await writeImportPlan(plan, vault, undefined, message => progress.push(message));
    expect(vault.kind(plan.entryPath)).toBe("file");
    expect(vault.entries.get(plan.entryPath)).toContain("## Contents");
    expect(vault.entries.get("Personal.md")).toBe("Keep me");
    expect(vault.entries.get(plan.files[0]!.path)).toEqual(COVER);
    expect(progress).toHaveLength(plan.files.length);
    expect(progress.at(-1)).toContain(`${plan.files.length} of ${plan.files.length}`);
  });

  it("creates nested folders as needed", async () => {
    const vault = new MemoryVault();
    await writeImportPlan(chapterPlan(), vault);
    for (const path of ["Library", "Library/Books", "Library/Books/A Test Book", "Library/Books/A Test Book/_assets"]) {
      expect(vault.kind(path)).toBe("folder");
    }
  });

  it("removes all newly created files and folders after a write failure", async () => {
    const vault = new MemoryVault({ "Existing.md": "Original" });
    vault.failOnWrite = 3;
    await expect(writeImportPlan(chapterPlan(), vault)).rejects.toThrow(/disk failure/);
    expect([...vault.entries.entries()]).toEqual([["Existing.md", "Original"]]);
  });

  it("does not remove destination folders that existed before importing", async () => {
    const vault = new MemoryVault({ Library: null, "Library/Books": null, "Library/Books/Keep.md": "Original" });
    const before = [...vault.entries.entries()];
    vault.failOnWrite = 2;
    await expect(writeImportPlan(chapterPlan(), vault)).rejects.toThrow(/disk failure/);
    expect([...vault.entries.entries()]).toEqual(before);
  });

  it("does not overwrite a file created after the plan was made", async () => {
    const plan = chapterPlan();
    const existing = plan.files[2]!.path;
    const vault = new MemoryVault({ [existing]: "Do not overwrite" });
    await expect(writeImportPlan(plan, vault)).rejects.toThrow(/rather than overwrite/);
    expect(vault.entries.get(existing)).toBe("Do not overwrite");
    expect(vault.kind(plan.entryPath)).toBeUndefined();
  });

  it("stops when a required folder is actually an existing file", async () => {
    const vault = new MemoryVault({ Library: "User content" });
    await expect(writeImportPlan(chapterPlan(), vault)).rejects.toThrow(/file already exists where a folder is needed/);
    expect([...vault.entries.entries()]).toEqual([["Library", "User content"]]);
  });

  it("rolls back if cancelled during writing", async () => {
    const vault = new MemoryVault();
    const controller = new AbortController();
    await expect(writeImportPlan(chapterPlan(), vault, controller.signal, message => {
      if (message.startsWith("Saving 2")) controller.abort();
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(vault.entries.size).toBe(0);
  });

  it("does not create anything if already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const vault = new MemoryVault();
    await expect(writeImportPlan(chapterPlan(), vault, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(vault.entries.size).toBe(0);
  });

  it("reports exact incomplete paths when cleanup itself fails", async () => {
    const plan = chapterPlan();
    const vault = new MemoryVault();
    vault.failOnWrite = 2;
    vault.removeFailures.add(plan.files[0]!.path);
    await expect(writeImportPlan(plan, vault)).rejects.toThrow("Could not remove these incomplete paths: " + plan.files[0]!.path);
  });

  it("does not delete newly created folders that gained unrelated content", async () => {
    const vault = new MemoryVault();
    vault.failOnWrite = 2;
    await expect(writeImportPlan(chapterPlan(), vault, undefined, message => {
      if (message.startsWith("Saving 2")) vault.entries.set("Library/Other.md", "Synced note");
    })).rejects.toThrow(/disk failure/);
    expect(vault.kind("Library")).toBe("folder");
    expect(vault.entries.get("Library/Other.md")).toBe("Synced note");
    expect(vault.kind("Library/Books")).toBeUndefined();
  });
});
