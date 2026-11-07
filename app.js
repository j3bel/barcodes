// Barcodes — scan a barcode, save it, show it later at the scanner.
// Everything is stored on this phone only (localStorage). Nothing is sent anywhere.

'use strict';

// Shown at the bottom of the main screen. Change both when you publish an update,
// and set VERSION in sw.js to match.
const APP_VERSION = 7;
const APP_DATE = '2026-11-07';

const STORAGE_KEY = 'barcode-cards-v1';
// Deep enough that white text on them stays readable in bright light.
const COLORS = ['#1a5fb4', '#1f7a4a', '#c64600', '#a51d2d', '#613583', '#865e3c', '#3d3846', '#0b6e72'];
// Versions before 6 used brighter shades; cards saved then are moved to the matching deep one.
const OLD_COLORS = {
  '#1c71d8': '#1a5fb4', '#26a269': '#1f7a4a', '#e66100': '#c64600', '#c01c28': '#a51d2d',
  '#813d9c': '#613583', '#0f9a9a': '#0b6e72',
};

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
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    for (const c of list) if (OLD_COLORS[c.color]) c.color = OLD_COLORS[c.color];
    return list;
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

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Ask the browser to keep our data even when the phone is low on space.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ---------- Moving between screens ----------

const SCREENS = ['home', 'scan', 'edit', 'show', 'shared'];

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

// ---------- Screen 1: the wallet (chips + stacked cards) ----------

// Which chip is picked: every card, the favorites, or one folder (by name).
const ALL = '\u0000all';
const FAVS = '\u0000favs';
let view = ALL;

// The folder chip that's picked, or '' — new cards go into it.
function currentFolder() {
  return view !== ALL && view !== FAVS ? view : '';
}

// Folders aren't stored separately — a folder exists while any card is in it.
// Their order is kept in its own list; folders not in it go last, A–Z.
const FOLDER_ORDER_KEY = 'barcode-folder-order';
let folderOrder = (() => {
  try {
    const list = JSON.parse(localStorage.getItem(FOLDER_ORDER_KEY));
    return Array.isArray(list) ? list.filter((n) => typeof n === 'string') : [];
  } catch {
    return [];
  }
})();

function saveFolderOrder(names) {
  folderOrder = names;
  try { localStorage.setItem(FOLDER_ORDER_KEY, JSON.stringify(names)); } catch { /* fine */ }
}

