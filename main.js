// NoteApp — главный процесс Electron.
// Отвечает за окно, хранение данных на диске, файлы-вложения и превью ссылок.
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { pathToFileURL } = require('url');

// ---------- Папка с данными ----------
// Путь берётся из datapath.json в корне программы (рядом с main.js, а в собранной версии — рядом с .exe).
// Если файла нет, он создаётся с путём по умолчанию: Документы\NoteApp.
// В пути можно использовать переменные окружения (%USERPROFILE%) и ~ ; относительный путь
// считается от папки, где лежит datapath.json.
const APP_ROOT = app.isPackaged
  ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe')))
  : __dirname;
const DATAPATH_FILE = path.join(APP_ROOT, 'datapath.json');
const DEFAULT_DATA_DIR = path.join(app.getPath('documents'), 'NoteApp');

function expandPath(p) {
  let s = String(p).trim()
    .replace(/%([^%]+)%/g, (m, name) => process.env[name] ?? m);
  if (s === '~' || s.startsWith('~/') || s.startsWith('~\\')) s = path.join(app.getPath('home'), s.slice(1));
  return path.resolve(APP_ROOT, s);
}

function resolveDataDir() {
  if (process.env.NOTEAPP_DATA) return { dir: process.env.NOTEAPP_DATA };
  if (!fs.existsSync(DATAPATH_FILE)) {
    try {
      fs.writeFileSync(DATAPATH_FILE, JSON.stringify({ dataPath: DEFAULT_DATA_DIR }, null, 2) + '\n', 'utf8');
    } catch (e) {
      console.error('Не удалось создать datapath.json', e);
    }
    return { dir: DEFAULT_DATA_DIR };
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(DATAPATH_FILE, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    return { error: `Файл ${DATAPATH_FILE} содержит ошибку:\n${e.message}\n\nПодсказка: обратные слэши в JSON нужно удваивать — "D:\\\\Облако\\\\NoteApp" — или писать прямые: "D:/Облако/NoteApp".` };
  }
  const raw = cfg && typeof cfg.dataPath === 'string' ? cfg.dataPath.trim() : '';
  return { dir: raw ? expandPath(raw) : DEFAULT_DATA_DIR };
}

const resolved = resolveDataDir();
const DATA_DIR = resolved.dir || DEFAULT_DATA_DIR;
const BOARDS_DIR = path.join(DATA_DIR, 'boards');
const ASSETS_DIR = path.join(DATA_DIR, 'assets');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Папку не подменяем молча на другую: если облачный диск не подключён, лучше сказать об этом,
// чем создать пустые доски в другом месте.
let startupError = resolved.error || null;
if (!startupError) {
  try {
    for (const d of [DATA_DIR, BOARDS_DIR, ASSETS_DIR, BACKUP_DIR]) fs.mkdirSync(d, { recursive: true });
  } catch (e) {
    startupError = `Не удалось открыть папку с данными:\n${DATA_DIR}\n\n${e.message}\n\nПроверьте, что диск подключён, или исправьте путь в файле:\n${DATAPATH_FILE}`;
  }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'nasset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '');
const safeAsset = (name) => path.basename(String(name));

async function writeAtomic(file, text) {
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, text, 'utf8');
  await fsp.rename(tmp, file);
}

// Раз в день копируем доски в backups/ГГГГ-ММ-ДД, храним последние 14 копий.
function dailyBackup() {
  try {
    const stamp = new Date().toISOString().slice(0, 10);
    const target = path.join(BACKUP_DIR, stamp);
    const files = fs.readdirSync(BOARDS_DIR).filter((f) => f.endsWith('.json'));
    if (!files.length || fs.existsSync(target)) return;
    fs.mkdirSync(target, { recursive: true });
    for (const f of files) fs.copyFileSync(path.join(BOARDS_DIR, f), path.join(target, f));
    const all = fs.readdirSync(BACKUP_DIR).sort();
    for (const old of all.slice(0, Math.max(0, all.length - 14))) {
      fs.rmSync(path.join(BACKUP_DIR, old), { recursive: true, force: true });
    }
  } catch (e) {
    console.error('backup failed', e);
  }
}

// ---------- IPC: доски ----------
ipcMain.handle('data:load-all', async () => {
  const boards = {};
  for (const f of await fsp.readdir(BOARDS_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const b = JSON.parse(await fsp.readFile(path.join(BOARDS_DIR, f), 'utf8'));
      if (b && b.id) boards[b.id] = b;
    } catch (e) {
      console.error('Не удалось прочитать', f, e);
    }
  }
  let settings = {};
  try { settings = JSON.parse(await fsp.readFile(SETTINGS_FILE, 'utf8')); } catch {}
  return { boards, settings, dataDir: DATA_DIR };
});

ipcMain.handle('data:save-board', async (_e, board) => {
  await writeAtomic(path.join(BOARDS_DIR, safeId(board.id) + '.json'), JSON.stringify(board, null, 1));
  return true;
});

ipcMain.handle('data:delete-board', async (_e, id) => {
  await fsp.rm(path.join(BOARDS_DIR, safeId(id) + '.json'), { force: true });
  return true;
});

ipcMain.handle('data:save-settings', async (_e, s) => {
  await writeAtomic(SETTINGS_FILE, JSON.stringify(s, null, 1));
  return true;
});

// ---------- IPC: вложения ----------
function assetName(original) {
  const ext = path.extname(original || '').slice(0, 12).toLowerCase().replace(/[^.a-z0-9]/g, '');
  return Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex') + ext;
}

async function importPath(p) {
  const st = await fsp.stat(p);
  if (!st.isFile()) return null;
  const file = assetName(p);
  await fsp.copyFile(p, path.join(ASSETS_DIR, file));
  return { file, name: path.basename(p), size: st.size };
}

ipcMain.handle('asset:import-paths', async (_e, paths) => {
  const out = [];
  for (const p of paths || []) {
    try { const r = await importPath(p); if (r) out.push(r); } catch (e) { console.error(e); }
  }
  return out;
});

ipcMain.handle('asset:save-buffer', async (_e, name, data) => {
  const file = assetName(name);
  await fsp.writeFile(path.join(ASSETS_DIR, file), Buffer.from(data));
  return { file, name, size: data.byteLength };
});

ipcMain.handle('asset:pick', async (e, kind) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const filters = kind === 'image'
    ? [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }]
    : [{ name: 'Все файлы', extensions: ['*'] }];
  const res = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters });
  if (res.canceled) return [];
  const out = [];
  for (const p of res.filePaths) { const r = await importPath(p); if (r) out.push(r); }
  return out;
});

