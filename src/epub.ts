import { unzip, unzipSync, type Unzipped } from "fflate";
import { elements, inertHtml, parseXml, plainText, sanitizeSvg } from "./dom";
import { decodeReference, normalizeArchivePath, resolveReference } from "./paths";
import { checkCancelled, type EpubBook, type EpubChapter, type EpubImage } from "./types";

export const MAX_EPUB_BYTES = 100 * 1024 * 1024;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 10000;
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
  "image/gif": "gif", "image/webp": "webp", "image/avif": "avif",
  "image/bmp": "bmp", "image/svg+xml": "svg",
};
const HTML_TYPES = new Set(["application/xhtml+xml", "text/html"]);

function decode(data: Uint8Array): string {
  let encoding = "utf-8";
  if (data[0] === 0xff && data[1] === 0xfe) encoding = "utf-16le";
  else if (data[0] === 0xfe && data[1] === 0xff) encoding = "utf-16be";
  else {
    const prefix = new TextDecoder().decode(data.subarray(0, 300));
    encoding = prefix.match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i)?.[1] ?? encoding;
  }
  try { return new TextDecoder(encoding).decode(data); }
  catch { throw new Error(`The EPUB uses an unsupported text encoding: ${encoding}.`); }
}

async function readArchive(data: Uint8Array, signal?: AbortSignal): Promise<Unzipped> {
  checkCancelled(signal);
  if (data.length > MAX_EPUB_BYTES) throw new Error("This EPUB is too large. The limit is 100 MB.");
  if (data.length < 22 || data[0] !== 0x50 || data[1] !== 0x4b) {
    throw new Error("This file is not a valid EPUB ZIP archive.");
  }
  let count = 0;
  let total = 0;
  const names = new Set<string>();
  try {
    // Inspect the complete ZIP directory BEFORE allocating decompressed buffers.
    unzipSync(data, { filter: file => {
      count++;
      total += file.originalSize;
      if (count > MAX_ENTRIES || total > MAX_TOTAL_BYTES || file.originalSize > MAX_ENTRY_BYTES) {
        throw new Error("The EPUB exceeds safe extraction limits (32 MB per file, 256 MB total, 10,000 entries).");
      }
      if (file.compression === 0 && file.size !== file.originalSize) {
        throw new Error("The EPUB has inconsistent ZIP entry sizes.");
      }
      const path = file.name.replace(/\/$/, "");
      if (path !== normalizeArchivePath(path) || path.split("/").some(part => part === "..") ||
          Object.prototype.hasOwnProperty.call(Object.prototype, path) || names.has(file.name)) {
        throw new Error("The EPUB contains unsafe or duplicate resource paths.");
      }
      names.add(file.name);
      return false;
    } });
  } catch (error) {
    if (error instanceof Error && /EPUB|resource|outside/.test(error.message)) throw error;
    throw new Error("The EPUB ZIP archive is damaged or unsupported.");
  }

  return new Promise((resolve, reject) => {
    let stop: (() => void) | undefined;
    const abort = () => {
      signal?.removeEventListener("abort", abort);
      stop?.();
      const error = new Error("Import cancelled.");
      error.name = "AbortError";
      reject(error);
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      stop = unzip(data, { filter: file => !file.name.endsWith("/") }, (error, files) => {
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted) abort();
        else if (error) reject(new Error("Could not extract this EPUB. It may be damaged, encrypted, or use unsupported ZIP compression."));
        else resolve(files);
      });
    } catch {
      signal?.removeEventListener("abort", abort);
      stop?.();
      reject(new Error("Could not extract this EPUB."));
    }
  });
}

interface ManifestItem {
  id: string;
  path: string;
  mediaType: string;
  properties: string[];
  fallback?: string;
}

function navigationTitles(archive: Unzipped, items: ManifestItem[], spineToc: string | null): Map<string, string> {
  const result = new Map<string, string>();
  const navigation = items.find(item => item.properties.includes("nav"));
  if (navigation && archive[navigation.path]) {
    const root = inertHtml(decode(archive[navigation.path]!));
    const toc = Array.from(root.querySelectorAll("nav")).find(nav =>
      (nav.getAttribute("epub:type") ?? "").split(/\s+/).includes("toc"));
    const links = (toc ?? root.querySelector("nav") ?? root).querySelectorAll("a[href]");
    for (const link of Array.from(links)) {
      const reference = resolveReference(navigation.path, link.getAttribute("href") ?? "");
      const title = plainText(link.textContent);
      if (reference && title && !result.has(reference.path)) result.set(reference.path, title);
    }
  }
  const ncx = items.find(item => item.id === spineToc) ??
    items.find(item => item.mediaType === "application/x-dtbncx+xml");
  if (ncx && archive[ncx.path]) {
    const doc = parseXml(decode(archive[ncx.path]!), "the EPUB 2 table of contents");
    for (const point of elements(doc, "navPoint")) {
      const source = elements(point, "content")[0]?.getAttribute("src") ?? "";
      const title = plainText(elements(point, "navLabel")[0]?.textContent);
      const reference = resolveReference(ncx.path, source);
      if (reference && title && !result.has(reference.path)) result.set(reference.path, title);
    }
  }
  return result;
}