function folderNames() {
  const names = new Set(cards.map((c) => c.folder).filter(Boolean));
  const rank = (n) => { const i = folderOrder.indexOf(n); return i === -1 ? Infinity : i; };
  return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

const STAR_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>';
const STAR_OUTLINE_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Fills `face` (a .wcard) with a card's front: initial + name on top, number underneath.
// `big` is the open card: it shows the star and the barcode type instead of the short number.
function fillCardFace(face, card, big) {
  face.textContent = '';
  face.style.background = card.color;
  const top = el('span', 'wc-row');
  const id = el('span', 'wc-id');
  id.append(el('span', 'wc-initial', ([...card.name][0] || '?').toUpperCase()), el('span', 'wc-name', card.name));
  top.appendChild(id);
  const bottom = el('span', 'wc-row bottom');
  if (big) {
    if (card.favorite) {
      const star = el('span', 'wc-star');
      star.innerHTML = STAR_SVG;
      star.setAttribute('aria-label', 'Favorite');
      top.appendChild(star);
    }
    const type = formatInfo(card.format).label.replace(/\s*\(.*\)$/, '');
    bottom.append(el('span', 'wc-meta', card.folder ? `${card.folder} · ${type}` : type));
  } else {
    const short = card.text.length > 8 ? '…' + card.text.slice(-4) : card.text;
    top.appendChild(el('span', 'wc-short', short));
    bottom.append(el('span', 'wc-num', card.text), el('span', 'wc-meta', card.folder || ''));
  }
  face.append(top, bottom);
}

function stackCard(card) {
  const li = el('li');
  const btn = el('button', 'wcard');
  btn.type = 'button';
  fillCardFace(btn, card, false);
  btn.addEventListener('click', () => openCard(card.id));
  li.appendChild(btn);
  return li;
}

function reorderRow(id, label, color) {
  const li = el('li');
  li.dataset.id = id;
  const row = el('div', 'row-card', label);
  if (color) row.style.background = color;
  li.append(row, dragHandle());
  return li;
}

function chip(value, label, count, starred) {
  const btn = el('button', 'chip');
  btn.type = 'button';
  btn.setAttribute('aria-pressed', String(view === value));
  if (starred) {
    const star = el('span');
    star.innerHTML = STAR_SVG;
    star.style.cssText = 'display:flex;color:var(--accent)';
    btn.appendChild(star);
  }
  btn.append(label);
  if (count !== undefined) btn.appendChild(el('span', 'count', String(count)));
  btn.addEventListener('click', () => { view = value; renderList(); });
  return btn;
}

function matchesSearch(card, query) {
  return [card.name, card.text, card.folder || ''].some((s) => s.toLowerCase().includes(query));
}

function renderList() {
  const folders = folderNames();
  const favorites = cards.filter((c) => c.favorite);
  // A chip whose folder (or favorites) has emptied falls back to All.
  if ((view === FAVS && favorites.length === 0) || (currentFolder() && !folders.includes(view))) view = ALL;

  const searching = !$('search-form').hidden;
  const query = searching ? $('search').value.trim().toLowerCase() : '';
  let shown;
  if (query) shown = cards.filter((c) => matchesSearch(c, query));
  else if (view === FAVS) shown = favorites;
  else if (currentFolder()) shown = cards.filter((c) => c.folder === view);
  else shown = cards;

  $('empty').hidden = cards.length > 0;
  $('header-buttons').hidden = reordering;
  $('reorder-done').hidden = !reordering;

  // Chips: All, Favorites (when there are any), then each folder.
  const chips = $('chips');
  chips.textContent = '';
  chips.hidden = cards.length === 0 || !!query || (folders.length === 0 && favorites.length === 0);
  chips.appendChild(chip(ALL, 'All', cards.length));
  if (favorites.length) chips.appendChild(chip(FAVS, 'Favorites', undefined, true));
  for (const name of folders) chips.appendChild(chip(name, name, cards.filter((c) => c.folder === name).length));
  $('folder-tools').hidden = !currentFolder() || reordering || !!query;

  const stack = $('stack');
  stack.textContent = '';
  stack.hidden = reordering;
  for (const card of shown) stack.appendChild(stackCard(card));

  const list = $('reorder-list');
  list.textContent = '';
  list.hidden = !reordering;
  if (reordering) for (const card of shown) list.appendChild(reorderRow(card.id, card.name, card.color));

  const folderOrderList = $('folder-order');
  folderOrderList.textContent = '';
  $('reorder-folders').hidden = !reordering || view !== ALL || folders.length < 2;
  for (const name of folders) folderOrderList.appendChild(reorderRow(name, name));

  $('no-results').hidden = !query || shown.length > 0;
  $('no-results').textContent = `No cards match “${$('search').value.trim()}”`;

  $('home-foot').hidden = reordering;
  $('reorder-button').hidden = cards.length < 2;
  $('backup-button').hidden = cards.length === 0;
  renderBackupStatus();
}

function goHome() {
  setReordering(false);
  renderList();
  showScreen('home');
}

const dateParts = APP_DATE.split('-').map(Number);
$('version').textContent = `Version ${APP_VERSION} · ` +
  new Date(dateParts[0], dateParts[1] - 1, dateParts[2])
    .toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

$('add-button').addEventListener('click', startScan);

// ---------- Search ----------

$('search-toggle').addEventListener('click', () => {
  $('search-form').hidden = false;
  $('search').focus();
  renderList();
});
$('search-cancel').addEventListener('click', () => {
  $('search').value = '';
  $('search-form').hidden = true;
  renderList();
});
$('search').addEventListener('input', renderList);
// The keyboard's "Search" key just closes the keyboard; results are already showing.
$('search-form').addEventListener('submit', (e) => { e.preventDefault(); $('search').blur(); });

// ---------- Folder chip tools ----------

$('folder-rename').addEventListener('click', () => {
  const oldName = currentFolder();
  const newName = (prompt('Rename folder', oldName) || '').trim();
  if (!newName || newName === oldName) return;
  const merging = folderNames().includes(newName);
  const order = folderNames();
  for (const c of cards) if (c.folder === oldName) c.folder = newName;
  saveCards(cards);
  // Keep the folder in the same spot (or drop the old name when merging into another folder).
  saveFolderOrder(merging ? order.filter((n) => n !== oldName) : order.map((n) => (n === oldName ? newName : n)));
  if (merging) toast(`Moved into the existing “${newName}” folder`);
  view = newName;
  renderList();
});

$('folder-delete').addEventListener('click', () => {
  const name = currentFolder();
  const inFolder = cards.filter((c) => c.folder === name);
  const n = inFolder.length;
  if (!confirm(`Delete the folder “${name}”?\n\nIts ${n} card${n === 1 ? '' : 's'} won’t be deleted — they stay under All.`)) return;
  for (const c of inFolder) c.folder = '';
  saveCards(cards);
  saveFolderOrder(folderOrder.filter((f) => f !== name));
  toast('Folder deleted — cards kept');
  view = ALL;
  renderList();
});

// ---------- Reordering (drag the ≡ handles) ----------

let reordering = false;

function dragHandle() {
  const handle = el('span', 'handle', '≡');
  handle.setAttribute('aria-label', 'Drag to reorder');
  return handle;
}

function setReordering(on) {
  if (reordering === on) return;
  reordering = on;
  document.body.classList.toggle('reordering', on);
  if (on) { $('search').value = ''; $('search-form').hidden = true; }
  renderList();
  window.scrollTo(0, 0);
}

$('reorder-button').addEventListener('click', () => setReordering(true));
$('reorder-done').addEventListener('click', () => setReordering(false));

// Moves the list's items to follow the finger, then reports the new order of ids.
// Moving an item in the page makes the browser drop its hold on the finger, so the
// rest of the drag is followed on the whole document, matched by pointer id.
function makeSortable(list, onReordered) {
  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.handle');
    if (!handle || !reordering) return;
    e.preventDefault();
    const pointer = e.pointerId;
    const item = handle.closest('li');
    item.classList.add('dragging');

    const move = (ev) => {
      if (ev.pointerId !== pointer) return;
      ev.preventDefault();
      const y = ev.clientY;
      for (const other of list.children) {
        if (other === item) continue;
        const box = other.getBoundingClientRect();
        const middle = box.top + box.height / 2;
        const itemIsAfter = item.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_PRECEDING;
        if (itemIsAfter && y < middle) { list.insertBefore(item, other); break; }
        if (!itemIsAfter && y > middle && other === item.nextElementSibling) { list.insertBefore(item, other.nextElementSibling); break; }
      }
      // Scroll when dragging near the top or bottom of the screen.
      if (y < 70) window.scrollBy(0, -12);
      else if (y > window.innerHeight - 70) window.scrollBy(0, 12);
    };
    const end = (ev) => {
      if (ev.pointerId !== pointer) return;
      item.classList.remove('dragging');
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      onReordered([...list.children].map((li) => li.dataset.id));
    };
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  });
}

