// Barcodes — scan a barcode, save it, show it later at the scanner.
// Everything is stored on this phone only (localStorage). Nothing is sent anywhere.

'use strict';

// Shown at the bottom of the main screen. Change both when you publish an update,
// and set VERSION in sw.js to match.
const APP_VERSION = 2;
const APP_DATE = '2026-11-07';

const STORAGE_KEY = 'barcode-cards-v1';
const COLORS = ['#1c71d8', '#26a269', '#e66100', '#c01c28', '#813d9c', '#865e3c', '#3d3846', '#0f9a9a'];

// Barcode types the app can draw. "id" is the name the drawing library (bwip-js) uses.
const FORMATS = [
  { id: 'code128', label: 'Code 128 (most cards)' },
  { id: 'qrcode', label: 'QR code', square: true },
  { id: 'ean13', label: 'EAN-13 (shop products)' },
  { id: 'upca', label: 'UPC-A (shop products)' },
  { id: 'code39', label: 'Code 39' },
  { id: 'pdf417', label: 'PDF417 (tickets, IDs)' },
  { id: 'azteccode', label: 'Aztec (boarding passes)', square: true },
  { id: 'datamatrix', label: 'Data Matrix', square: true },
  { id: 'ean8', label: 'EAN-8' },
  { id: 'upce', label: 'UPC-E' },
  { id: 'code93', label: 'Code 93' },
  { id: 'interleaved2of5', label: 'ITF (Interleaved 2 of 5)' },
  { id: 'rationalizedCodabar', label: 'Codabar (libraries)' },
  { id: 'databaromni', label: 'GS1 DataBar' },
  { id: 'databarexpanded', label: 'GS1 DataBar Expanded' },
  { id: 'maxicode', label: 'MaxiCode', square: true },
];

// What the camera scanner (ZXing) calls each type → what the drawing library calls it.
const SCANNED_TO_FORMAT = {
  AZTEC: 'azteccode', CODABAR: 'rationalizedCodabar', CODE_39: 'code39', CODE_93: 'code93',
  CODE_128: 'code128', DATA_MATRIX: 'datamatrix', EAN_8: 'ean8', EAN_13: 'ean13',
  ITF: 'interleaved2of5', MAXICODE: 'maxicode', PDF_417: 'pdf417', QR_CODE: 'qrcode',
  RSS_14: 'databaromni', RSS_EXPANDED: 'databarexpanded', UPC_A: 'upca', UPC_E: 'upce',
};

const $ = (id) => document.getElementById(id);

// ---------- Saving and loading ----------

function loadCards() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCards(cards) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
    return true;
  } catch {
    toast('Couldn’t save — your phone may be out of storage.');
    return false;
  }
}

let cards = loadCards();

// Ask the browser to keep our data even when the phone is low on space.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ---------- Moving between screens ----------

const SCREENS = ['home', 'folder', 'scan', 'edit', 'show'];