ipcMain.handle('shell:open-asset', async (_e, file) => shell.openPath(path.join(ASSETS_DIR, safeAsset(file))));
ipcMain.handle('shell:show-asset', async (_e, file) => shell.showItemInFolder(path.join(ASSETS_DIR, safeAsset(file))));
ipcMain.handle('shell:open-data-dir', async () => shell.openPath(DATA_DIR));
ipcMain.handle('shell:open-external', async (_e, url) => {
  if (/^https?:\/\//i.test(url)) await shell.openExternal(url);
});

// ---------- IPC: превью ссылки ----------
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

function metaContent(html, keys) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const key of keys) {
    for (const t of tags) {
      const nameM = t.match(/(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i);
      if (!nameM || nameM[1].toLowerCase() !== key) continue;
      const c = t.match(/content\s*=\s*"([^"]*)"/i) || t.match(/content\s*=\s*'([^']*)'/i);
      if (c && c[1].trim()) return decodeEntities(c[1]);
    }
  }
  return '';
}

async function fetchWithTimeout(url, ms, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await net.fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'ru,en;q=0.8', ...(opts.headers || {}) } });
  } finally {
    clearTimeout(t);
  }
}

async function downloadAsset(url, maxBytes) {
  try {
    const r = await fetchWithTimeout(url, 10000);
    if (!r.ok) return '';
    const type = r.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return '';
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > maxBytes) return '';
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico' }[type.split(';')[0]] || '.img';
    const file = assetName('x' + ext);
    await fsp.writeFile(path.join(ASSETS_DIR, file), buf);
    return file;
  } catch {
    return '';
  }
}