// A list shows only some cards (say, the favorites). Their new order is written back
// into the places those cards already held, so other cards don't move.
function applyCardOrder(ids) {
  const moved = ids.map((id) => cards.find((c) => c.id === id)).filter(Boolean);
  const slots = [];
  cards.forEach((c, i) => { if (ids.includes(c.id)) slots.push(i); });
  slots.forEach((slot, k) => { cards[slot] = moved[k]; });
  saveCards(cards);
  renderList();
}

makeSortable($('reorder-list'), applyCardOrder);
makeSortable($('folder-order'), (names) => { saveFolderOrder(names); renderList(); });

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
  goHome();
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
  $('f-name').value = card ? card.name : fresh.name || '';
  $('f-text').value = card ? card.text : fresh.text;
  $('f-format').value = card ? card.format : fresh.format;
  fillFolderMenu(card ? card.folder || '' : currentFolder());
  $('f-favorite').checked = card ? !!card.favorite : false;
  pickColor(card ? card.color : fresh.color || COLORS[cards.length % COLORS.length]);
  $('edit-delete').hidden = !card;
  updatePreview();
  showScreen('edit');
  // A freshly scanned card only needs a name; a typed one needs the number first.
  if (!card && !fresh.name) (fresh.text ? $('f-name') : $('f-text')).focus();
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
    editingId = newId();
    cards.push({ id: editingId, ...fields, created: new Date().toISOString() });
  }
  if (!saveCards(cards)) return;
  renderList();
  openCard(editingId);
}

$('edit-save').addEventListener('click', saveEdit);
$('edit-form').addEventListener('submit', (e) => { e.preventDefault(); saveEdit(); });
$('edit-cancel').addEventListener('click', () => {
  if (editingId) openCard(editingId); else goHome();
});
$('edit-delete').addEventListener('click', () => {
  const card = cards.find((c) => c.id === editingId);
  if (!card || !confirm(`Delete “${card.name}”? This can’t be undone.`)) return;
  cards = cards.filter((c) => c.id !== editingId);
  saveCards(cards);
  goHome();
  toast(`Deleted ${card.name}`);
});

// ---------- Screen 4: show it at the scanner ----------

