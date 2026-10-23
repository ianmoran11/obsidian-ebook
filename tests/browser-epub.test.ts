import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { parseEpub } from "../src/epub";
import { makeEpub } from "./fixtures";

let browserBundle: string;
beforeAll(() => {
  // Build in Node, outside jsdom's cross-realm typed-array globals.
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { build } from "esbuild";
    const result = await build({
      entryPoints: ["src/epub.ts"], bundle: true, platform: "browser",
      format: "iife", globalName: "BrowserEpub", write: false,
    });
    process.stdout.write(result.outputFiles[0].text);
  `], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  browserBundle = result.stdout;
});

describe("mobile browser ZIP extraction", () => {
  it.each(["unavailable", "blocked"])("imports large compressed entries when Web Workers are %s", async mode => {
    const workerCreated = vi.fn();
    const createObjectURL = vi.fn(() => "blob:blocked-by-webview");
    class BlockedWorker {
      constructor() { workerCreated(); }
      postMessage(): void {} // A blocked worker never sends its result.
      terminate(): void {}
    }
    const api = runInNewContext(browserBundle + "; BrowserEpub", {
      document, DOMParser, XMLSerializer, TextDecoder, TextEncoder,
      Uint8Array, ArrayBuffer, Blob, console, setTimeout, clearTimeout, queueMicrotask,
      Worker: mode === "blocked" ? BlockedWorker : undefined,
      URL: { createObjectURL },
    }) as { parseEpub: typeof parseEpub };
    // fflate's old async API chose a Blob worker for entries over 512 KiB.
    const image = new Uint8Array(600000).fill(42);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const book = await Promise.race([
        api.parseEpub(makeEpub({ "OEBPS/images/cover.png": image }, 6), "android.epub", controller.signal),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Import stalled waiting for a blocked Web Worker.")), 1000);
        }),
      ]);
      expect(book.metadata.title).toBe("A Test Book");
      expect(book.images[0]?.data.length).toBe(image.length);
      expect(book.images[0]?.data.every(value => value === 42)).toBe(true);
      expect(workerCreated).not.toHaveBeenCalled();
      expect(createObjectURL).not.toHaveBeenCalled();
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  });
});
