import { strToU8, zipSync } from "fflate";
import type { EpubBook, VaultAccess } from "../src/types";

export const PACKAGE = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>A Test Book</dc:title><dc:creator>Ada Reader</dc:creator>
    <dc:creator>Sam Writer</dc:creator><dc:language>en</dc:language>
    <dc:publisher>Example Press</dc:publisher><dc:identifier id="book-id">urn:test:book</dc:identifier>
    <meta name="cover" content="cover" />
  </metadata>
  <manifest>
    <item id="second" href="text/second.xhtml" media-type="application/xhtml+xml" />
    <item id="first" href="text/first.xhtml" media-type="application/xhtml+xml" />
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
    <item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image" />
  </manifest>
  <spine toc="ncx"><itemref idref="first"/><itemref idref="second"/></spine>
</package>`;

export const COVER = new Uint8Array(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ioAAAAASUVORK5CYII=", "base64",
));

export function epubEntries(): Record<string, string | Uint8Array> {
  return {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    "OEBPS/content.opf": PACKAGE,
    "OEBPS/nav.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
      <nav epub:type="landmarks"><a href="text/first.xhtml">Wrong landmark title</a></nav>
      <nav epub:type="toc"><ol><li><a href="text/first.xhtml#start">Start</a></li><li><a href="text/second.xhtml">Finish</a></li></ol></nav></body></html>`,
    "OEBPS/toc.ncx": `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="one"><navLabel><text>Start NCX</text></navLabel><content src="text/first.xhtml"/></navPoint><navPoint id="two"><navLabel><text>Finish NCX</text></navLabel><content src="text/second.xhtml"/></navPoint></navMap></ncx>`,
    "OEBPS/text/first.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>First document</title></head><body><h1 id="start">Start</h1><p>Hello <em>reader</em>. <a href="second.xhtml#details">jump</a></p><img src="../images/cover.png" alt="A cover"/><ul><li>One</li><li>Two</li></ul></body></html>`,
    "OEBPS/text/second.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Finish</h1><h2 id="details">Details</h2><p>The end. <a href="first.xhtml#start">back</a></p></body></html>`,
    "OEBPS/images/cover.png": COVER,
  };
}

export function makeEpub(overrides: Record<string, string | Uint8Array | null> = {}, level: 0 | 6 = 0): Uint8Array {
  const entries = epubEntries();
  for (const [path, value] of Object.entries(overrides)) {
    if (value === null) delete entries[path];
    else entries[path] = value;
  }
  const bytes = Object.fromEntries(Object.entries(entries).map(([path, value]) => [path,
    typeof value === "string" ? strToU8(value) : value]));
  return zipSync(bytes, { level });
}

export function testBook(overrides: Partial<EpubBook> = {}): EpubBook {
  const entries = epubEntries();
  return {
    metadata: { title: "A Test Book", authors: ["Ada Reader", "Sam Writer"], language: "en" },
    sourceName: "sample.epub",
    chapters: [
      { path: "OEBPS/text/first.xhtml", title: "Start", html: entries["OEBPS/text/first.xhtml"] as string },
      { path: "OEBPS/text/second.xhtml", title: "Finish", html: entries["OEBPS/text/second.xhtml"] as string },
    ],
    images: [{ path: "OEBPS/images/cover.png", extension: "png", data: COVER }],
    coverPath: "OEBPS/images/cover.png",
    warnings: [],
    ...overrides,
  };
}

export class MemoryVault implements VaultAccess {
  readonly entries = new Map<string, string | Uint8Array | null>();
  failOnWrite = Number.POSITIVE_INFINITY;
  writes = 0;
  removeFailures = new Set<string>();

  constructor(initial: Record<string, string | null> = {}) {
    for (const [path, value] of Object.entries(initial)) this.entries.set(path, value);
  }
  kind(path: string): "file" | "folder" | undefined {
    return !this.entries.has(path) ? undefined : this.entries.get(path) === null ? "folder" : "file";
  }
  async mkdir(path: string): Promise<void> {
    if (this.kind(path)) throw new Error("Already exists: " + path);
    this.entries.set(path, null);
  }
  async writeText(path: string, content: string): Promise<void> { this.write(path, content); }
  async writeBinary(path: string, content: Uint8Array): Promise<void> { this.write(path, content); }
  private write(path: string, content: string | Uint8Array): void {
    if (++this.writes === this.failOnWrite) throw new Error("Simulated disk failure");
    if (this.kind(path)) throw new Error("Already exists: " + path);
    this.entries.set(path, content);
  }
  async remove(path: string): Promise<void> {
    if (this.removeFailures.has(path)) throw new Error("Simulated cleanup failure");
    if (this.kind(path) === "folder" && this.children(path).length) throw new Error("Folder is not empty");
    this.entries.delete(path);
  }
  children(path: string): string[] {
    return [...this.entries.keys()].filter(key => key.startsWith(path + "/") && !key.slice(path.length + 1).includes("/"));
  }
}