function showScreen(name) {
  for (const s of SCREENS) $(s).hidden = s !== name;
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

// ---------- Drawing a barcode ----------

function formatInfo(id) {
  return FORMATS.find((f) => f.id === id) || FORMATS[0];
}

// Draws the barcode into `box`. Returns an error message, or '' if it worked.
function drawBarcode(box, text, formatId) {
  box.textContent = '';
  const info = formatInfo(formatId);
  box.classList.toggle('square', !!info.square);
  if (!text) {
    box.innerHTML = '<span class="placeholder">Enter a number to see the barcode</span>';
    return 'empty';
  }
  try {
    const options = {
      bcid: info.id,
      text,
      scale: 3,
      includetext: false,
      paddingwidth: 10,   // blank margin either side — scanners need it
      paddingheight: 6,
      backgroundcolor: 'FFFFFF',
    };
    if (!info.square && info.id !== 'pdf417') options.height = 22; // bar height in mm for 1-line barcodes
    const svg = bwipjs.toSVG(options);
    box.innerHTML = svg;
    return '';
  } catch (err) {
    box.innerHTML = '<span class="placeholder">Can’t draw this</span>';
    // bwip-js errors look like "bwipp.ean13badLength: EAN-13 must be 12 or 13 digits"
    const msg = String(err.message || err).replace(/^[\w.#]+:\s*/, '');
    return `This number doesn’t fit the ${info.label} type: ${msg}`;
  }
}

// ---------- Screen 1: the main list (favorites, folders, other cards) ----------

// The folder being looked at, or null on the main screen. New cards go into it,
// and "back" from a card returns to it.
let openFolder = null;

// Folders aren't stored separately — a folder exists while any card is in it.
function folderNames() {
  const names = new Set(cards.map((c) => c.folder).filter(Boolean));
  return [...names].sort((a, b) => a.localeCompare(b));
}

function cardButton(card) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.className = 'card';
  btn.type = 'button';
  btn.style.background = card.color;
  const name = document.createElement('span');
  name.textContent = card.name;
  const sub = document.createElement('small');
  sub.textContent = card.text;
  name.appendChild(sub);
  btn.appendChild(name);
  if (card.favorite) {
    const star = document.createElement('span');
    star.className = 'star';
    star.textContent = '★';
    star.setAttribute('aria-label', 'Favorite');
    btn.appendChild(star);
  }
  btn.addEventListener('click', () => openCard(card.id));
  li.appendChild(btn);
  return li;
}

function fillList(list, someCards) {
  list.textContent = '';
  for (const card of someCards) list.appendChild(cardButton(card));
}

function renderList() {
  const favorites = cards.filter((c) => c.favorite);
  const folders = folderNames();
  // Favorites already show at the top, so don't list them twice on this screen.
  const others = cards.filter((c) => !c.folder && !c.favorite);

  $('empty').hidden = cards.length > 0;
  $('fav-section').hidden = favorites.length === 0;
  $('folder-section').hidden = folders.length === 0;
  $('other-section').hidden = others.length === 0;
  // With nothing else on screen, the "Other cards" heading would just be clutter.
  $('other-title').hidden = favorites.length === 0 && folders.length === 0;

  fillList($('fav-list'), favorites);
  fillList($('other-list'), others);

  const folderList = $('folder-list');
  folderList.textContent = '';
  for (const name of folders) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'folder-row';
    btn.type = 'button';
    const label = document.createElement('span');
    label.className = 'folder-name';
    label.textContent = name;
    const count = document.createElement('span');
    count.className = 'folder-count';
    count.textContent = `${cards.filter((c) => c.folder === name).length} ›`;
    btn.append(label, count);
    btn.addEventListener('click', () => openFolderView(name));
    li.appendChild(btn);
    folderList.appendChild(li);
  }

  if (openFolder) renderFolder();
}

function goHome() {
  openFolder = null;
  renderList();
  showScreen('home');
}

const dateParts = APP_DATE.split('-').map(Number);
$('version').textContent = `Version ${APP_VERSION} · ` +
  new Date(dateParts[0], dateParts[1] - 1, dateParts[2])
    .toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

$('add-button').addEventListener('click', startScan);

// ---------- Screen 1b: inside a folder ----------

function openFolderView(name) {
  openFolder = name;
  if (!renderFolder()) return;
  showScreen('folder');
}

// Returns false (and goes home) if the folder has no cards left.
function renderFolder() {
  const inFolder = cards.filter((c) => c.folder === openFolder);
  if (inFolder.length === 0) { goHome(); return false; }
  $('folder-name').textContent = openFolder;
  fillList($('folder-cards'), inFolder);
  return true;
}

$('folder-back').addEventListener('click', goHome);
$('folder-add').addEventListener('click', startScan);

$('folder-rename').addEventListener('click', () => {
  const newName = (prompt('Rename folder', openFolder) || '').trim();
  if (!newName || newName === openFolder) return;
  const merging = folderNames().includes(newName);
  for (const c of cards) if (c.folder === openFolder) c.folder = newName;
  saveCards(cards);
  if (merging) toast(`Moved into the existing “${newName}” folder`);
  openFolderView(newName);
  renderList();
});

$('folder-delete').addEventListener('click', () => {
  const inFolder = cards.filter((c) => c.folder === openFolder);
  const n = inFolder.length;
  if (!confirm(`Delete the folder “${openFolder}”?\n\nIts ${n} card${n === 1 ? '' : 's'} won’t be deleted — they move to Other cards.`)) return;
  for (const c of inFolder) c.folder = '';
  saveCards(cards);
  toast(`Folder deleted — cards kept`);
  goHome();
});

// ---------- Screen 2: scanning ----------

let reader = null;

async function startScan() {
  showScreen('scan');
  $('scan-message').textContent = 'Point the camera at the barcode.';

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('scan-message').textContent =
      'The camera isn’t available here. (On iPhone it only works from the https:// web address.) ' +
      'You can type the number in instead.';
    return;
  }

  const hints = new Map();
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  const thisReader = new ZXing.BrowserMultiFormatReader(hints);
  reader = thisReader;

  try {
    await thisReader.decodeFromConstraints(
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } } },
      $('video'),
      (result) => {
        if (!result) return; // nothing found in this frame yet — keep looking
        if (reader !== thisReader) return; // scanning was already cancelled
        const scannedType = ZXing.BarcodeFormat[result.getBarcodeFormat()];
        stopScan();
        if (navigator.vibrate) navigator.vibrate(60);
        openEditor(null, {
          text: result.getText(),
          format: SCANNED_TO_FORMAT[scannedType] || 'code128',
        });
      },
    );
  } catch (err) {
    if (reader !== thisReader) return;
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    $('scan-message').textContent = denied
      ? 'Camera permission was turned down. To allow it, go to Settings → Safari → Camera, or type the number in instead.'
      : 'Couldn’t start the camera (' + (err && err.message || err) + '). You can type the number in instead.';
  }
}

