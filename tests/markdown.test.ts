import { describe, expect, it } from "vitest";
import { createImportPlan } from "../src/markdown";
import type { EpubBook, ImportMode } from "../src/types";
import { testBook } from "./fixtures";

function noteText(book = testBook(), mode: ImportMode = "single"): string {
  return createImportPlan(book, { mode, destination: "Books" }).files
    .filter(file => typeof file.content === "string").map(file => file.content).join("\n");
}

function htmlBook(html: string): EpubBook {
  const book = testBook();
  return { ...book, chapters: [{ ...book.chapters[0]!, html }] };
}

describe("Markdown import plans", () => {
  it("puts every chapter in a single Markdown note with metadata and contents", () => {
    const plan = createImportPlan(testBook(), { mode: "single", destination: "Books" });
    const notes = plan.files.filter(file => typeof file.content === "string");
    expect(notes).toHaveLength(1);
    expect(plan.entryPath).toBe("Books/A Test Book.md");
    const text = notes[0]?.content as string;
    expect(text).toContain('title: "A Test Book"');
    expect(text).toContain('authors: ["Ada Reader","Sam Writer"]');
    expect(text).toContain("# A Test Book\n");
    expect(text).toContain("## Contents\n");
    expect(text).toContain("## Start\n");
    expect(text).toContain("## Finish\n");
    expect(text).toContain("Hello *reader*");
    expect(text).toMatch(/- +One\n- +Two/);
    expect(text).not.toContain("First document");
    expect(text.match(/^## Start$/gm)).toHaveLength(1);
    expect(text.indexOf("## Start")).toBeLessThan(text.indexOf("## Finish"));
  });

  it("creates numbered chapter notes, an index, and previous/next links", () => {
    const plan = createImportPlan(testBook(), { mode: "chapters", destination: "Library/Books" });
    const notes = plan.files.filter(file => typeof file.content === "string");
    expect(notes.map(file => file.path)).toEqual([
      "Library/Books/A Test Book/Book.md", "Library/Books/A Test Book/01 - Start.md", "Library/Books/A Test Book/02 - Finish.md",
    ]);
    expect(plan.entryPath).toBe("Library/Books/A Test Book/Book.md");
    expect(notes[0]?.content).toContain("[[Library/Books/A Test Book/01 - Start|Start]]");
    expect(notes[1]?.content).toContain("[[Library/Books/A Test Book/02 - Finish|Next →]]");
    expect(notes[2]?.content).toContain("[[Library/Books/A Test Book/01 - Start|← Previous]]");
    expect(notes[1]?.content).toContain('chapter: 1');
    expect(notes[1]?.content).not.toContain("The end.");
  });

  it("rewrites cross-chapter and fragment links for either layout", () => {
    const single = noteText();
    expect(single).toContain("[[Books/A Test Book#Details|jump]]");
    expect(single).toContain("[[Books/A Test Book#Start|back]]");
    const separate = noteText(testBook(), "chapters");
    expect(separate).toContain("[[Books/A Test Book/02 - Finish#Details|jump]]");
    expect(separate).toContain("[[Books/A Test Book/01 - Start#Start|back]]");
  });

  it("maps non-heading anchor targets to their containing section", () => {
    const book = htmlBook('<h1>Start</h1><h2>Notes</h2><p id="footnote">A footnote.</p><a href="#footnote">read note</a>');
    expect(noteText(book)).toContain("[[Books/A Test Book#Notes|read note]]");
  });

  it("uses unique headings when chapters and sections have duplicate names", () => {
    const book = testBook({ chapters: [
      { path: "one.xhtml", title: "Chapter", html: '<h1>Chapter</h1><h2 id="detail">Details</h2>' },
      { path: "two.xhtml", title: "Chapter", html: '<h1>Chapter</h1><h2 id="detail">Details</h2><a href="#detail">here</a>' },
    ] });
    const text = noteText(book);
    expect(text).toContain("## Chapter (2)");
    expect(text).toContain("#### Details (2)");
    expect(text).toContain("[[Books/A Test Book#Details (2)|here]]");
  });

  it("imports images into the right asset folder for both layouts", () => {
    const single = createImportPlan(testBook(), { mode: "single", destination: "Books" });
    expect(single.files[0]?.path).toBe("Books/A Test Book assets/0001 - cover.png");
    expect(single.files[1]?.content).toContain("![[Books/A Test Book assets/0001 - cover.png|A cover]]");
    const chapters = createImportPlan(testBook(), { mode: "chapters", destination: "Books" });
    expect(chapters.files[0]?.path).toBe("Books/A Test Book/_assets/0001 - cover.png");
  });

  it("understands SVG cover wrappers pointing to raster images", () => {
    const text = noteText(htmlBook('<svg xmlns="http://www.w3.org/2000/svg"><image xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="../images/cover.png"/></svg>'));
    expect(text).toContain("![[Books/A Test Book assets/0001 - cover.png|Illustration]]");
  });

  it("does not copy unused image files", () => {
    const book = testBook();
    book.images.push({ path: "unused.png", extension: "png", data: new Uint8Array([1]) });
    const plan = createImportPlan(book, { mode: "single", destination: "Books" });
    expect(plan.files.filter(file => typeof file.content !== "string")).toHaveLength(1);
  });

  it("never downloads remote images and keeps their alt text", () => {
    const book = htmlBook('<h1>Start</h1><img src="https://example.invalid/tracker.png" alt="Remote picture"/><img src="missing.png" alt="Missing"/>');
    const plan = createImportPlan(book, { mode: "single", destination: "Books" });
    const text = plan.files.at(-1)?.content as string;
    expect(text).toContain("[Image: Remote picture]");
    expect(text).not.toContain("example.invalid");
    expect(plan.warnings).toHaveLength(1);
  });

  it("strips active HTML, styles, unsafe links and raw attributes", () => {
    const text = noteText(htmlBook('<h1 onclick="evil()">Start</h1><script>badScript()</script><style>badStyle</style><iframe src="https://evil.invalid"></iframe><p style="color:red" onmouseover="evil()">Safe text. <a href="javascript:evil()">click</a></p><form>badForm</form>'));
    expect(text).toContain("Safe text. click");
    expect(text).not.toMatch(/evil|badScript|badStyle|badForm|iframe|onclick|javascript/);
  });

  it("preserves ordinary external hyperlinks without fetching them", () => {
    expect(noteText(htmlBook('<a href="https://example.org/a?b=1&amp;c=2">Example</a>'))).toContain("[Example](<https://example.org/a?b=1&c=2>)");
  });

  it("converts tables with headings, whitespace, pipes, and emphasis", () => {
    const text = noteText(htmlBook('<table>\n<thead>\n<tr>\n<th>Name</th>\n<th>Value</th>\n</tr>\n</thead><tbody><tr><td>A | B</td><td><strong>bold</strong></td></tr></tbody></table>'));
    expect(text).toContain("| Name |");
    expect(text).toContain("| --- | --- |");
    expect(text).toContain("A \\| B");
    expect(text).toContain("**bold**");
    expect(text).not.toContain("<table");
  });

  it("never keeps headerless tables as raw HTML that bypasses sanitization", () => {
    const text = noteText(htmlBook('<table><tr><td><a href="javascript:evil()">safe</a><img src="../images/cover.png" onerror="evil()"/></td></tr></table><table></table>'));
    expect(text).toContain("safe");
    expect(text).toContain("![[Books/A Test Book assets/0001 - cover.png");
    expect(text).not.toMatch(/javascript|onerror|<table|<img|data-epub/);
  });

  it("preserves quotes, code, superscripts, and strikethrough", () => {
    const text = noteText(htmlBook('<blockquote>Quote</blockquote><pre><code>const a = 1;</code></pre><p>x<sup>2</sup> <del>gone</del></p>'));
    expect(text).toContain("> Quote");
    expect(text).toContain("```\nconst a = 1;\n```");
    expect(text).toContain("x<sup>2</sup>");
    expect(text).toContain("~~gone~~");
  });

  it.each(["single", "chapters"] as const)("allocates a new name for existing books in %s mode", mode => {
    const paths = new Set(["Books/A Test Book.md", "Books/A Test Book (2)"]);
    const plan = createImportPlan(testBook(), { mode, destination: "Books" }, path => paths.has(path));
    expect(plan.entryPath).toContain("A Test Book (3)");
  });

  it("reserves an existing assets folder even when the note is absent", () => {
    const plan = createImportPlan(testBook(), { mode: "single", destination: "Books" }, path => path === "Books/A Test Book assets");
    expect(plan.entryPath).toBe("Books/A Test Book (2).md");
  });

  it("supports importing into the vault root", () => {
    expect(createImportPlan(testBook(), { mode: "single", destination: "" }).entryPath).toBe("A Test Book.md");
  });

  it("safely serializes multiline metadata to YAML-compatible JSON strings", () => {
    const book = testBook({ metadata: { title: 'Quoted "Title"\n---\nkey: bad', authors: ["One: Two"] } });
    const text = noteText(book);
    expect(text).toContain('title: "Quoted \\"Title\\"\\n---\\nkey: bad"');
    expect(text.match(/^---$/gm)).toHaveLength(3); // frontmatter delimiters + chapter separator
  });

  it("rejects unsafe destination paths before writing", () => {
    expect(() => createImportPlan(testBook(), { mode: "single", destination: "../outside" })).toThrow(/vault-relative/);
    expect(() => createImportPlan(testBook(), { mode: "single", destination: ".obsidian/plugins" })).toThrow(/vault-relative/);
  });
});
