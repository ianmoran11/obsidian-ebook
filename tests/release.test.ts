import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { unzipSync } from "fflate";

const checkScript = resolve("scripts/check-release.mjs");
const packageScript = resolve("scripts/package.mjs");
let fixture: string;

function writeJson(name: string, value: unknown): void {
  writeFileSync(join(fixture, name), JSON.stringify(value));
}
function check(tag = "1.0.0") {
  return spawnSync(process.execPath, [checkScript, tag], { cwd: fixture, encoding: "utf8" });
}

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), "epub-release-"));
  writeJson("manifest.json", { id: "epub-importer", name: "EPUB Importer", version: "1.0.0", minAppVersion: "1.5.0" });
  writeJson("package.json", { version: "1.0.0" });
  writeJson("versions.json", { "1.0.0": "1.5.0" });
});
afterEach(() => rmSync(fixture, { recursive: true, force: true }));

describe("BRAT release metadata", () => {
  it("accepts matching tag, manifest, package, and minimum-version metadata", () => {
    const result = check();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Release metadata verified: epub-importer 1.0.0");
  });

  it("validates local metadata without requiring a tag argument", () => {
    const result = spawnSync(process.execPath, [checkScript], { cwd: fixture, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });

  it.each(["v1.0.0", "1.0", "1.0.0.0", "1.0.0+build", "01.0.0", "1.0.0-beta.01", "not-a-version"])("rejects incompatible tag %s", tag => {
    const result = check(tag);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("semantic version tag");
  });

  it("rejects a release tag that does not match the manifest", () => {
    const result = check("1.0.1");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must match manifest.json");
  });

  it("rejects mismatched package and manifest versions", () => {
    writeJson("package.json", { version: "2.0.0" });
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must match package.json");
  });

  it("rejects a missing or incorrect minimum-version mapping", () => {
    writeJson("versions.json", { "1.0.0": "1.4.0" });
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("versions.json must map 1.0.0 to 1.5.0");
  });

  it("accepts matching prerelease versions", () => {
    writeJson("manifest.json", { id: "epub-importer", name: "EPUB Importer", version: "1.1.0-beta.1", minAppVersion: "1.5.0" });
    writeJson("package.json", { version: "1.1.0-beta.1" });
    writeJson("versions.json", { "1.1.0-beta.1": "1.5.0" });
    const result = check("1.1.0-beta.1");
    expect(result.status, result.stderr).toBe(0);
  });
});

describe("BRAT release assets", () => {
  it("stages individual assets with the exact BRAT names and retains the manual-install ZIP", () => {
    const sourceFiles: Record<string, string> = {
      "main.js": "// fake compiled plugin for packaging test\nmodule.exports = {};\n",
      "styles.css": ".epub-importer { color: inherit; }\n",
      LICENSE: "MIT test license\n",
    };
    for (const [name, content] of Object.entries(sourceFiles)) writeFileSync(join(fixture, name), content);
    for (const dependency of ["fflate", "turndown", "turndown-plugin-gfm"]) {
      const folder = join(fixture, "node_modules", dependency);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "LICENSE"), `MIT license for ${dependency}\n`);
    }
    const result = spawnSync(process.execPath, [packageScript], { cwd: fixture, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    for (const name of ["main.js", "manifest.json", "styles.css", "LICENSE"]) {
      expect(readFileSync(join(fixture, "dist", name), "utf8")).toBe(readFileSync(join(fixture, name), "utf8"));
    }
    const archive = unzipSync(new Uint8Array(readFileSync(join(fixture, "dist", "epub-importer-1.0.0.zip"))));
    expect(Object.keys(archive).sort()).toEqual([
      "epub-importer/LICENSE", "epub-importer/THIRD-PARTY-NOTICES.md", "epub-importer/main.js", "epub-importer/manifest.json", "epub-importer/styles.css",
    ].sort());
    for (const name of ["main.js", "manifest.json", "styles.css", "LICENSE", "THIRD-PARTY-NOTICES.md"]) {
      expect(Buffer.from(archive["epub-importer/" + name]!)).toEqual(readFileSync(join(fixture, "dist", name)));
    }
  });
});