function stopScan() {
  if (reader) {
    reader.reset(); // turns the camera off
    reader = null;
  }
}

$('scan-cancel').addEventListener('click', () => {
  stopScan();
  showScreen(openFolder ? 'folder' : 'home');
});
$('type-instead').addEventListener('click', () => { stopScan(); openEditor(null, { text: '', format: 'code128' }); });

// ---------- Screen 3: name it and save ----------

let editingId = null;   // null = a new card
let chosenColor = COLORS[0];

// Fill the barcode-type menu and colour circles once.
for (const f of FORMATS) {
  const opt = document.createElement('option');
  opt.value = f.id;
  opt.textContent = f.label;
  $('f-format').appendChild(opt);
}
for (const c of COLORS) {
  const sw = document.createElement('button');
  sw.type = 'button';
  sw.className = 'swatch';
  sw.style.background = c;
  sw.dataset.color = c;
  sw.setAttribute('aria-label', 'Colour');
  sw.addEventListener('click', () => pickColor(c));
  $('f-colors').appendChild(sw);
}

function pickColor(c) {
  chosenColor = c;
  for (const sw of $('f-colors').children) sw.setAttribute('aria-pressed', String(sw.dataset.color === c));
}

const NEW_FOLDER = '\u0000new'; // menu value for "＋ New folder…"
let folderChoice = '';

function fillFolderMenu(selected) {
  const menu = $('f-folder');
  menu.textContent = '';
  const names = folderNames();
  if (selected && !names.includes(selected)) names.push(selected);
  for (const [value, label] of [['', 'No folder'], ...names.map((n) => [n, n]), [NEW_FOLDER, '＋ New folder…']]) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    menu.appendChild(opt);
  }
  menu.value = selected;
  folderChoice = selected;
}

$('f-folder').addEventListener('change', () => {
  if ($('f-folder').value !== NEW_FOLDER) { folderChoice = $('f-folder').value; return; }
  const name = (prompt('New folder name') || '').trim();
  fillFolderMenu(name || folderChoice); // cancelled → back to what was chosen before
});

