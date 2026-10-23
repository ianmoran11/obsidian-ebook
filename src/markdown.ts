import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { inertHtml, plainText } from "./dom";
import { destinationPath, joinPath, resolveReference, safeFilename } from "./paths";
import type { EpubBook, EpubChapter, ImportOptions, ImportPlan } from "./types";

const HEADINGS = "h1, h2, h3, h4, h5, h6";

function markdownText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/([*_[\]<>\x60])/g, "\\$1");
}

function headingText(text: string): string {
  return plainText(text).replace(/[#|\[\]^]/g, "").trim() || "Untitled";
}

function wikiLabel(text: string): string {
  return plainText(text).replace(/[\[\]|]/g, " ").trim();
}

function wiki(path: string, heading: string | undefined, label: string): string {
  return `[[${path.replace(/\.md$/, "")}${heading ? "#" + heading : ""}|${wikiLabel(label)}]]`;
}

function imageWiki(path: string, alt: string): string {
  return `![[${path}|${wikiLabel(alt) || "Illustration"}]]`;
}

function uniqueHeading(text: string, used: Set<string>): string {
  const title = headingText(text);
  let candidate = title;
  let n = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${title} (${n++})`;
  used.add(candidate.toLowerCase());
  return candidate;
}

interface PreparedChapter {
  chapter: EpubChapter;
  root: HTMLElement;
  title: string;
  notePath: string;
  fragments: Map<string, string>;
}

function prepareChapter(chapter: EpubChapter, notePath: string, used: Set<string>): PreparedChapter {
  const title = uniqueHeading(chapter.title, used);
  const root = inertHtml(chapter.html);
  const headings = Array.from(root.querySelectorAll<HTMLElement>(HEADINGS));
  const first = headings[0];
  for (const heading of headings) {
    const text = plainText(heading.textContent);
    const isTitle = heading === first && headingText(text).toLowerCase() === headingText(chapter.title).toLowerCase();
    heading.dataset.epubHeading = isTitle ? title : uniqueHeading(text || "Section", used);
    if (isTitle || !text) heading.dataset.epubOmit = "true";
  }
  const fragments = new Map<string, string>();
  let currentHeading = title;
  for (const element of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    if (element.matches(HEADINGS)) currentHeading = element.dataset.epubHeading ?? title;
    const id = element.id || (element.tagName === "A" ? element.getAttribute("name") : "");
    if (id && !fragments.has(id)) {
      const nestedHeading = element.querySelector<HTMLElement>(HEADINGS);
      fragments.set(id, element.dataset.epubHeading ?? nestedHeading?.dataset.epubHeading ?? currentHeading);
    }
  }
  return { chapter, root, title, notePath, fragments };
}

function metadata(book: EpubBook): string {
  const values: Record<string, unknown> = {
    title: book.metadata.title,
    authors: book.metadata.authors,
    language: book.metadata.language,
    publisher: book.metadata.publisher,
    identifier: book.metadata.identifier,
    source: "epub",
    source_file: book.sourceName,
  };
  return frontmatter(values);
}

function frontmatter(values: Record<string, unknown>): string {
  return "---\n" + Object.entries(values).filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n") + "\n---\n\n";
}

export function createImportPlan(
  book: EpubBook, options: ImportOptions, exists: (path: string) => boolean = () => false,
): ImportPlan {
  if (!book.chapters.length) throw new Error("There are no chapters to import.");
  if (options.mode !== "single" && options.mode !== "chapters") throw new Error("Choose a valid chapter layout.");
  const destination = destinationPath(options.destination);
  const originalBase = safeFilename(book.metadata.title, "Untitled book");
  let base = originalBase;
  let suffix = 2;
  while ([joinPath(destination, base), joinPath(destination, base + ".md"), joinPath(destination, base + " assets")].some(exists)) {
    base = `${originalBase} (${suffix++})`;
  }
  const bookFolder = options.mode === "chapters" ? joinPath(destination, base) : destination;
  const entryPath = options.mode === "chapters" ? joinPath(bookFolder, "Book.md") : joinPath(destination, base + ".md");
  const assetsFolder = options.mode === "chapters" ? joinPath(bookFolder, "_assets") : joinPath(destination, base + " assets");
  const imagePaths = new Map(book.images.map((image, index) => {
    const basename = image.path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "image";
    return [image.path, joinPath(assetsFolder, `${String(index + 1).padStart(4, "0")} - ${safeFilename(basename)}.${image.extension}`)];
  }));
  const usedImages = new Set<string>();
  const warnings = new Set(book.warnings);
  const sharedHeadings = new Set([headingText(book.metadata.title).toLowerCase(), "contents"]);
  const digits = Math.max(2, String(book.chapters.length).length);
  const chapters = book.chapters.map((chapter, index) => {
    const path = options.mode === "single" ? entryPath :
      joinPath(bookFolder, `${String(index + 1).padStart(digits, "0")} - ${safeFilename(chapter.title)}.md`);
    return prepareChapter(chapter, path, options.mode === "single" ? sharedHeadings : new Set());
  });
  const targets = new Map<string, PreparedChapter>();
  for (const chapter of chapters) if (!targets.has(chapter.chapter.path)) targets.set(chapter.chapter.path, chapter);

  const convert = (prepared: PreparedChapter): string => {
    const service = new TurndownService({
      headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*",
    });
    service.use(gfm);
    // GFM otherwise keeps headerless tables as raw HTML, bypassing link/image
    // rewriting. Always convert them; supply an empty header when necessary.
    service.addRule("epubTables", {
      filter: "table",
      replacement: (content, node) => {
        const firstRow = (node as HTMLTableElement).rows[0];
        if (!firstRow || !firstRow.cells.length) return "";
        const isHeader = firstRow.parentElement?.tagName === "THEAD" ||
          Array.from(firstRow.cells).every(cell => cell.tagName === "TH");
        const blankHeader = "| " + Array.from(firstRow.cells, () => " ").join(" | ") + " |";
        const divider = "| " + Array.from(firstRow.cells, () => "---").join(" | ") + " |";
        const header = isHeader ? "" : blankHeader + "\n" + divider + "\n";
        return "\n\n" + header + content.trim().replace(/\n{2,}/g, "\n") + "\n\n";
      },
    });
    service.addRule("epubTableRows", {
      filter: "tr",
      replacement: (content, node) => {
        const row = node as HTMLTableRowElement;
        const firstRow = row.closest("table")?.rows[0];
        const isHeader = row === firstRow && (row.parentElement?.tagName === "THEAD" ||
          Array.from(row.cells).every(cell => cell.tagName === "TH"));
        const divider = isHeader ? "\n| " + Array.from(row.cells, () => "---").join(" | ") + " |" : "";
        return "\n" + content.trim().replace(/\n+/g, "") + divider + "\n";
      },
    });
    service.addRule("epubTableCells", {
      filter: ["th", "td"],
      replacement: (content, node) => {
        const cell = node as HTMLTableCellElement;
        return (cell.cellIndex === 0 ? "| " : " ") +
          content.trim().replace(/\|/g, "\\|").replace(/\n+/g, "<br>") + " |";
      },
    });
    service.addRule("epubStrikethrough", {
      filter: node => ["DEL", "S", "STRIKE"].includes(node.nodeName),
      replacement: content => "~~" + content + "~~",
    });
    service.addRule("epubHeadings", {
      filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
      replacement: (_content, node) => {
        const heading = node as HTMLElement;
        if (heading.dataset.epubOmit) return "";
        const level = Math.min(6, Number(heading.tagName.slice(1)) + (options.mode === "single" ? 2 : 1));
        return `\n\n${"#".repeat(level)} ${markdownText(heading.dataset.epubHeading ?? "Section")}\n\n`;
      },
    });
    service.addRule("epubLinks", {
      filter: "a",
      replacement: (content, node) => {
        const element = node as HTMLElement;
        const href = element.getAttribute("href")?.trim();
        if (!href) return content;
        if (/^(https?:\/\/|mailto:|tel:)/i.test(href)) {
          const destination = href.replace(/[<>\s]/g, char => encodeURIComponent(char));
          return `[${content || markdownText(href)}](<${destination}>)`;
        }
        const reference = resolveReference(prepared.chapter.path, href);
        if (!reference) return content;
        const target = reference.path === prepared.chapter.path ? prepared : targets.get(reference.path);
        if (!target) {
          warnings.add("Some internal links point to resources outside the imported reading order and were left as plain text.");
          return content;
        }
        const heading = reference.fragment ? target.fragments.get(reference.fragment) ?? target.title : target.title;
        return wiki(target.notePath, heading, plainText(element.textContent) || heading);
      },
    });
    service.addRule("epubImages", {
      filter: "img",
      replacement: (_content, node) => {
        const element = node as HTMLElement;
        const alt = element.getAttribute("alt") || "Illustration";
        const source = element.getAttribute("data-epub-src") ?? "";
        const reference = resolveReference(prepared.chapter.path, source);
        const path = reference && imagePaths.get(reference.path);
        if (!path) {
          warnings.add("Some images were missing, embedded, remote, or unsupported; their alt text was kept instead.");
          return `[Image: ${markdownText(alt)}]`;
        }
        usedImages.add(reference.path);
        return imageWiki(path, alt);
      },
    });
    service.addRule("safeSuperscript", {
      filter: ["sup", "sub"],
      replacement: (content, node) => `<${node.nodeName.toLowerCase()}>${content}</${node.nodeName.toLowerCase()}>`,
    });
    return service.turndown(prepared.root).trim();
  };

  const title = markdownText(headingText(book.metadata.title));
  const authorLine = book.metadata.authors.length ? `**Author${book.metadata.authors.length > 1 ? "s" : ""}:** ${markdownText(book.metadata.authors.join(", "))}\n\n` : "";
  let cover = "";
  const coverImage = book.coverPath && imagePaths.get(book.coverPath);
  if (coverImage && book.coverPath) {
    usedImages.add(book.coverPath);
    cover = imageWiki(coverImage, "Cover") + "\n\n";
  }
  const contents = chapters.map(chapter => "- " + wiki(chapter.notePath, options.mode === "single" ? chapter.title : undefined, chapter.title)).join("\n");
  const intro = metadata(book) + `# ${title}\n\n` + authorLine + cover + `## Contents\n\n${contents}\n`;
  const notes: ImportPlan["files"] = [];
  if (options.mode === "single") {
    const body = chapters.map(chapter => `## ${markdownText(chapter.title)}\n\n${convert(chapter)}`).join("\n\n---\n\n");
    notes.push({ path: entryPath, content: intro + "\n" + body + "\n" });
  } else {
    notes.push({ path: entryPath, content: intro });
    chapters.forEach((chapter, index) => {
      const previous = chapters[index - 1];
      const next = chapters[index + 1];
      const navigation = [
        previous && wiki(previous.notePath, undefined, "← Previous"),
        wiki(entryPath, undefined, "Book index"),
        next && wiki(next.notePath, undefined, "Next →"),
      ].filter(Boolean).join(" · ");
      notes.push({
        path: chapter.notePath,
        content: frontmatter({
          title: chapter.chapter.title, book: wiki(entryPath, undefined, book.metadata.title),
          chapter: index + 1, source: "epub", source_file: book.sourceName,
        }) + `# ${markdownText(chapter.title)}\n\n` +
          wiki(entryPath, undefined, "← Book index") + "\n\n" + convert(chapter) +
          "\n\n---\n\n" + navigation + "\n",
      });
    });
  }
  const images = book.images.filter(image => usedImages.has(image.path))
    .map(image => ({ path: imagePaths.get(image.path)!, content: image.data }));
  return { entryPath, files: [...images, ...notes], warnings: [...warnings] };
}
