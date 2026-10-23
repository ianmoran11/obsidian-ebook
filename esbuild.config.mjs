import * as esbuild from "esbuild";

const production = process.argv.includes("production");
const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian"],
  platform: "browser",
  format: "cjs",
  target: "es2018",
  outfile: "main.js",
  sourcemap: production ? false : "inline",
  minify: production,
  logLevel: "info",
  banner: { js: "/* EPUB Importer — bundled plugin. See LICENSE for licensing. */" },
});
if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
