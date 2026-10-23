import { afterEach, describe, expect, it, vi } from "vitest";
import { readEpubFile, readSourceBytes } from "../src/file-reader";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function stalledReader(): void {
  vi.spyOn(FileReader.prototype, "readAsArrayBuffer").mockImplementation(function (this: FileReader) {
    Object.defineProperty(this, "readyState", { configurable: true, value: FileReader.LOADING });
  });
}

describe("Android-compatible file reads", () => {
  it("reads a real File even when File.arrayBuffer is not available", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "book.epub");
    Object.defineProperty(file, "arrayBuffer", { value: undefined });
    const bytes = await readEpubFile(file);
    expect(Array.from(new Uint8Array(bytes))).toEqual([1, 2, 3]);
  });

  it("surfaces file-provider failures with an actionable message", async () => {
    vi.spyOn(FileReader.prototype, "readAsArrayBuffer").mockImplementation(function (this: FileReader) {
      this.dispatchEvent(new ProgressEvent("error"));
    });
    await expect(readEpubFile(new File([], "book.epub"))).rejects.toThrow("save it to Downloads");
  });

  it("surfaces a synchronous FileReader failure", async () => {
    vi.spyOn(FileReader.prototype, "readAsArrayBuffer").mockImplementation(() => { throw new Error("Provider unavailable"); });
    await expect(readEpubFile(new File([], "book.epub"))).rejects.toThrow("Provider unavailable");
  });

  it("does not begin a read when already cancelled", async () => {
    const read = vi.spyOn(FileReader.prototype, "readAsArrayBuffer");
    const controller = new AbortController();
    controller.abort();
    await expect(readEpubFile(new File([], "book.epub"), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(read).not.toHaveBeenCalled();
  });

  it("aborts an in-flight FileReader instead of waiting for the provider", async () => {
    stalledReader();
    const abort = vi.spyOn(FileReader.prototype, "abort");
    const controller = new AbortController();
    const pending = readEpubFile(new File([], "book.epub"), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(abort).toHaveBeenCalledOnce();
  });

  it("times out a stuck file provider and aborts its read", async () => {
    vi.useFakeTimers();
    stalledReader();
    const abort = vi.spyOn(FileReader.prototype, "abort");
    const pending = readEpubFile(new File([], "book.epub"), undefined, 100);
    const assertion = expect(pending).rejects.toThrow("Reading the EPUB timed out");
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(abort).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("bounded source reads", () => {
  it("returns a successful read and clears its timeout", async () => {
    vi.useFakeTimers();
    const bytes = new ArrayBuffer(3);
    expect(await readSourceBytes(async () => bytes)).toBe(bytes);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a non-responsive vault/file source", async () => {
    const controller = new AbortController();
    const pending = readSourceBytes(() => new Promise(() => {}), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reports timeout without requiring a FileReader source", async () => {
    vi.useFakeTimers();
    const pending = readSourceBytes(() => new Promise(() => {}), undefined, 100);
    const assertion = expect(pending).rejects.toThrow("download the file to this device");
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains the source error when it rejects", async () => {
    await expect(readSourceBytes(async () => { throw new Error("No permission"); })).rejects.toThrow("No permission");
  });
});
