import { describe, expect, it } from "vitest";
import { strToU8, zipSync, Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { parseEpub } from "../src/epub";
import { COVER, epubEntries, makeEpub, PACKAGE } from "./fixtures";

const noNav = PACKAGE.replace(/<item id="nav"[^>]+\/>/, "");
const noToc = noNav.replace(/<item id="ncx"[^>]+\/>/, "");

describe("EPUB parsing", () => {
  it("reads EPUB 3 metadata, local images, cover, and TOC titles", async () => {
    const book = await parseEpub(makeEpub(), "sample.epub");
    expect(book.metadata).toEqual({ title: "A Test Book", authors: ["Ada Reader", "Sam Writer"], language: "en", publisher: "Example Press", identifier: "urn:test:book" });
    expect(book.chapters.map(chapter => chapter.title)).toEqual(["Start", "Finish"]);
    expect(book.images[0]?.data).toEqual(COVER);
    expect(book.coverPath).toBe("OEBPS/images/cover.png");
    expect(book.warnings).toEqual([]);
  });

  it("reads DEFLATE-compressed EPUB entries, including asynchronous extraction", async () => {
    const image = new Uint8Array(600000).fill(42);
    const book = await parseEpub(makeEpub({ "OEBPS/images/cover.png": image }, 6), "compressed.epub");
    expect(book.chapters).toHaveLength(2);
    const extracted = book.images[0]!.data;
    expect(extracted.byteLength).toBe(image.byteLength);
    expect(extracted.every((value, index) => value === image[index])).toBe(true);
  });

  it("supports streaming ZIP entries with data descriptors", async () => {
    const chunks: Uint8Array[] = [];
    const zip = new Zip((error, chunk) => {
      if (error) throw error;
      chunks.push(chunk);
    });
    for (const [name, value] of Object.entries(epubEntries())) {
      const entry = name === "mimetype" ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 });
      zip.add(entry);
      entry.push(typeof value === "string" ? strToU8(value) : value, true);
    }
    zip.end();
    const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const book = await parseEpub(bytes, "streamed.epub");
    expect(book.chapters).toHaveLength(2);
    expect(Array.from(book.images[0]!.data)).toEqual(Array.from(COVER));
  });

  it("reports unpacking progress and honors cancellation during extraction", async () => {
    const messages: string[] = [];
    await parseEpub(makeEpub(), "sample.epub", undefined, message => messages.push(message));
    expect(messages[0]).toBe("Unpacking EPUB… 0%");
    expect(messages.at(-1)).toBe("Unpacking EPUB… 100%");
    const controller = new AbortController();
    await expect(parseEpub(makeEpub(), "sample.epub", controller.signal, message => {
      if (message.endsWith("100%")) controller.abort();
    })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects mismatched local and central ZIP names", async () => {
    const bytes = makeEpub();
    bytes[30] = 120; // Rename only the local header's first filename (mimetype).
    await expect(parseEpub(bytes, "damaged.epub")).rejects.toThrow(/damaged/);
  });

  it("checks actual decompressed sizes against the preflighted limits", async () => {
    const bytes = makeEpub({}, 6);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let changed = false;
    for (let i = 0; i < bytes.length - 46; i++) {
      if (view.getUint32(i, true) !== 0x02014b50) continue;
      const length = view.getUint16(i + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(i + 46, i + 46 + length));
      if (name === "OEBPS/images/cover.png") {
        view.setUint32(i + 24, COVER.length - 1, true);
        changed = true;
        break;
      }
    }
    expect(changed).toBe(true);
    await expect(parseEpub(bytes, "damaged.epub")).rejects.toThrow(/inconsistent entry sizes/);
  });

  it("uses spine order rather than manifest order or filenames", async () => {
    const book = await parseEpub(makeEpub(), "sample.epub");
    expect(book.chapters.map(chapter => chapter.path)).toEqual(["OEBPS/text/first.xhtml", "OEBPS/text/second.xhtml"]);
  });

  it("reads EPUB 2 NCX navigation and legacy cover metadata", async () => {
    const opf = noNav.replace('version="3.0"', 'version="2.0"').replace(' properties="cover-image"', "");
    const book = await parseEpub(makeEpub({ "OEBPS/content.opf": opf }), "old.epub");
    expect(book.chapters.map(chapter => chapter.title)).toEqual(["Start NCX", "Finish NCX"]);
    expect(book.coverPath).toBe("OEBPS/images/cover.png");
  });

  it("falls back to chapter headings and the input filename", async () => {
    const opf = noToc.replace("<dc:title>A Test Book</dc:title>", "");
    const book = await parseEpub(makeEpub({ "OEBPS/content.opf": opf }), "Fallback Title.EPUB");
    expect(book.metadata.title).toBe("Fallback Title");
    expect(book.chapters.map(chapter => chapter.title)).toEqual(["Start", "Finish"]);
  });

  it("falls back to the HTML title when a chapter has no heading", async () => {
    const book = await parseEpub(makeEpub({
      "OEBPS/content.opf": noToc,
      "OEBPS/text/first.xhtml": "<html><head><title>Document title</title></head><body><p>Some words.</p></body></html>",
    }), "sample.epub");
    expect(book.chapters[0]?.title).toBe("Document title");
  });

  it("resolves percent-encoded filenames and parent-relative assets", async () => {
    const opf = PACKAGE.replace('href="images/cover.png"', 'href="../images/cover%20one.png"');
    const book = await parseEpub(makeEpub({
      "OEBPS/content.opf": opf, "OEBPS/images/cover.png": null, "images/cover one.png": COVER,
    }), "sample.epub");
    expect(book.images[0]?.path).toBe("images/cover one.png");
  });

  it("uses a supported fallback for a non-HTML spine item", async () => {
    const opf = PACKAGE.replace('<item id="first" href="text/first.xhtml" media-type="application/xhtml+xml" />',
      '<item id="first" href="chapter.bin" media-type="application/octet-stream" fallback="html"/><item id="html" href="text/first.xhtml" media-type="application/xhtml+xml"/>');
    const book = await parseEpub(makeEpub({ "OEBPS/content.opf": opf }), "sample.epub");
    expect(book.chapters[0]?.path).toBe("OEBPS/text/first.xhtml");
  });

  it("skips non-linear supplementary documents", async () => {
    const opf = PACKAGE.replace('<itemref idref="second"/>', '<itemref idref="second" linear="no"/>');
    const book = await parseEpub(makeEpub({ "OEBPS/content.opf": opf }), "sample.epub");
    expect(book.chapters).toHaveLength(1);
  });

  it("reports missing images without losing text", async () => {
    const book = await parseEpub(makeEpub({ "OEBPS/images/cover.png": null }), "sample.epub");
    expect(book.chapters).toHaveLength(2);
    expect(book.images).toHaveLength(0);
    expect(book.warnings.join()).toContain("Missing image");
  });

  it("recovers from a damaged optional TOC", async () => {
    const book = await parseEpub(makeEpub({ "OEBPS/content.opf": noNav, "OEBPS/toc.ncx": "<broken>" }), "sample.epub");
    expect(book.chapters[0]?.title).toBe("Start");
    expect(book.warnings.join()).toContain("table of contents");
  });

  it("imports and sanitizes standalone SVG attachments", async () => {
    const opf = PACKAGE.replace('href="images/cover.png" media-type="image/png"', 'href="images/cover.svg" media-type="image/svg+xml"');
    const book = await parseEpub(makeEpub({ "OEBPS/content.opf": opf, "OEBPS/images/cover.svg": '<svg xmlns="http://www.w3.org/2000/svg" onload="bad()"><script>bad()</script><rect width="10" height="10"/></svg>' }), "sample.epub");
    const svg = new TextDecoder().decode(book.images[0]?.data);
    expect(svg).toContain("rect");
    expect(svg).not.toMatch(/script|onload|bad/);
  });

  it.each([
    [{ "META-INF/container.xml": null }, /missing META-INF/],
    [{ "META-INF/container.xml": "<container>" }, /invalid XML/],
    [{ "OEBPS/content.opf": null }, /missing a required resource/],
    [{ "OEBPS/text/first.xhtml": null }, /missing a required resource/],
    [{ mimetype: "application/zip" }, /not an EPUB/],
    [{ "OEBPS/content.opf": PACKAGE.replace('idref="first"', 'idref="missing"') }, /missing manifest item/],
    [{ "OEBPS/content.opf": PACKAGE.replace(/<itemref[^>]+\/>/g, "") }, /no.*readable chapters/],
    [{ "OEBPS/content.opf": PACKAGE.replace(/<spine[\s\S]*?<\/spine>/, "") }, /no reading order/],
    [{ "OEBPS/content.opf": PACKAGE.replace('media-type="application/xhtml+xml"', 'media-type="image/svg+xml"') }, /Unsupported chapter format/],
  ] as const)("rejects malformed or unsupported EPUBs: %j", async (overrides, message) => {
    await expect(parseEpub(makeEpub(overrides), "bad.epub")).rejects.toThrow(message);
  });

  it("rejects encrypted content rather than importing unreadable text", async () => {
    const encryption = '<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><CipherData><CipherReference URI="OEBPS/text/first.xhtml"/></CipherData></EncryptedData></encryption>';
    await expect(parseEpub(makeEpub({ "META-INF/encryption.xml": encryption }), "drm.epub")).rejects.toThrow(/DRM/);
  });

  it("allows standard font obfuscation, which does not encrypt chapters", async () => {
    const encryption = '<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><CipherData><CipherReference URI="OEBPS/font.otf"/></CipherData></EncryptedData></encryption>';
    const opf = PACKAGE.replace("</manifest>", '<item id="font" href="font.otf" media-type="application/vnd.ms-opentype"/></manifest>');
    const book = await parseEpub(makeEpub({ "OEBPS/content.opf": opf, "META-INF/encryption.xml": encryption }), "font.epub");
    expect(book.chapters).toHaveLength(2);
  });

  it("does not mistake encrypted images for obfuscated fonts", async () => {
    const encryption = '<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><CipherReference URI="OEBPS/images/cover.png"/></EncryptedData></encryption>';
    await expect(parseEpub(makeEpub({ "META-INF/encryption.xml": encryption }), "drm.epub")).rejects.toThrow(/DRM/);
  });

  it("rejects archive path traversal", async () => {
    await expect(parseEpub(makeEpub({ "../../escape.txt": "bad" }), "unsafe.epub")).rejects.toThrow(/unsafe|outside/);
  });

  it("rejects misleading decompressed sizes before extracting", async () => {
    const zip = makeEpub();
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = 0; i < zip.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 33 * 1024 * 1024, true);
        break;
      }
    }
    await expect(parseEpub(zip, "bomb.epub")).rejects.toThrow(/safe extraction limits/);
  });

  it("rejects non-ZIP input and empty ZIPs", async () => {
    await expect(parseEpub(strToU8("not a ZIP"), "bad.epub")).rejects.toThrow(/valid EPUB/);
    await expect(parseEpub(zipSync({}), "empty.epub")).rejects.toThrow(/missing META-INF/);
  });

  it("honors cancellation before parsing and while unpacking", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(parseEpub(makeEpub(), "sample.epub", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    const active = new AbortController();
    const parsing = parseEpub(makeEpub(), "sample.epub", active.signal);
    active.abort();
    await expect(parsing).rejects.toMatchObject({ name: "AbortError" });
  });
});