let shownId = null;
let wakeLock = null;

function openCard(id) {
  const card = cards.find((c) => c.id === id);
  if (!card) { showScreen('home'); return; }
  setReordering(false);
  shownId = id;
  fillCardFace($('show-card'), card, true);
  $('show-text').textContent = card.text;
  showFavorite(card);
  drawBarcode($('show-barcode'), card.text, card.format);
  showScreen('show');
  keepScreenOn();
}

function showFavorite(card) {
  $('show-fav').innerHTML = (card.favorite ? STAR_SVG.replace('width="20" height="20"', 'width="22" height="22"') : STAR_OUTLINE_SVG) + 'Favorite';
  $('show-fav').setAttribute('aria-pressed', String(!!card.favorite));
}

$('show-fav').addEventListener('click', () => {
  const card = cards.find((c) => c.id === shownId);
  if (!card) return;
  card.favorite = !card.favorite;
  saveCards(cards);
  showFavorite(card);
  fillCardFace($('show-card'), card, true);
  renderList();
});

$('show-copy').addEventListener('click', async () => {
  const card = cards.find((c) => c.id === shownId);
  if (!card) return;
  if (await copyText(card.text)) toast('Number copied');
  else prompt('Copy the number:', card.text);
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
  goHome();
});
$('show-edit').addEventListener('click', () => { letScreenSleep(); openEditor(shownId); });

// ---------- Backup and restore ----------
// A backup is one JSON file holding every card. Restoring only ever adds cards,
// so it's safe to restore the same file twice or onto a phone that already has cards.

const LAST_BACKUP_KEY = 'barcode-last-backup';

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderBackupStatus() {
  let last = null;
  try { last = localStorage.getItem(LAST_BACKUP_KEY); } catch { /* storage blocked */ }
  $('backup-status').textContent = last
    ? 'Last backup: ' + new Date(last).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : cards.length ? 'Not backed up yet' : '';
}

async function backUp() {
  if (cards.length === 0) { toast('No cards to back up yet.'); return; }
  const data = {
    app: 'Barcodes', backupFormat: 1, appVersion: APP_VERSION, created: new Date().toISOString(),
    cards, folderOrder: folderNames(),
  };
  const fileName = `barcodes-backup-${todayString()}.json`;
  const file = new File([JSON.stringify(data, null, 2)], fileName, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      // iPhone: opens the Share sheet → "Save to Files", AirDrop, Mail…
      await navigator.share({ files: [file], title: 'Barcodes backup' });
    } else {
      // Computers: an ordinary download.
      const link = document.createElement('a');
      link.href = URL.createObjectURL(file);
      link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return; // closed the Share sheet without saving
    toast('Couldn’t make the backup: ' + (err && err.message || err));
    return;
  }
  try { localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString()); } catch { /* fine */ }
  renderBackupStatus();
  toast(`Backed up ${cards.length} card${cards.length === 1 ? '' : 's'}`);
}

// Checks one card from a backup file. Returns a clean card, or null if it can't be used.
function cleanCard(raw) {
  if (!raw || typeof raw.text !== 'string' || !raw.text.trim()) return null;
  if (!FORMATS.some((f) => f.id === raw.format)) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Card',
    text: raw.text.trim(),
    format: raw.format,
    color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? OLD_COLORS[raw.color] || raw.color : COLORS[0],
    folder: typeof raw.folder === 'string' ? raw.folder.trim() : '',
    favorite: raw.favorite === true,
    created: typeof raw.created === 'string' ? raw.created : new Date().toISOString(),
  };
}

function restoreFrom(text) {
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  const list = data && Array.isArray(data.cards) ? data.cards : null;
  if (!list) { toast('That file isn’t a Barcodes backup.'); return; }

  const foldersBefore = folderNames();
  let added = 0, already = 0, unreadable = 0;
  for (const raw of list) {
    const card = cleanCard(raw);
    if (!card) { unreadable++; continue; }
    const have = cards.some((c) => c.id === card.id || (c.text === card.text && c.format === card.format));
    if (have) { already++; continue; }
    cards.push(card);
    added++;
  }
  if (added && !saveCards(cards)) return;
  // Folders from the backup keep their order, after any folders already on this phone.
  if (Array.isArray(data.folderOrder)) {
    const order = [...foldersBefore];
    for (const n of data.folderOrder) if (typeof n === 'string' && !order.includes(n)) order.push(n);
    saveFolderOrder(order);
  }
  goHome();

  const parts = [added ? `Restored ${added} card${added === 1 ? '' : 's'}` : 'No new cards to add'];
  if (already) parts.push(`${already} already here`);
  if (unreadable) parts.push(`${unreadable} couldn’t be read`);
  toast(parts.join(' · '));
}

