# EPUB Importer for Obsidian

Import a DRM-free `.epub` ebook as **editable Markdown**, choosing the layout for each book:

- **One note:** every chapter in one note, with a linked contents list.
- **Separate notes:** a book folder with a contents/index note, numbered chapters, and previous/next navigation.

The plugin uses browser and Obsidian APIs, with no Electron or Node.js dependency at runtime, for **desktop and mobile** compatibility. Obsidian **1.5.0 or newer** is required. It is not yet published in the Community Plugins directory.

## Install

### From GitHub using BRAT (recommended)

1. Install and enable **BRAT** from Obsidian’s Community plugins directory.
2. Run **BRAT: Add a beta plugin for testing** from the command palette (or use **Add beta plugin** in BRAT settings).
3. Enter `ianmoran11/obsidian-ebook` or `https://github.com/ianmoran11/obsidian-ebook`.
4. Select the latest release if prompted and add the plugin. Enable **EPUB Importer** in **Settings → Community plugins** if BRAT did not enable it automatically.
5. Run **EPUB Importer: Import EPUB**.

BRAT installs and updates the plugin directly from its [GitHub releases](https://github.com/ianmoran11/obsidian-ebook/releases). Use BRAT’s update check for new releases. A GitHub token is not required for this public repository, except to avoid GitHub’s anonymous API rate limits.

Use a current BRAT version (release-asset installation requires BRAT 1.1.0+). BRAT itself may require a newer Obsidian version than this plugin’s minimum.

### Manual installation

Download `epub-importer-1.0.2.zip` from the [latest release](https://github.com/ianmoran11/obsidian-ebook/releases/latest), or build it locally with `npm run release` (`dist/epub-importer-1.0.2.zip`).

1. Extract the archive. It contains an `epub-importer` folder.
2. Copy that folder into `<your-vault>/.obsidian/plugins/`.
3. Restart Obsidian or reload community plugins.
4. Open **Settings → Community plugins**, enable community plugins if necessary, then enable **EPUB Importer**.

The resulting directory must contain the plugin files directly, not an extra nested folder:

```text
<your-vault>/.obsidian/plugins/epub-importer/
  main.js
  manifest.json
  styles.css
  LICENSE
  THIRD-PARTY-NOTICES.md
```

On mobile, copy or sync the same folder into the mobile vault's `.obsidian/plugins/` directory, then enable the plugin on that device. How hidden folders are accessed or synced depends on your file manager/sync provider. Do not replace your existing `.obsidian` folder.

## Import a book

1. Run **EPUB Importer: Import EPUB** in the command palette, or select the book icon in the ribbon.
2. Choose a `.epub` file using your device's file picker.
3. Select **One note — all chapters** or **Separate notes — book folder**.
4. Choose a vault-relative destination such as `Books` or `Library/Books`. Leave it empty to use the vault root.
5. Select **Import book**. The new book note or index opens when finished.

You can also right-click an EPUB already in your vault and choose **Import EPUB as Markdown**. Obsidian's “Detect all file extensions” setting may be needed to display EPUB attachments in its file explorer.

Try `examples/A Little EPUB.epub`, a small original sample with two chapters, an illustration, and cross-chapter links.

### Output examples

One note:

```text
Books/
  A Little EPUB.md
  A Little EPUB assets/
    0001 - picture.svg
```

Separate notes:

```text
Books/
  A Little EPUB/
    Book.md
    01 - A New Shelf.md
    02 - Room for Notes.md
    _assets/
      0001 - picture.svg
```

Image folders are only created when there are images to save. Files use vault-relative Obsidian links, so chapter links and image embeds work in either layout. Book notes include available title, authors, language, publisher, identifier, and source filename as frontmatter.

## Behavior and safety

- Reads EPUB 2 and EPUB 3 packages, including NCX and EPUB navigation titles.
- Preserves the book's **spine reading order**, rather than sorting filenames. Each linear HTML/XHTML spine document becomes a chapter; publishers that split a chapter across files will produce multiple chapter notes. Non-linear supplemental documents are not imported.
- Converts headings, emphasis, lists, blockquotes, code, and tables. Title headings are deduplicated; repeated section names get unique anchors.
- Rewrites links between imported chapters. Fragment links point to the target's nearest section heading, not necessarily the exact paragraph or footnote.
- Copies referenced PNG, JPEG, GIF, WebP, AVIF, BMP, and sanitized SVG images into the vault. Also recognizes common SVG cover wrappers pointing to raster images. Image display support depends on the Obsidian platform.
- Uses a new name such as `Book Title (2)` when a book note, folder, or assets folder already exists. **It does not overwrite existing notes.**
- Tracks newly created files and rolls them back on cancellation or failure. Existing folders and unrelated content are retained; cleanup failures report the affected paths.
- Cancelling or closing the import dialog cancels the operation and removes tracked incomplete files.
- Everything runs locally. No ebook is uploaded, and remote images are not downloaded. Scripts, event handlers, and unsafe links are removed. Ordinary external hyperlinks remain links.
- The original EPUB is not modified, copied, or deleted. Only converted notes and local images are stored.

### Limits

DRM/encrypted books, PDF/MOBI/AZW files, SVG-only spine documents, audio/video, embedded data-URL images, and pixel-perfect ebook styling are not supported. Pure inline SVG illustrations are reduced to text; standalone SVG image resources are supported. Missing, remote, or unsupported images keep their alt text and generate an import notice. Complex table layouts and CSS-driven formatting may need manual adjustment.

To limit memory use, EPUB files are capped at **100 MB compressed**, **32 MB per extracted file**, **256 MB extracted total**, and **10,000 ZIP entries**. Very large books may still be slow on mobile devices.

## Settings

**Settings → EPUB Importer** provides defaults for the destination folder, chapter layout, and whether to open the book after importing. The dialog can override the destination and layout for each import; successful validation saves these choices as the new defaults.

## Android import troubleshooting

Use BRAT to update to **1.0.2 or newer**. Version 1.0.2 fixes a button-state bug that made **Import book** look enabled while Obsidian still ignored clicks after file selection. The importer now updates Obsidian’s button component state, not just its HTML button.

ZIP extraction also avoids Blob Web Workers, which can be blocked by mobile WebViews. It streams the archive with progress updates and yields to keep the UI responsive while unpacking.

After tapping **Import book**, you should immediately see an importing notice, then **Reading EPUB file…** and **Unpacking EPUB…** progress. File reads are cancellable and time out after 60 seconds instead of leaving the import stuck forever. A stalled preferences write does not block the import.

If a file cannot be read, first save/download the EPUB to the phone’s **Downloads** folder and select that local copy instead of a cloud-provider placeholder. If the issue continues, report the last visible status, Obsidian version, and file size (and a reproducible EPUB if you can share one).

## Development

Use Node.js **22.13+ (22.x)** or **24+** and npm. The build toolchain runs on your computer; Node.js is not required inside Obsidian.

```sh
npm ci
npm test           # parser, conversion, vault rollback, and dialog integration tests
npm run build     # typecheck + production main.js
npm run release   # validate versions + build individual assets and ZIP in dist/
npm run sample    # regenerate examples/A Little EPUB.epub
npm run dev       # rebuild main.js when source files change
```

Copy `main.js`, `manifest.json`, and `styles.css` into a test vault's plugin folder while developing. Prefer a disposable test vault, not your primary vault.

### Publishing releases for BRAT

The repository-root `manifest.json` and `versions.json` are committed, but compiled `main.js` stays out of Git. BRAT gets the built files from GitHub release assets instead of the source tree or ZIP.

1. Update `package.json` and `manifest.json` to the same new semantic version. Add that version’s minimum Obsidian version to `versions.json`.
2. Run `npm install --package-lock-only` to update the lockfile, then `npm test` and `npm run release`.
3. Commit and push the changes to GitHub.
4. Create and push a matching tag **without a `v` prefix**, for example:

   ```sh
   git tag 1.0.3
   git push origin 1.0.3
   ```

`.github/workflows/release.yml` validates the tag against the manifests, installs dependencies, runs tests, builds the plugin, then publishes a GitHub release with the tag as its title. It uses the repository’s automatic `GITHUB_TOKEN`; no personal token or extra secret is needed. GitHub Actions must be enabled for the repository.

The workflow attaches **`main.js`, `manifest.json`, and `styles.css` as individual assets**—these are the filenames BRAT expects. It also attaches the ZIP and license notices for manual installation. It creates a draft first and only publishes after uploading all assets, so BRAT cannot see an incomplete release.

Tags such as `1.1.0-beta.1` are supported and marked as prereleases automatically. Stable tags are published as the latest stable release. Current BRAT can also install prereleases or a specific pinned release; no `manifest-beta.json` is needed. Publish new versions rather than replacing assets on an existing release.

See the [BRAT developer guide](https://github.com/TfTHacker/obsidian42-brat/blob/main/BRAT-DEVELOPER-GUIDE.md) for details.

### Source layout

- `src/epub.ts` — bounded ZIP extraction, EPUB package/metadata/spine/navigation parsing.
- `src/dom.ts` — inert HTML processing and SVG sanitization.
- `src/file-reader.ts` — Android-compatible file reading, cancellation, and timeouts.
- `src/markdown.ts` — output planning, conversion, assets, and link rewriting.
- `src/importer.ts` — non-overwriting vault writes and rollback.
- `src/main.ts` — Obsidian command, ribbon, context menu, dialog, and settings.
- `tests/` — generated EPUB fixtures, in-memory vault, and an Obsidian API stand-in for dialog tests.

Automated tests exercise the real parsing, conversion, write orchestration, and dialog logic. Browser-build regressions simulate missing/blocked Web Workers, and FileReader tests cover mobile read failures, cancellation, and timeouts. The dialog stand-in models Obsidian’s independent `ButtonComponent.disabled` flag: updating only the DOM attribute must not enable callbacks.

Version 1.0.2 was also tested in actual desktop Obsidian 1.14.4 with a multi-megabyte EPUB in both layouts. This exercised the real import dialog’s file-change and button handlers, Obsidian’s vault writes, and the resulting notes, images, and link targets. The private input book is not included in the repository. Native Android/iOS file-provider testing still requires those devices; automated host stand-ins are not a substitute.

### Manual acceptance checklist

On each target device, use a disposable vault:

1. Install from `ianmoran11/obsidian-ebook` through BRAT and enable the plugin. Confirm the import command and ribbon icon appear.
2. Open the import command with **no preselected file**, choose the sample EPUB through the file picker, and click **Import book** in **one-note** mode. Confirm the button actually starts the operation, then check chapter order, contents links, formatting, and the image.
3. Repeat file selection in **separate-notes** mode; confirm the index, chapter links, and previous/next navigation. Also clear and reselect the file to check that the button component is re-enabled.
4. Import again; confirm a suffixed name is used and the earlier import is unchanged.
5. Change defaults, reload Obsidian, and confirm they persist.
6. Try a damaged EPUB and an invalid destination; verify a useful error and no new book files.
7. Cancel an import; verify incomplete files are removed.
8. On iOS and Android, confirm the native file picker can select an EPUB and the chosen folder and mode work.

## License

MIT. Runtime dependencies are `fflate`, `turndown`, and `turndown-plugin-gfm`, also MIT-licensed. The release archive includes their license notices.
