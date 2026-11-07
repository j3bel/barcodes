# Barcodes — project notes

A Home Screen web app (PWA) for iPhone: scan a barcode with the camera, save it,
show it full-screen at a scanner later. Hosted free on GitHub Pages from the
`main` branch of github.com/j3bel/barcodes → https://j3bel.github.io/barcodes/

The owner is a complete beginner to app-making: explain steps plainly, suggest
`! command` for anything they must run themselves, and keep the code simple.

- **Look: "Wallet"** (chosen by the owner from a design canvas, 2026-11-07): always dark,
  cards stacked like plastic cards (66px strips, last one in full), chips filter All /
  Favorites / each folder, orange accent `#ffb340`. Fonts Space Grotesk + JetBrains Mono,
  self-hosted in `fonts/` (OFL) so it works offline. Card colours are the deep set in
  `COLORS`; pre-v6 bright colours are mapped by `OLD_COLORS` on load / restore / share.
- Icon (v7): teal `#258594`, a blue card peeking behind a white barcode card — the owner's
  own tweak of option A on the design canvas. `icons/icon.svg` is the source; PNGs are
  rendered from it with `rsvg-convert`.
- Motion (v7): opening/closing a card uses a View Transition (`view-transition-name:
  open-card`, set on the tapped stack card only for the moment of capture; `#show-card`
  carries it in CSS); cards "deal" in (`.stack.deal`, only on load / chip change, never on
  search typing); star pop; toast slide. All off under Reduce Motion; without View
  Transitions support it just switches screens.
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
- Folders aren't stored; a folder exists while a card has that `folder` name. Their order
  is `barcode-folder-order` (folders missing from it sort last, A–Z); backups carry it as
  `folderOrder`. Card order is the order of the `cards` array; reordering a filtered list
  (favorites, a folder) writes the new order back into those cards' existing slots.
- Reorder mode shows a flat list (`#reorder-list`) of the current chip's cards, plus folder
  order when on All. Drag = pointer events on `.handle` (`touch-action: none`), followed on
  `document` by pointer id — moving the node drops pointer capture, so never rely on it.
  Test drags across several places, not just one. Search filters name, number and folder.
- Backup = JSON `{ app: 'Barcodes', backupFormat: 1, appVersion, created, cards }`, sent via
  the Share sheet on iPhone (download on computers). Restore only ever **adds** cards,
  skipping ones with the same id or same text+format — it never deletes or overwrites.
- Sharing: a card travels as `…/barcodes/#card=<base64url of {v:1,n,t,f,c}>` (the hash
  never reaches GitHub). iPhone opens links in Safari, whose storage is separate from the
  Home Screen app, so the shared-card page has "Copy card" and the app's Add screen has
  "Paste a shared card". An installed app opening the link goes straight to the editor.
  Shared: name, number, type, colour — not folder or favorite (the receiver's choice).
- Testing: drive headless Chromium over CDP from the scratchpad; a fake camera works with
  `--use-file-for-fake-video-capture=<barcode>.y4m`.
- Camera needs https on iPhone, so phone testing is done on the Pages URL.
- Why a web app and not native: owner is on Linux (no Xcode), and wanted it free
  and easy to share with family. Expo is the upgrade path if they want the App Store.
