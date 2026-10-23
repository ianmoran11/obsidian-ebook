# Changelog

## 1.0.2

- Fix the import button ignoring clicks after selecting a file. Obsidian checks `ButtonComponent.disabled` separately from the HTML button state; the importer now consistently uses the component’s `setDisabled()` API.
- Fix the test stand-in to reproduce Obsidian’s actual disabled-state click guard, so this failure is covered by the dialog integration tests.
- Add coverage for clearing and reselecting files. Verify both layouts end-to-end in desktop Obsidian with a multi-megabyte EPUB, including saved notes, local images, and link targets.

## 1.0.1

- Replace worker-based ZIP extraction with bounded, cooperative streaming extraction. Large entries no longer wait indefinitely when an Android WebView blocks Blob Web Workers.
- Read selected EPUBs using FileReader for Android document-provider compatibility, with cancellation and a 60-second timeout for stalled reads.
- Show immediate import feedback and unpacking progress. Catch startup failures inside the normal error handler.
- Keep a stalled preferences write from blocking the book import.
- Add browser-build regressions for blocked/missing workers and tests for file-reader failures, cancellation, timeouts, streamed ZIPs, and extraction-size checks.

## 1.0.0

- Initial EPUB-to-Markdown importer with single-note and separate-chapter layouts, local images, metadata, contents links, and chapter navigation.
- Non-overwriting vault writes with rollback for incomplete imports.
- Public GitHub releases with BRAT-compatible assets and automated release publishing.
