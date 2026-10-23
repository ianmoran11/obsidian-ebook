import { readFile, mkdir, writeFile } from "node:fs/promises";
import { zipSync } from "fflate";

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const files = {};
await mkdir("dist", { recursive: true });
for (const name of ["main.js", "manifest.json", "styles.css", "LICENSE"]) {
  const content = new Uint8Array(await readFile(name));
  files[manifest.id + "/" + name] = content;
  // BRAT downloads these individual assets; it does not install the ZIP.
  await writeFile(`dist/${name}`, content);
}
let notices = "# Third-party licenses\n\n";
for (const dependency of ["fflate", "turndown", "turndown-plugin-gfm"]) {
  const license = await readFile(`node_modules/${dependency}/LICENSE`, "utf8");
  notices += `## ${dependency}\n\n${license}\n\n`;
}
files[manifest.id + "/THIRD-PARTY-NOTICES.md"] = new TextEncoder().encode(notices);
await writeFile("dist/THIRD-PARTY-NOTICES.md", notices);
const target = `dist/${manifest.id}-${manifest.version}.zip`;
await writeFile(target, zipSync(files));
console.log(`Created ${target}`);
