export type ImportMode = "single" | "chapters";

export interface BookMetadata {
  title: string;
  authors: string[];
  language?: string;
  publisher?: string;
  identifier?: string;
}

export interface EpubChapter {
  path: string;
  title: string;
  html: string;
}

export interface EpubImage {
  path: string;
  extension: string;
  data: Uint8Array;
}

export interface EpubBook {
  metadata: BookMetadata;
  sourceName: string;
  chapters: EpubChapter[];
  images: EpubImage[];
  coverPath?: string;
  warnings: string[];
}

export interface ImportOptions {
  mode: ImportMode;
  destination: string;
}

export interface ImportPlan {
  entryPath: string;
  files: { path: string; content: string | Uint8Array }[];
  warnings: string[];
}

/** A small vault boundary keeps parsing and importing independent of Obsidian. */
export interface VaultAccess {
  kind(path: string): "file" | "folder" | undefined;
  mkdir(path: string): Promise<void>;
  writeText(path: string, content: string): Promise<void>;
  writeBinary(path: string, content: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  children(path: string): string[];
}

export type Progress = (message: string) => void;

export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("Import cancelled.");
    error.name = "AbortError";
    throw error;
  }
}
