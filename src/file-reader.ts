import { checkCancelled } from "./types";

const READ_TIMEOUT_MS = 60000;

function cancelled(): Error {
  const error = new Error("Import cancelled.");
  error.name = "AbortError";
  return error;
}

/** Bound read-only operations so a phone's file provider cannot hold the import lock forever. */
export async function readSourceBytes(
  read: () => Promise<ArrayBuffer>, signal?: AbortSignal,
  timeoutMs = READ_TIMEOUT_MS, cancelRead?: () => void,
): Promise<ArrayBuffer> {
  checkCancelled(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, data?: ArrayBuffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error !== undefined) reject(error);
      else resolve(data!);
    };
    const fail = (error: unknown) => finish(error ?? new Error("The selected EPUB could not be read."));
    const stop = (error: Error) => {
      finish(error);
      try { cancelRead?.(); } catch { /* Preserve the original cancellation/read error. */ }
    };
    const abort = () => stop(cancelled());
    const timer = setTimeout(() => stop(new Error(
      "Reading the EPUB timed out. On Android, download the file to this device (for example, Downloads), then select it again.",
    )), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      read().then(data => finish(undefined, data), fail);
    } catch (error) { fail(error); }
  });
}

/** FileReader works with Android document-provider Files, including older WebViews. */
export async function readEpubFile(file: File, signal?: AbortSignal, timeoutMs = READ_TIMEOUT_MS): Promise<ArrayBuffer> {
  checkCancelled(signal);
  const reader = new FileReader();
  try {
    return await readSourceBytes(() => new Promise<ArrayBuffer>((resolve, reject) => {
      reader.onload = () => {
        if (reader.result === null || typeof reader.result === "string") {
          reject(new Error("The selected EPUB could not be read as a binary file."));
        } else resolve(reader.result);
      };
      reader.onerror = () => reject(new Error(
        "Could not read the selected EPUB. On Android, save it to Downloads first, then select it again.",
      ));
      reader.onabort = () => reject(cancelled());
      reader.readAsArrayBuffer(file);
    }), signal, timeoutMs, () => {
      if (reader.readyState === FileReader.LOADING) reader.abort();
    });
  } finally {
    reader.onload = reader.onerror = reader.onabort = null;
  }
}
