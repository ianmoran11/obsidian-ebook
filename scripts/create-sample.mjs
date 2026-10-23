import { mkdir, writeFile } from "node:fs/promises";
import { strToU8, zipSync } from "fflate";

// Original, redistributable sample content for trying both import layouts.
const files = {
  mimetype: "application/epub+zip",
  "META-INF/container.xml": `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  "EPUB/book.opf": `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>A Little EPUB</dc:title><dc:creator>Example Author</dc:creator><dc:language>en</dc:language><dc:identifier id="id">urn:uuid:5f3a2166-e374-4e5b-836b-d6a2f550896f</dc:identifier><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata>
    <manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="picture" href="picture.svg" media-type="image/svg+xml"/></manifest>
    <spine><itemref idref="one"/><itemref idref="two"/></spine></package>`,
  "EPUB/nav.xhtml": `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><title>Contents</title></head><body><nav epub:type="toc"><h1>Contents</h1><ol><li><a href="one.xhtml">A New Shelf</a></li><li><a href="two.xhtml">Room for Notes</a></li></ol></nav></body></html>`,
  "EPUB/one.xhtml": `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head><title>A New Shelf</title></head><body><h1 id="shelf">A New Shelf</h1><p>A book does not need a heavy cover to feel at home. Sometimes, all it needs is a place among your notes.</p><p>This sample demonstrates <em>emphasis</em>, <strong>strong text</strong>, and a local illustration.</p><img src="picture.svg" alt="A small blue book"/><p>Continue to <a href="two.xhtml#ideas">the ideas in the next chapter</a>.</p></body></html>`,
  "EPUB/two.xhtml": `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head><title>Room for Notes</title></head><body><h1>Room for Notes</h1><h2 id="ideas">Ideas to Keep</h2><ul><li>Link a passage to another note.</li><li>Add your own reflections.</li><li>Make the book part of your vault.</li></ul><blockquote><p>A useful book begins another conversation.</p></blockquote><p>Return to <a href="one.xhtml#shelf">the first chapter</a>.</p></body></html>`,
  "EPUB/picture.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160"><rect width="240" height="160" rx="12" fill="#edf4ff"/><rect x="65" y="25" width="110" height="110" rx="5" fill="#4066b0"/><path d="M80 25v110" stroke="#28467f" stroke-width="5"/><path d="M100 55h50M100 70h40" stroke="white" stroke-width="5"/></svg>`,
};
const archive = Object.fromEntries(Object.entries(files).map(([path, text]) => [path,
  [strToU8(text), { level: path === "mimetype" ? 0 : 6 }],
]));
await mkdir("examples", { recursive: true });
const target = "examples/A Little EPUB.epub";
await writeFile(target, zipSync(archive));
console.log(`Created ${target}`);
