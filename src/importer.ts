import { parentPath } from "./paths";
import { checkCancelled, type ImportPlan, type Progress, type VaultAccess } from "./types";

/**
 * Only newly created paths are tracked. On failure/cancellation, remove our
 * files and empty folders in reverse order; never overwrite existing content.
 */
export async function writeImportPlan(
  plan: ImportPlan, vault: VaultAccess, signal?: AbortSignal, progress?: Progress,
): Promise<void> {
  const createdFiles: string[] = [];
  const createdFolders: string[] = [];
  const ensureFolder = async (path: string): Promise<void> => {
    if (!path) return;
    const kind = vault.kind(path);
    if (kind === "folder") return;
    if (kind === "file") throw new Error(`A file already exists where a folder is needed: ${path}`);
    await ensureFolder(parentPath(path));
    checkCancelled(signal);
    try {
      await vault.mkdir(path);
      createdFolders.push(path);
    } catch (error) {
      // A sync client may have created this parent while we were waiting.
      if (vault.kind(path) !== "folder") throw error;
    }
  };
  try {
    for (const [index, file] of plan.files.entries()) {
      checkCancelled(signal);
      await ensureFolder(parentPath(file.path));
      if (vault.kind(file.path)) throw new Error(`Import stopped rather than overwrite: ${file.path}`);
      progress?.(`Saving ${index + 1} of ${plan.files.length}: ${file.path}`);
      if (typeof file.content === "string") await vault.writeText(file.path, file.content);
      else await vault.writeBinary(file.path, file.content);
      createdFiles.push(file.path);
    }
    checkCancelled(signal);
  } catch (error) {
    progress?.("Removing incomplete import…");
    const cleanupFailures: string[] = [];
    for (const path of [...createdFiles].reverse()) {
      try { await vault.remove(path); }
      catch { cleanupFailures.push(path); }
    }
    for (const path of [...createdFolders].reverse()) {
      try {
        if (vault.kind(path) === "folder" && !vault.children(path).length) await vault.remove(path);
      } catch { cleanupFailures.push(path); }
    }
    if (cleanupFailures.length) {
      throw new Error(`${error instanceof Error ? error.message : "Import failed."} Could not remove these incomplete paths: ${cleanupFailures.join(", ")}`);
    }
    throw error;
  }
}
