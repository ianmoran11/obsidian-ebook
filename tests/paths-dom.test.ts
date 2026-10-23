import { describe, expect, it } from "vitest";
import { inertHtml, sanitizeSvg } from "../src/dom";
import { destinationPath, normalizeArchivePath, resolveReference, safeFilename } from "../src/paths";

describe("portable and safe paths", () => {
  it("sanitizes filenames for Obsidian and common operating systems", () => {
    expect(safeFilename(' A/B:C*D?"E<F>G|H#I[J]^K. ')).toBe("A B C D E F G H I J K");
    expect(safeFilename("CON")).toBe("_CON");
    expect(safeFilename("nul.txt")).toBe("_nul.txt");
    expect(safeFilename("...", "Book")).toBe("Book");
    expect(safeFilename("Café 日本語")).toBe("Café 日本語");
    const emojiName = safeFilename("📖".repeat(120));
    expect(new TextEncoder().encode(emojiName).length).toBeLessThanOrEqual(180);
    expect(emojiName).toBe("📖".repeat(45));
  });

  it("normalizes relative archive paths without escaping the archive", () => {
    expect(normalizeArchivePath("OEBPS/text/../images/one.png")).toBe("OEBPS/images/one.png");
    expect(() => normalizeArchivePath("../../one.png")).toThrow(/outside/);
    expect(() => normalizeArchivePath("/one.png")).toThrow(/unsafe/);
    expect(() => normalizeArchivePath("C:\\one.png")).toThrow(/unsafe/);
  });

  it("resolves encoded names and fragments without confusing encoded # characters", () => {
    expect(resolveReference("OEBPS/one.xhtml", "text/a%23b.xhtml#hello%20world")).toEqual({ path: "OEBPS/text/a#b.xhtml", fragment: "hello world" });
    expect(resolveReference("OEBPS/one.xhtml", "#local")).toEqual({ path: "OEBPS/one.xhtml", fragment: "local" });
    expect(resolveReference("OEBPS/one.xhtml", "two.xhtml?query=true#end")).toEqual({ path: "OEBPS/two.xhtml", fragment: "end" });
  });

  it.each(["https://example.org/a", "//example.org/a", "javascript:evil()", "file:///etc/passwd", "../../outside", "%2fetc/passwd", "%2e%2e/%2e%2e/outside"])("rejects external or unsafe resource references: %s", href => {
    expect(resolveReference("OEBPS/one.xhtml", href)).toBeUndefined();
  });

  it("validates vault-relative destination folders", () => {
    expect(destinationPath(" Library/Books/ ")).toBe("Library/Books");
    expect(destinationPath(" ")).toBe("");
    for (const value of ["/Books", "../Books", ".obsidian", "Books/.hidden", "Books//New", "Books\\New", "Book#1", "NUL", "Books. "]) {
      expect(() => destinationPath(value)).toThrow(/vault-relative/);
    }
  });
});

describe("inert HTML and safe SVG handling", () => {
  it("stores image sources without any live src attributes", () => {
    const root = inertHtml('<h1>Title</h1><img src="https://tracker.invalid/pixel" onerror="bad()"/><svg><image href="https://tracker.invalid/other"/></svg>');
    expect(root.querySelectorAll("img")).toHaveLength(2);
    expect(root.querySelector("[src]")).toBeNull();
    expect(root.querySelector("[onerror]")).toBeNull();
    expect(root.querySelector("img")?.getAttribute("data-epub-src")).toBe("https://tracker.invalid/pixel");
  });

  it("removes active SVG, external URLs, XML base changes, and event handlers", () => {
    const svg = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:base="https://evil.invalid/" onload="evil()">
      <script>evil()</script><foreignObject><p>unsafe</p></foreignObject><style>bad</style>
      <image href="https://evil.invalid/pixel"/><use xlink:href="https://evil.invalid/vector#x"/>
      <animate attributeName="href" to="https://evil.invalid"/>
      <rect style="fill:red" fill="url(https://evil.invalid/paint)" width="5" height="5"/>
      <use href="#local"/><rect id="local" fill="url(#paint)"/>
    </svg>`);
    expect(svg).not.toMatch(/evil|script|foreignObject|style|animate|unsafe/);
    expect(svg).toContain('href="#local"');
    expect(svg).toContain('fill="url(#paint)"');
    expect(svg).toContain('width="5"');
  });

  it("rejects invalid SVG documents", () => {
    expect(() => sanitizeSvg("<svg>")).toThrow(/invalid XML/);
    expect(() => sanitizeSvg("<html/>")).toThrow(/Invalid SVG/);
  });
});