export async function parseEpub(
  bytes: ArrayBuffer | Uint8Array, sourceName: string, signal?: AbortSignal,
): Promise<EpubBook> {
  const archive = await readArchive(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), signal);
  checkCancelled(signal);
  const read = (path: string): string => {
    const data = archive[path];
    if (!data) throw new Error(`The EPUB is missing a required resource: ${path}.`);
    return decode(data);
  };
  if (archive.mimetype && read("mimetype").trim() !== "application/epub+zip") {
    throw new Error("This ZIP file is not an EPUB ebook.");
  }
  if (!archive["META-INF/container.xml"]) throw new Error("The EPUB is missing META-INF/container.xml.");
  const container = parseXml(read("META-INF/container.xml"), "container.xml");
  const roots = elements(container, "rootfile");
  const root = roots.find(item => item.getAttribute("media-type") === "application/oebps-package+xml") ?? roots[0];
  const rawPackagePath = root?.getAttribute("full-path");
  if (!rawPackagePath) throw new Error("The EPUB does not identify its book package.");
  const packagePath = normalizeArchivePath(decodeReference(rawPackagePath));
  const pkg = parseXml(read(packagePath), "the book package");
  const metadata = elements(pkg, "metadata")[0];
  const title = plainText(metadata && elements(metadata, "title")[0]?.textContent) ||
    sourceName.replace(/\.epub$/i, "") || "Untitled book";
  const authors = metadata ? elements(metadata, "creator").map(item => plainText(item.textContent)).filter(Boolean) : [];
  const optionalMetadata = (name: string) => plainText(metadata && elements(metadata, name)[0]?.textContent) || undefined;
  const manifest = elements(pkg, "manifest")[0];
  if (!manifest) throw new Error("The EPUB has no resource manifest.");
  const items: ManifestItem[] = elements(manifest, "item").map(item => {
    const reference = resolveReference(packagePath, item.getAttribute("href") ?? "");
    return {
      id: item.getAttribute("id") ?? "",
      path: reference?.path ?? "",
      mediaType: (item.getAttribute("media-type") ?? "").toLowerCase(),
      properties: (item.getAttribute("properties") ?? "").split(/\s+/),
      fallback: item.getAttribute("fallback") ?? undefined,
    };
  });
  const byId = new Map(items.map(item => [item.id, item]));
  const spine = elements(pkg, "spine")[0];
  if (!spine) throw new Error("The EPUB has no reading order (spine).");

  if (archive["META-INF/encryption.xml"]) {
    const encryption = parseXml(read("META-INF/encryption.xml"), "encryption.xml");
    const fontObfuscation = new Set(["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"]);
    for (const entry of elements(encryption, "EncryptedData")) {
      const algorithm = elements(entry, "EncryptionMethod")[0]?.getAttribute("Algorithm") ?? "";
      const uri = elements(entry, "CipherReference")[0]?.getAttribute("URI") ?? "";
      const encrypted = resolveReference("", uri);
      const resource = items.find(item => item.path === encrypted?.path);
      const isFont = resource && /font|opentype/i.test(resource.mediaType);
      if (!fontObfuscation.has(algorithm) || !isFont) {
        throw new Error("DRM-protected or encrypted EPUBs are not supported. Please use a DRM-free EPUB.");
      }
    }
  }

  const warnings: string[] = [];
  let titles: Map<string, string>;
  try { titles = navigationTitles(archive, items, spine.getAttribute("toc")); }
  catch { titles = new Map(); warnings.push("The table of contents could not be read; chapter headings were used instead."); }

  const chapters: EpubChapter[] = [];
  for (const reference of elements(spine, "itemref")) {
    checkCancelled(signal);
    if (reference.getAttribute("linear") === "no") continue;
    let item = byId.get(reference.getAttribute("idref") ?? "");
    const visited = new Set<string>();
    while (item && !HTML_TYPES.has(item.mediaType) && item.fallback && !visited.has(item.id)) {
      visited.add(item.id);
      item = byId.get(item.fallback);
    }
    if (!item) throw new Error("The EPUB reading order references a missing manifest item.");
    if (!HTML_TYPES.has(item.mediaType)) {
      throw new Error(`Unsupported chapter format: ${item.mediaType || "unknown"}. This importer needs HTML/XHTML chapters.`);
    }
    const html = read(item.path);
    const root = inertHtml(html);
    const chapterTitle = titles.get(item.path) || plainText(root.querySelector("h1, h2, h3")?.textContent) ||
      root.dataset.epubTitle || `Chapter ${chapters.length + 1}`;
    chapters.push({ path: item.path, title: chapterTitle, html });
  }
  if (!chapters.length) throw new Error("The EPUB does not contain any readable chapters.");

  const images: EpubImage[] = [];
  const imagePaths = new Set<string>();
  for (const item of items) {
    checkCancelled(signal);
    const extension = IMAGE_TYPES[item.mediaType];
    if (!extension || !item.path || imagePaths.has(item.path)) continue;
    const original = archive[item.path];
    if (!original) { warnings.push(`Missing image: ${item.path}`); continue; }
    try {
      const data = extension === "svg" ? new TextEncoder().encode(sanitizeSvg(decode(original))) : original;
      images.push({ path: item.path, extension, data });
      imagePaths.add(item.path);
    } catch { warnings.push(`Could not import SVG image: ${item.path}`); }
  }
  const coverId = metadata && elements(metadata, "meta").find(item => item.getAttribute("name") === "cover")?.getAttribute("content");
  const coverPath = items.find(item => item.properties.includes("cover-image"))?.path ??
    (coverId ? byId.get(coverId)?.path : undefined);
  return {
    metadata: { title, authors, language: optionalMetadata("language"), publisher: optionalMetadata("publisher"), identifier: optionalMetadata("identifier") },
    sourceName, chapters, images, coverPath, warnings,
  };
}
