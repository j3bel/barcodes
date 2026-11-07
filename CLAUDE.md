# Barcodes — project notes

A Home Screen web app (PWA) for iPhone: scan a barcode with the camera, save it,
show it full-screen at a scanner later. Hosted free on GitHub Pages from the
`main` branch of github.com/j3bel/barcodes → https://j3bel.github.io/barcodes/

The owner is a complete beginner to app-making: explain steps plainly, suggest
`! command` for anything they must run themselves, and keep the code simple.

- Plain HTML/CSS/JS, no build step, no npm. Files: `index.html`, `style.css`,
  `app.js`, `sw.js` (offline cache), `manifest.webmanifest`, `icons/`.
- Libraries are copied into `vendor/` (no CDN, so it works offline):
  ZXing 0.23.0 (scanning) and bwip-js 4.11.4 (drawing).
- Data lives in `localStorage` key `barcode-cards-v1` — on the phone only.
- **Every published change bumps the version in two places:** `APP_VERSION` / `APP_DATE`
  in `app.js` (shown on screen) and `VERSION` in `sw.js` (same number, `'vN'`), or phones
  keep the old copy. New files must also be added to `sw.js`'s `FILES` list.
- Cards: `{ id, name, text, format (bwip-js bcid), color, folder ('' = none), favorite, created }`.
  Older cards may lack `folder` / `favorite` — treat missing as ''/false.
- Folders aren't stored; a folder exists while a card has that `folder` name.
- Backup = JSON `{ app: 'Barcodes', backupFormat: 1, appVersion, created, cards }`, sent via
  the Share sheet on iPhone (download on computers). Restore only ever **adds** cards,
  skipping ones with the same id or same text+format — it never deletes or overwrites.
- Testing: drive headless Chromium over CDP from the scratchpad; a fake camera works with
  `--use-file-for-fake-video-capture=<barcode>.y4m`.
- Camera needs https on iPhone, so phone testing is done on the Pages URL.
- Why a web app and not native: owner is on Linux (no Xcode), and wanted it free
  and easy to share with family. Expo is the upgrade path if they want the App Store.