ipcMain.handle('link:preview', async (_e, url) => {
  const result = { url, title: '', description: '', image: '', favicon: '', siteName: '' };
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return result; }
  result.siteName = host;
  try {
    const r = await fetchWithTimeout(url, 10000);
    const finalUrl = r.url || url;
    const type = r.headers.get('content-type') || '';
    if (type.startsWith('image/')) {
      result.image = await downloadAsset(url, 8e6);
      result.title = decodeURIComponent(new URL(finalUrl).pathname.split('/').pop() || host);
      return result;
    }
    const buf = Buffer.from(await r.arrayBuffer()).subarray(0, 1.5e6);
    // Определяем кодировку (многие русские сайты всё ещё в windows-1251)
    let charset = (type.match(/charset=([\w-]+)/i) || [])[1];
    if (!charset) {
      const head = buf.subarray(0, 4000).toString('latin1');
      charset = (head.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i) || [])[1] || 'utf-8';
    }
    let html;
    try { html = new TextDecoder(charset.toLowerCase()).decode(buf); } catch { html = buf.toString('utf8'); }

    result.title = metaContent(html, ['og:title', 'twitter:title']) || decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
    result.description = metaContent(html, ['og:description', 'twitter:description', 'description']).slice(0, 400);
    result.siteName = metaContent(html, ['og:site_name']) || host;

    const img = metaContent(html, ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']);
    if (img) result.image = await downloadAsset(new URL(img, finalUrl).href, 8e6);

    const iconTag = (html.match(/<link\b[^>]*rel\s*=\s*["'](?:shortcut )?icon["'][^>]*>/i) || [])[0];
    const iconHref = iconTag && (iconTag.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
    result.favicon = await downloadAsset(new URL(iconHref || '/favicon.ico', finalUrl).href, 5e5);
  } catch (e) {
    result.error = String(e && e.message || e);
  }
  return result;
});

// ---------- Окно ----------
let win;
let readyToClose = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 700,
    minHeight: 500,
    backgroundColor: '#ecedef',
    title: 'NoteApp',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  win.webContents.session.setSpellCheckerLanguages(['ru', 'en-US']);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Ссылки никогда не открываем внутри приложения
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });

  // Перед закрытием даём интерфейсу дописать несохранённые изменения
  win.on('close', (e) => {
    if (readyToClose) return;
    e.preventDefault();
    win.webContents.send('app:before-close');
    setTimeout(() => { readyToClose = true; win && win.close(); }, 3000);
  });
}

ipcMain.on('app:ready-to-close', () => {
  readyToClose = true;
  if (win) win.close();
});

app.whenReady().then(async () => {
  if (startupError) {
    const r = await dialog.showMessageBox({
      type: 'error', title: 'NoteApp', message: 'Папка с данными недоступна', detail: startupError,
      buttons: ['Открыть datapath.json', 'Выход'], defaultId: 1, cancelId: 1,
    });
    if (r.response === 0) await shell.openPath(DATAPATH_FILE);
    app.quit();
    return;
  }
  protocol.handle('nasset', (req) => {
    const u = new URL(req.url);
    const name = safeAsset(decodeURIComponent(u.pathname));
    return net.fetch(pathToFileURL(path.join(ASSETS_DIR, name)).toString());
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Файл', submenu: [
      { label: 'Открыть папку с данными', click: () => shell.openPath(DATA_DIR) },
      { label: 'Изменить путь к данным (datapath.json)', click: () => shell.openPath(DATAPATH_FILE) },
      { type: 'separator' },
      { role: 'quit', label: 'Выход' },
    ] },
    { label: 'Правка', submenu: [{ role: 'cut', label: 'Вырезать' }, { role: 'copy', label: 'Копировать' }, { role: 'paste', label: 'Вставить' }, { role: 'selectAll', label: 'Выделить всё' }] },
    { label: 'Вид', submenu: [{ role: 'reload', label: 'Перезагрузить' }, { role: 'toggleDevTools', label: 'Инструменты разработчика' }, { role: 'togglefullscreen', label: 'Полный экран' }] },
  ]));
  dailyBackup();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