$('backup-button').addEventListener('click', backUp);
$('restore-button').addEventListener('click', () => {
  $('restore-file').value = ''; // so picking the same file again still counts as a change
  $('restore-file').click();
});
$('restore-file').addEventListener('change', async () => {
  const file = $('restore-file').files[0];
  if (!file) return;
  try {
    restoreFrom(await file.text());
  } catch (err) {
    toast('Couldn’t open that file: ' + (err && err.message || err));
  }
});

// ---------- Sharing a card ----------
// A shared card travels as a link: …/barcodes/#card=<code>. Everything after "#" stays
// in the browser — it's never sent to GitHub. On iPhone a link opens in Safari, which
// can't see the Home Screen app's cards, so the shared page offers "Copy card" and the
// app has "Paste a shared card".

function encodeCard(card) {
  const json = JSON.stringify({ v: 1, n: card.name, t: card.text, f: card.format, c: card.color });
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Finds a shared card in any text (a link, or a whole message with a link in it).
function decodeSharedCard(text) {
  const match = /#card=([A-Za-z0-9_-]+)/.exec(text || '');
  if (!match) return null;
  try {
    const binary = atob(match[1].replace(/-/g, '+').replace(/_/g, '/'));
    const json = new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)));
    const d = JSON.parse(json);
    return cleanCard({ name: d.n, text: d.t, format: d.f, color: d.c });
  } catch {
    return null;
  }
}

function shareLink(card) {
  return location.origin + location.pathname + '#card=' + encodeCard(card);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers: copy through a hidden text box.
    const box = document.createElement('textarea');
    box.value = text;
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand && document.execCommand('copy');
    box.remove();
    return !!ok;
  }
}

$('show-share').addEventListener('click', async () => {
  const card = cards.find((c) => c.id === shownId);
  if (!card) return;
  const url = shareLink(card);
  if (navigator.share) {
    try {
      await navigator.share({ title: `${card.name} card`, text: `${card.name} card for the Barcodes app — tap the link to add it:`, url });
    } catch (err) {
      if (!err || err.name !== 'AbortError') toast('Couldn’t share: ' + (err && err.message || err));
    }
  } else if (await copyText(url)) {
    toast('Link copied — paste it into a message');
  } else {
    prompt('Copy this link and send it:', url);
  }
});

// Adds a shared card: opens the editor filled in, so the person can pick a folder and tap Save.
function addSharedCard(card) {
  const existing = cards.find((c) => c.text === card.text && c.format === card.format);
  if (existing) {
    toast(`You already have this card (${existing.name})`);
    openCard(existing.id);
    return;
  }
  openEditor(null, card);
  toast('Shared card — tap Save to keep it');
}

$('paste-shared').addEventListener('click', async () => {
  stopScan();
  let text = '';
  try {
    text = await navigator.clipboard.readText(); // iPhone shows a small "Paste" bubble to tap
  } catch {
    text = prompt('Paste the shared card link here:') || '';
  }
  const card = decodeSharedCard(text);
  if (card) { addSharedCard(card); return; }
  if (text) toast('That doesn’t look like a shared card. Copy the whole link and try again.');
  startScan(); // back to the camera
});

// Someone opened a shared-card link.
let pendingShared = null;

function openSharedLink() {
  if (!location.hash.startsWith('#card=')) return false;
  const card = decodeSharedCard(location.hash);
  history.replaceState(null, '', location.pathname); // tidy the address bar
  if (!card) { toast('That shared link is damaged — ask for it to be sent again.'); return false; }

  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (installed) { addSharedCard(card); return true; }

  pendingShared = card;
  fillCardFace($('shared-card'), card, true);
  $('shared-text').textContent = card.text;
  drawBarcode($('shared-barcode'), card.text, card.format);
  showScreen('shared');
  return true;
}

$('shared-copy').addEventListener('click', async () => {
  if (!pendingShared) return;
  const url = shareLink(pendingShared);
  if (await copyText(url)) toast('Copied — now open the Barcodes app');
  else prompt('Copy this link, then open the Barcodes app:', url);
});

$('shared-here').addEventListener('click', () => {
  if (pendingShared) addSharedCard(pendingShared);
});

window.addEventListener('hashchange', openSharedLink);

// ---------- Start ----------

renderList();
if (!openSharedLink()) showScreen('home');

// Lets the app open with no internet connection (see sw.js).
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
