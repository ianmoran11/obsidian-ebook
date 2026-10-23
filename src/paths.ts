const INVALID_FILENAME = /[\\/:*?"<>|#\[\]^\u0000-\u001f\u007f]/g;

export function safeFilename(value: string, fallback = "Untitled"): string {
  let result = value.normalize("NFC").replace(INVALID_FILENAME, " ")
    .replace(/\s+/g, " ").replace(/^[. ]+|[. ]+$/g, "");
  // Leave room for chapter numbering, suffixes and extensions on filesystems
  // with a 255-byte filename limit, without splitting Unicode code points.
  const encoder = new TextEncoder();
  let bytes = 0;
  result = Array.from(result).slice(0, 100).filter(character => {
    bytes += encoder.encode(character).length;
    return bytes <= 180;
  }).join("").trim().replace(/[. ]+$/g, "");
  if (!result) result = fallback;
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(result)) result = "_" + result;
  return result;
}

export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

export function parentPath(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

/** EPUB paths are ZIP paths, never filesystem paths. */
export function normalizeArchivePath(path: string): string {
  if (/^[\\/]|^[a-z][a-z0-9+.-]*:/i.test(path) || /[\\\u0000]/.test(path)) {
    throw new Error("The EPUB contains an unsafe resource path.");
  }
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("An EPUB resource points outside the book.");
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

export function decodeReference(value: string): string {
  try { return decodeURIComponent(value); }
  catch { return value; }
}

export function resolveReference(from: string, href: string): { path: string; fragment: string } | undefined {
  const value = href.trim();
  if (/^[a-z][a-z0-9+.-]*:|^[\\/]/i.test(value)) return undefined;
  const hash = value.indexOf("#");
  const fragment = hash < 0 ? "" : decodeReference(value.slice(hash + 1));
  const rawPath = (hash < 0 ? value : value.slice(0, hash)).split("?")[0] ?? "";
  const decodedPath = decodeReference(rawPath);
  if (/^[a-z][a-z0-9+.-]*:|^[\\/]/i.test(decodedPath)) return undefined;
  try {
    return {
      path: rawPath ? normalizeArchivePath(joinPath(parentPath(from), decodedPath)) : from,
      fragment,
    };
  } catch { return undefined; }
}

export function destinationPath(value: string): string {
  const path = value.trim().replace(/\/$/, "");
  if (!path) return "";
  if (path.startsWith("/") || path.split("/").some(part =>
    !part || part === "." || part === ".." || part.startsWith(".") ||
    /[\\:*?"<>|#\[\]^\u0000-\u001f]/.test(part) || /[. ]$/.test(part) ||
    /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) {
    throw new Error("Choose a vault-relative folder such as Books or Library/Books (no hidden folders or ..).");
  }
  return path;
}