function openEditor(id, fresh) {
  editingId = id;
  const card = id ? cards.find((c) => c.id === id) : null;
  $('edit-title').textContent = card ? 'Edit card' : 'New card';
  $('f-name').value = card ? card.name : '';
  $('f-text').value = card ? card.text : fresh.text;
  $('f-format').value = card ? card.format : fresh.format;
  fillFolderMenu(card ? card.folder || '' : openFolder || '');
  $('f-favorite').checked = card ? !!card.favorite : false;
  pickColor(card ? card.color : COLORS[cards.length % COLORS.length]);
  $('edit-delete').hidden = !card;
  updatePreview();
  showScreen('edit');
  // A freshly scanned card only needs a name; a typed one needs the number first.
  if (!card) (fresh.text ? $('f-name') : $('f-text')).focus();
}

function updatePreview() {
  const err = drawBarcode($('edit-preview'), $('f-text').value.trim(), $('f-format').value);
  $('edit-error').hidden = !err || err === 'empty';
  $('edit-error').textContent = err === 'empty' ? '' : err;
  return err;
}

$('f-text').addEventListener('input', updatePreview);
$('f-format').addEventListener('change', updatePreview);

function saveEdit() {
  const name = $('f-name').value.trim();
  const text = $('f-text').value.trim();
  if (!name) { toast('Give the card a name first.'); $('f-name').focus(); return; }
  if (!text) { toast('Enter the number first.'); $('f-text').focus(); return; }
  if (updatePreview()) { toast('Fix the number or pick another barcode type.'); return; }

  const fields = {
    name, text, format: $('f-format').value, color: chosenColor,
    folder: folderChoice, favorite: $('f-favorite').checked,
  };
  if (editingId) {
    Object.assign(cards.find((c) => c.id === editingId), fields);
  } else {
    editingId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    cards.push({ id: editingId, ...fields, created: new Date().toISOString() });
  }
  if (!saveCards(cards)) return;
  renderList();
  openCard(editingId);
}

$('edit-save').addEventListener('click', saveEdit);
$('edit-form').addEventListener('submit', (e) => { e.preventDefault(); saveEdit(); });
$('edit-cancel').addEventListener('click', () => {
  if (editingId) openCard(editingId); else showScreen(openFolder ? 'folder' : 'home');
});
$('edit-delete').addEventListener('click', () => {
  const card = cards.find((c) => c.id === editingId);
  if (!card || !confirm(`Delete “${card.name}”? This can’t be undone.`)) return;
  cards = cards.filter((c) => c.id !== editingId);
  saveCards(cards);
  renderList();
  showScreen(openFolder ? 'folder' : 'home'); // renderList already went home if the folder emptied
  toast(`Deleted ${card.name}`);
});

// ---------- Screen 4: show it at the scanner ----------

let shownId = null;
let wakeLock = null;

function openCard(id) {
  const card = cards.find((c) => c.id === id);
  if (!card) { showScreen('home'); return; }
  shownId = id;
  // A card opened from a folder goes back to that folder; if it has since moved out, go to the main list.
  if (openFolder && card.folder !== openFolder) openFolder = null;
  $('show-back').textContent = `‹ ${openFolder || 'Cards'}`;
  $('show-name').textContent = card.name;
  $('show-text').textContent = card.text;
  showFavorite(card);
  drawBarcode($('show-barcode'), card.text, card.format);
  showScreen('show');
  keepScreenOn();
}

function showFavorite(card) {
  $('show-fav').textContent = card.favorite ? '★ In Favorites' : '☆ Add to Favorites';
  $('show-fav').setAttribute('aria-pressed', String(!!card.favorite));
}

$('show-fav').addEventListener('click', () => {
  const card = cards.find((c) => c.id === shownId);
  if (!card) return;
  card.favorite = !card.favorite;
  saveCards(cards);
  showFavorite(card);
  renderList();
});

// Stops the phone's screen going dark while you're waiting in line.
async function keepScreenOn() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* not supported — fine */ }
}

function letScreenSleep() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}

// The phone drops the wake lock when the app goes to the background; take it again on return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('show').hidden) keepScreenOn();
});

$('show-back').addEventListener('click', () => {
  letScreenSleep();
  if (openFolder) openFolderView(openFolder); else goHome();
});
$('show-edit').addEventListener('click', () => { letScreenSleep(); openEditor(shownId); });

// ---------- Start ----------

renderList();
showScreen('home');

// Lets the app open with no internet connection (see sw.js).
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
