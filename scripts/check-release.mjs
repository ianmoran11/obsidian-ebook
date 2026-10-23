import { readFile } from "node:fs/promises";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/;

async function main() {
  const [manifest, pkg, versions] = await Promise.all(
    ["manifest.json", "package.json", "versions.json"].map(async path => JSON.parse(await readFile(path, "utf8"))),
  );
  const tag = process.argv[2] ?? manifest.version;
  if (process.argv.length > 3) throw new Error("Usage: node scripts/check-release.mjs [release-tag]");
  if (typeof tag !== "string" || !SEMVER.test(tag)) {
    throw new Error("Use a semantic version tag such as 1.0.0 or 1.1.0-beta.1, without a v prefix or build metadata.");
  }
  if (manifest.version !== tag) throw new Error(`Release tag ${tag} must match manifest.json version ${manifest.version}.`);
  if (pkg.version !== tag) throw new Error(`Release tag ${tag} must match package.json version ${pkg.version}.`);
  if (!manifest.id || !manifest.name || !/^\d+\.\d+\.\d+$/.test(manifest.minAppVersion ?? "")) {
    throw new Error("manifest.json must include an id, name, and valid minAppVersion.");
  }
  if (versions[tag] !== manifest.minAppVersion) {
    throw new Error(`versions.json must map ${tag} to ${manifest.minAppVersion}.`);
  }
  console.log(`Release metadata verified: ${manifest.id} ${tag} (Obsidian ${manifest.minAppVersion}+).`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
