// Состояние приложения, навигация по доскам, действия с карточками.

const App = {
  boardId: HOME_ID,
  view: { x: 80, y: 60, z: 1 },
  selected: new Set(),
  selectedLines: new Set(),
  editingId: null,
  tempLine: null,
  clip: null,
  cascade: 0,

  get board() { return Store.get(this.boardId); },
  cardById(id) { return this.board.cards.find((c) => c.id === id); },
  // Набор id вместе с карточками, лежащими внутри выбранных колонок
  withChildren(ids) {
    const s = new Set(ids);
    for (const c of this.board.cards) if (c.col && s.has(c.col)) s.add(c.id);
    return s;
  },

  // ---------- навигация ----------
  open(id, focusCardId) {
    if (!Store.get(id)) return;
    Edit.stop();
    Minimap.hideNow();
    this.board.view = { ...this.view };
    Store.markDirty(this.boardId, false);
    this.boardId = id;
    this.view = { ...(this.board.view || { x: 80, y: 60, z: 1 }) };
    this.selected.clear();
    this.selectedLines.clear();
    Store.settings.lastBoard = id;
    Store.saveSettings();
    this.applyView();
    Render.board();
    this.header();
    if (focusCardId) requestAnimationFrame(() => this.focusCard(focusCardId));
  },

  goUp() {
    const b = this.board;
    if (b.parentId && Store.get(b.parentId)) {
      const from = b.id;
      this.open(b.parentId);
      const card = this.board.cards.find((c) => c.type === 'board' && c.boardId === from);
      if (card) { this.selected.add(card.id); Render.selection(); }
    }
  },

  focusCard(id) {
    const r = Render.cardRect(id);
    if (!r) return;
    const vp = $('#viewport').getBoundingClientRect();
    this.view.x = vp.width / 2 - (r.x + r.w / 2) * this.view.z;
    this.view.y = vp.height / 2 - (r.y + r.h / 2) * this.view.z;
    this.applyView();
    this.selected = new Set([id]);
    Render.selection();
    const e = Render.els.get(id);
    if (e) { e.classList.remove('flash'); void e.offsetWidth; e.classList.add('flash'); }
  },

  header() {
    const crumbs = $('#crumbs');
    crumbs.innerHTML = '';
    const path = Store.pathTo(this.boardId);
    path.forEach((b, i) => {
      if (i) crumbs.append(el('span', { class: 'crumb-sep', text: '/' }));
      const last = i === path.length - 1;
      crumbs.append(el('button', {
        class: 'crumb' + (last ? ' current' : ''),
        onclick: () => !last && this.open(b.id),
      }, el('span', { class: 'crumb-dot', style: { background: b.color } }), el('span', { text: b.title })));
    });
    $('#board-title').textContent = this.board.title;
    document.title = this.board.title + ' — NoteApp';
  },

  // ---------- вид ----------
  applyView() {
    const { x, y, z } = this.view;
    $('#world').style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    const vp = $('#viewport');
    const step = 22 * z;
    vp.style.backgroundSize = `${step}px ${step}px`;
    vp.style.backgroundPosition = `${x}px ${y}px`;
    $('#btn-zoom').textContent = Math.round(z * 100) + '%';
    if (typeof Format !== 'undefined') Format.position();
    this.board.view = { ...this.view };
    clearTimeout(this._viewTimer);
    this._viewTimer = setTimeout(() => Store.markDirty(this.boardId, false), 800);
  },

  zoomAt(factor, sx, sy) {
    const z = Math.min(3, Math.max(0.15, this.view.z * factor));
    const k = z / this.view.z;
    this.view.x = sx - (sx - this.view.x) * k;
    this.view.y = sy - (sy - this.view.y) * k;
    this.view.z = z;
    this.applyView();
  },

  screenToWorld(clientX, clientY) {
    const vp = $('#viewport').getBoundingClientRect();
    return { x: (clientX - vp.left - this.view.x) / this.view.z, y: (clientY - vp.top - this.view.y) / this.view.z };
  },

  // Свободное место для новой карточки в центре экрана (со смещением, чтобы не ложились стопкой)
  centerPos(w = 280) {
    const vp = $('#viewport').getBoundingClientRect();
    const c = this.screenToWorld(vp.left + vp.width / 2, vp.top + vp.height / 2.4);
    const off = (this.cascade++ % 6) * 24;
    return { x: Math.round(c.x - w / 2 + off), y: Math.round(c.y - 40 + off) };
  },

  select(ids, add = false) {
    if (!add) { this.selected.clear(); this.selectedLines.clear(); }
    for (const id of ids) this.selected.add(id);
    Render.selection();
    Render.lines();
  },
  clearSelection() {
    this.selected.clear();
    this.selectedLines.clear();
    Render.selection();
    Render.lines();
  },
};

// ---------- Действия ----------
const Actions = {
  addCard(card, { edit = false, select = true } = {}) {
    Store.snapshot();
    card.id ||= uid();
    card.w ||= CARD_DEFAULT_W[card.type];
    App.board.cards.push(card);
    Store.markDirty(App.boardId);
    Render.sync();
    if (select) App.select([card.id]);
    if (edit) Edit.start(card.id, { isNew: true });
    return card;
  },

  note(pos, html = '') {
    return this.addCard({ type: 'note', x: pos.x, y: pos.y, html, color: 'none' }, { edit: !html });
  },

  todo(pos) {
    const card = this.addCard({ type: 'todo', x: pos.x, y: pos.y, title: '', items: [{ id: uid(), text: '', done: false }] });
    Edit.start(card.id, { focusItem: card.items[0].id, isNew: true });
    return card;
  },

  column(pos) {
    const card = this.addCard({ type: 'column', x: pos.x, y: pos.y, title: '', color: 'none', style: 'fill' });
    Edit.start(card.id, { isNew: true });
    return card;
  },

  // Положить карточки в колонку перед карточкой beforeId (или в конец колонки).
  // Снимок для отмены делает вызывающий код.
  insertIntoColumn(ids, colId, beforeId = null) {
    const b = App.board;
    const col = b.cards.find((c) => c.id === colId && c.type === 'column');
    if (!col) return;
    const moving = b.cards.filter((c) => ids.has(c.id) && c.type !== 'column' && c.id !== colId);
    if (!moving.length) return;
    // в колонке — в том порядке, как карточки стояли на экране сверху вниз
    moving.sort((a, c) => a.y - c.y || a.x - c.x);
    const mv = new Set(moving.map((c) => c.id));
    b.cards = b.cards.filter((c) => !mv.has(c.id));
    for (const c of moving) c.col = colId;
    let idx = beforeId ? b.cards.findIndex((c) => c.id === beforeId) : -1;
    if (idx < 0) {
      // после последней карточки колонки, а если она пуста — сразу после самой колонки
      idx = b.cards.findIndex((c) => c.id === colId) + 1;
      b.cards.forEach((c, i) => { if (c.col === colId) idx = i + 1; });
    }
    b.cards.splice(idx, 0, ...moving);
    Store.markDirty(App.boardId);
    Render.sync();
    App.select(moving.map((c) => c.id));
  },

  // Вынуть карточки из колонки и положить на холст справа от неё
  takeOutOfColumn(ids) {
    const b = App.board;
    Render.syncChildPos();
    Store.snapshot();
    const out = b.cards.filter((c) => ids.has(c.id) && c.col);
    for (const c of out) {
      const r = Render.cardRect(c.col);
      if (r) c.x = Math.round(r.x + r.w + 40);
      delete c.col;
      c.w = CARD_DEFAULT_W[c.type] || c.w;
    }
    // наверх по z-порядку, чтобы не оказались под другими карточками
    b.cards = [...b.cards.filter((c) => !out.includes(c)), ...out];
    Store.markDirty(App.boardId);
    Render.sync();
    App.select(out.map((c) => c.id));
  },

  sketch(pos) {
    return this.addCard({ type: 'sketch', x: pos.x, y: pos.y, strokes: [] });
  },

  // Новая таблица; cells — готовые данные (например, вставленные из Excel)
  table(pos, cells) {
    const w = cells ? Math.min(1000, Math.max(CARD_DEFAULT_W.table, cells[0].length * 120)) : CARD_DEFAULT_W.table;
    const card = this.addCard({ type: 'table', x: pos.x, y: pos.y, w, title: '', desc: '', header: true, cells: cells || Table.make(4, 3) });
    if (!cells) Edit.start(card.id, { isNew: true });
    return card;
  },

  async board(pos) {
    const title = await promptText('Новая доска', '', 'Название доски');
    if (title == null) return;
    const b = Store.createBoard({ title: title || 'Без названия', parentId: App.boardId });
    this.addCard({ type: 'board', x: pos.x, y: pos.y, boardId: b.id });
    App.header();
  },

  async link(pos, url) {
    if (!url) {
      url = await promptText('Добавить ссылку', '', 'https://…');
      if (!url) return;
    }
    url = normalizeUrl(url);
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const card = this.addCard({ type: 'link', x: pos.x, y: pos.y, url, loading: true });
    this.loadPreview(card);
  },

  async loadPreview(card) {
    card.loading = true;
    Render.card(card);
    const boardId = App.boardId;
    const p = await window.api.linkPreview(card.url);
    Object.assign(card, { title: p.title, description: p.description, image: p.image, favicon: p.favicon, siteName: p.siteName });
    delete card.loading;
    Store.markDirty(boardId);
    if (App.boardId === boardId && Render.els.has(card.id)) Render.card(card);
    if (p.error && !p.title) toast('Не удалось загрузить превью: ' + p.error);
  },

  addAssets(pos, assets) {
    if (!assets.length) return;
    Store.snapshot();
    const ids = [];
    let { x, y } = pos;
    for (const a of assets) {
      const isImg = IMAGE_EXT.test(a.name || a.file);
      const card = { id: uid(), type: isImg ? 'image' : 'file', x, y, file: a.file, name: a.name, size: a.size };
      card.w = CARD_DEFAULT_W[card.type];
      App.board.cards.push(card);
      ids.push(card.id);
      x += 30; y += 30;
    }
    Store.markDirty(App.boardId);
    Render.sync();
    App.select(ids);
  },

  async pick(kind, pos) {
    const assets = await window.api.pickFiles(kind);
    this.addAssets(pos || App.centerPos(), assets);
  },

  line(pos) {
    Store.snapshot();
    const line = { id: uid(), from: { x: pos.x, y: pos.y + 60 }, to: { x: pos.x + 180, y: pos.y }, arrow: true };
    App.board.lines.push(line);
    Store.markDirty(App.boardId);
    App.clearSelection();
    App.selectedLines.add(line.id);
    Render.lines();
    $('#empty-hint').hidden = true;
  },

  deleteSelection() {
    const b = App.board;
    if (!App.selected.size && !App.selectedLines.size) return;
    Store.snapshot();
    const ids = App.withChildren(App.selected); // колонка удаляется вместе с содержимым
    b.cards = b.cards.filter((c) => !ids.has(c.id));
    b.lines = b.lines.filter((l) => !App.selectedLines.has(l.id) && !ids.has(l.from.card) && !ids.has(l.to.card));
    App.selected = new Set();
    App.selectedLines = new Set();
    Store.markDirty(App.boardId);
    Render.sync();
  },

  // Копия выбранных карточек (и стрелок между ними) со смещением
  cloneInto(board, cards, lines, dx, dy) {
    const map = {};
    const newIds = [];
    const copies = [];
    for (const c of cards) {
      const n = JSON.parse(JSON.stringify(c));
      n.id = uid();
      n.x += dx; n.y += dy;
      if (n.type === 'board') n.boardId = Store.cloneBoardTree(c.boardId, board.id);
      if (n.type === 'board' && !n.boardId) continue;
      map[c.id] = n.id;
      board.cards.push(n);
      newIds.push(n.id);
      copies.push(n);
    }
    // карточки колонок — в копию колонки; если колонку не копировали, карточка становится свободной
    for (const n of copies) if (n.col) { if (map[n.col]) n.col = map[n.col]; else delete n.col; }
    for (const l of lines) {
      if ((l.from.card && !map[l.from.card]) || (l.to.card && !map[l.to.card])) continue;
      const n = JSON.parse(JSON.stringify(l));
      n.id = uid();
      if (n.from.card) n.from.card = map[n.from.card]; else { n.from.x += dx; n.from.y += dy; }
      if (n.to.card) n.to.card = map[n.to.card]; else { n.to.x += dx; n.to.y += dy; }
      board.lines.push(n);
    }
    return newIds;
  },

  selectedLinesBetween(ids) {
    return App.board.lines.filter((l) => (l.from.card ? ids.has(l.from.card) : App.selectedLines.has(l.id)) && (l.to.card ? ids.has(l.to.card) : App.selectedLines.has(l.id)));
  },

  duplicate() {
    if (!App.selected.size) return;
    Render.syncChildPos();
    Store.snapshot();
    const sel = App.withChildren(App.selected);
    const cards = App.board.cards.filter((c) => sel.has(c.id));
    const ids = this.cloneInto(App.board, cards, this.selectedLinesBetween(sel), 30, 30);
    Store.markDirty(App.boardId);
    Render.sync();
    const fresh = new Set(ids);
    App.select(ids.filter((id) => !fresh.has(App.cardById(id)?.col))); // выделить колонку, а не её содержимое
  },

  copy() {
    if (!App.selected.size) return false;
    Render.syncChildPos();
    const sel = App.withChildren(App.selected);
    const cards = App.board.cards.filter((c) => sel.has(c.id));
    const text = cards.map((c) => c.type === 'column' ? c.title : c.type === 'note' ? htmlToText(c.html) : c.type === 'link' ? c.url : c.type === 'todo' ? [c.title, ...c.items.map((i) => (i.done ? '[x] ' : '[ ] ') + i.text)].filter(Boolean).join('\n') : c.type === 'sketch' ? '[Скетч]' : c.type === 'table' ? Table.toText(c) : c.name || (c.type === 'board' && Store.get(c.boardId)?.title) || '').filter(Boolean).join('\n\n') || '[NoteApp]';
    App.clip = { cards: JSON.parse(JSON.stringify(cards)), lines: JSON.parse(JSON.stringify(this.selectedLinesBetween(sel))), text };
    navigator.clipboard.writeText(text).catch(() => {});
    return true;
  },

  pasteClip(pos) {
    const clip = App.clip;
    if (!clip || !clip.cards.length) return;
    Store.snapshot();
    const minX = Math.min(...clip.cards.map((c) => c.x));
    const minY = Math.min(...clip.cards.map((c) => c.y));
    const ids = this.cloneInto(App.board, clip.cards, clip.lines, pos.x - minX, pos.y - minY);
    Store.markDirty(App.boardId);
    Render.sync();
    const fresh = new Set(ids);
    App.select(ids.filter((id) => !fresh.has(App.cardById(id)?.col)));
  },

  // Перенести карточки в другую доску (бросили на карточку-доску)
  moveToBoard(ids, targetId) {
    const src = App.board;
    const dst = Store.get(targetId);
    if (!dst) return;
    Render.syncChildPos();
    ids = App.withChildren(ids); // колонка переезжает вместе с содержимым
    // нельзя положить доску внутрь самой себя
    for (const c of src.cards) {
      if (ids.has(c.id) && c.type === 'board' && Store.pathTo(targetId).some((b) => b.id === c.boardId)) {
        toast('Нельзя переместить доску внутрь неё самой');
        return;
      }
    }
    Store.snapshot(src.id, [dst.id]);
    const moving = src.cards.filter((c) => ids.has(c.id));
    const minX = Math.min(...moving.map((c) => c.x));
    const minY = Math.min(...moving.map((c) => c.y));
    // кладём правее существующего содержимого целевой доски
    const top = dst.cards.filter((c) => !c.col);
    const maxX = top.length ? Math.max(...top.map((c) => c.x + (c.w || 200))) + 60 : 40;
    const baseY = top.length ? Math.min(...top.map((c) => c.y)) : 40;
    const keepLines = [];
    src.lines = src.lines.filter((l) => {
      const a = l.from.card && ids.has(l.from.card), b = l.to.card && ids.has(l.to.card);
      if (a && b) { keepLines.push(l); return false; }
      return !(a || b);
    });
    for (const c of moving) {
      if (c.col && !ids.has(c.col)) delete c.col;
      c.x = c.x - minX + maxX;
      c.y = c.y - minY + baseY;
      dst.cards.push(c);
      if (c.type === 'board' && Store.get(c.boardId)) { Store.get(c.boardId).parentId = dst.id; Store.markDirty(c.boardId); }
    }
    dst.lines.push(...keepLines);
    src.cards = src.cards.filter((c) => !ids.has(c.id));
    // история целевой доски больше не согласована с её содержимым
    Store.hist(dst.id).undo.length = 0;
    Store.hist(dst.id).redo.length = 0;
    Store.markDirty(src.id);
    Store.markDirty(dst.id);
    App.selected.clear();
    Render.sync();
    // обновить счётчик на карточке-доске
    const bc = src.cards.find((c) => c.type === 'board' && c.boardId === targetId);
    if (bc) Render.card(bc);
    toast(`Перемещено в «${dst.title}»: ${moving.filter((c) => !c.col).length}`);
  },

  setNoteColor(color, style) {
    Store.snapshot();
    for (const c of App.board.cards) if (App.selected.has(c.id) && (c.type === 'note' || c.type === 'column')) {
      if (color) c.color = color;
      if (style) c.style = style;
      Render.card(c);
    }
    Store.dropSnapshotIfSame();
    Store.markDirty(App.boardId);
  },

  order(front) {
    Store.snapshot();
    const b = App.board;
    // карточки внутри колонок не трогаем: их порядок в списке — это порядок в колонке
    const sel = b.cards.filter((c) => App.selected.has(c.id) && !c.col);
    const rest = b.cards.filter((c) => !App.selected.has(c.id) || c.col);
    b.cards = front ? [...rest, ...sel] : [...sel, ...rest];
    Store.markDirty(App.boardId);
    Render.sync();
  },

  async editBoard(boardId) {
    const b = Store.get(boardId);
    if (!b) return;
    const name = el('input', { class: 'input', value: b.title });
    let color = b.color, icon = b.icon, iconImage = b.iconImage || '';

    const renderPreview = () => {
      const fresh = boardIconEl({ color, icon, iconImage }, 'board-icon preview');
      prevHolder.innerHTML = '';
      prevHolder.append(fresh);
    };
    const prevHolder = el('div', { class: 'preview-holder' });

    // --- цвет: готовые + свой ---
    const markColor = (btn) => { $$('.swatch', colors).forEach((s) => s.classList.remove('on')); btn.classList.add('on'); };
    const isPreset = BOARD_COLORS.includes(color);
    const picker = el('input', { type: 'color', class: 'color-input', value: /^#[0-9a-f]{6}$/i.test(color) ? color : '#9b7cf6' });
    const custom = el('button', {
      class: 'swatch custom' + (isPreset ? '' : ' on has-color'),
      title: 'Свой цвет…',
      style: isPreset ? {} : { '--custom': color },
    }, picker);
    // Клик по кнопке открывает системное окно выбора цвета
    custom.addEventListener('click', (e) => { if (e.target !== picker) picker.click(); });
    picker.addEventListener('input', () => {
      color = picker.value;
      custom.style.setProperty('--custom', color);
      custom.classList.add('has-color');
      markColor(custom);
      renderPreview();
    });
    const colors = el('div', { class: 'swatches' },
      BOARD_COLORS.map((c) => el('button', {
        class: 'swatch' + (c === color ? ' on' : ''), style: { background: c },
        onclick: (e) => { color = c; markColor(e.currentTarget); renderPreview(); },
      })),
      custom);

    // --- значок: эмодзи или своя картинка ---
    const icons = el('div', { class: 'icons' }, BOARD_ICONS.map((ic) => el('button', {
      class: 'icon-btn' + (!iconImage && ic === icon ? ' on' : ''), text: ic,
      onclick: (e) => {
        icon = ic;
        iconImage = '';
        $$('.icon-btn', icons).forEach((s) => s.classList.remove('on'));
        e.currentTarget.classList.add('on');
        uploadBtn.textContent = 'Загрузить картинку…';
        renderPreview();
      },
    })));
    const uploadBtn = el('button', { class: 'btn upload-btn', title: 'Выбрать картинку на компьютере. Чтобы вернуть эмодзи — щёлкните по любому значку.', text: iconImage ? 'Заменить картинку…' : 'Загрузить картинку…' });
    uploadBtn.addEventListener('click', async () => {
      const [a] = await window.api.pickFiles('image');
      if (!a) return;
      iconImage = a.file;
      $$('.icon-btn', icons).forEach((s) => s.classList.remove('on'));
      uploadBtn.textContent = 'Заменить картинку…';
      renderPreview();
    });

    renderPreview();
    const ok = await modal({
      title: 'Настройки доски', okText: 'Сохранить', wide: true, extra: uploadBtn,
      body: el('div', { class: 'board-edit' }, el('div', { class: 'board-edit-top' }, prevHolder, name), el('label', { text: 'Цвет' }), colors, el('label', { text: 'Значок' }), icons),
      onOk: () => true,
    });
    if (!ok) return;
    b.title = name.value.trim() || b.title;
    b.color = color;
    b.icon = icon;
    if (iconImage) b.iconImage = iconImage; else delete b.iconImage;
    Store.markDirty(b.id);
    Render.board();
    App.header();
  },
};

// ---------- Редактирование текста в карточках ----------
const Edit = {
  start(id, { isNew = false, focusItem = null, point = null, focusCell = null } = {}) {
    if (App.editingId === id) return;
    this.stop();
    const card = App.cardById(id);
    const e = Render.els.get(id);
    if (!card || !e || !['note', 'todo', 'table', 'column'].includes(card.type)) return;
    if (!isNew) Store.snapshot(); // для новой карточки снимок уже сделан при создании
    App.editingId = id;
    App.select([id]);
    this.isNew = isNew;
    let target;
    if (card.type === 'note') {
      target = $('.note-content', e);
      target.contentEditable = 'true';
      Format.show(id);
    } else if (card.type === 'column') {
      target = $('.col-title', e);
      target.contentEditable = 'plaintext-only';
    } else if (card.type === 'table') {
      Table.enable(e);
      target = Table.startTarget(card, e, { isNew, point, focusCell });
    } else {
      for (const t of $$('.todo-title, .todo-text', e)) t.contentEditable = 'plaintext-only';
      target = focusItem ? $(`[data-item="${focusItem}"] .todo-text`, e) : $('.todo-title', e);
    }
    Render.selection();
    if (card.type === 'table') Render.lines(); // в режиме редактирования появляется описание — размер меняется
    target.focus();
    const sel = window.getSelection();
    const r = point && document.caretRangeFromPoint(point.x, point.y);
    if (r && target.contains(r.startContainer)) {
      sel.removeAllRanges(); sel.addRange(r);
    } else {
      sel.selectAllChildren(target);
      sel.collapseToEnd();
    }
  },

  // Перенести текст из DOM в модель
  read() {
    const card = App.cardById(App.editingId);
    const e = Render.els.get(App.editingId);
    if (!card || !e) return null;
    if (card.type === 'note') {
      card.html = sanitizeHtml($('.note-content', e).innerHTML);
    } else if (card.type === 'todo') {
      card.title = $('.todo-title', e).textContent.trim();
      for (const it of card.items) {
        const t = $(`[data-item="${it.id}"] .todo-text`, e);
        if (t) it.text = t.textContent;
      }
    } else if (card.type === 'table') {
      Table.read(card, e);
    } else if (card.type === 'column') {
      card.title = $('.col-title', e).textContent.replace(/\s+/g, ' ').trim();
    }
    return card;
  },

  stop() {
    if (!App.editingId) return;
    const card = this.read();
    App.editingId = null;
    Format.hide();
    if (card) {
      if (card.type === 'todo') card.items = card.items.filter((i) => i.text.trim());
      // пустую таблицу не удаляем: сетка сама по себе уже содержимое
      const empty = card.type === 'table' || card.type === 'column' ? false : card.type === 'note' ? !htmlToText(card.html) && !/<(li|br)/i.test(card.html) : !card.title && !card.items.length;
      if (empty && this.isNew) {
        App.board.cards = App.board.cards.filter((c) => c.id !== card.id);
        App.selected.delete(card.id);
        Render.sync();
      } else {
        Render.card(card);
      }
    }
    Store.dropSnapshotIfSame();
    Store.markDirty(App.boardId);
    window.getSelection().removeAllRanges();
    Render.selection();
  },

  // ---- заголовок колонки: Enter завершает ввод ----
  columnKey(ev) {
    const card = App.cardById(App.editingId);
    if (card?.type === 'column' && ev.key === 'Enter') { ev.preventDefault(); this.stop(); }
  },

  // ---- клавиши внутри to-do ----
  todoKey(ev) {
    const card = App.cardById(App.editingId);
    if (!card || card.type !== 'todo') return;
    const t = ev.target;
    const itemEl = t.closest('.todo-item');
    if (ev.key === 'Enter') {
      ev.preventDefault();
      this.read();
      const idx = itemEl ? card.items.findIndex((i) => i.id === itemEl.dataset.item) + 1 : 0;
      this.insertItem(card, idx);
    } else if (ev.key === 'Backspace' && itemEl && !t.textContent) {
      ev.preventDefault();
      this.read();
      const idx = card.items.findIndex((i) => i.id === itemEl.dataset.item);
      card.items.splice(idx, 1);
      const prevEl = itemEl.previousElementSibling;
      itemEl.remove();
      const focus = prevEl ? $('.todo-text', prevEl) : $('.todo-title', Render.els.get(card.id));
      focus.focus();
      const s = window.getSelection(); s.selectAllChildren(focus); s.collapseToEnd();
    } else if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && !ev.shiftKey) {
      const all = $$('.todo-title, .todo-text', Render.els.get(card.id));
      const i = all.indexOf(t) + (ev.key === 'ArrowDown' ? 1 : -1);
      if (all[i]) { ev.preventDefault(); all[i].focus(); const s = window.getSelection(); s.selectAllChildren(all[i]); s.collapseToEnd(); }
    }
  },

  insertItem(card, idx) {
    const it = { id: uid(), text: '', done: false };
    card.items.splice(idx, 0, it);
    const e = Render.els.get(card.id);
    const list = $('.todo-list', e);
    const node = el('div', { class: 'todo-item', 'data-item': it.id },
      el('span', { class: 'todo-check', 'data-role': 'check' }),
      el('div', { class: 'todo-text', contenteditable: 'plaintext-only' }));
    list.insertBefore(node, list.children[idx] || null);
    $('.todo-text', node).focus();
    Render.lines();
  },
};

// ---------- Поиск по всем доскам ----------
function cardText(c) {
  if (c.type === 'note') return htmlToText(c.html);
  if (c.type === 'todo') return [c.title, ...(c.items || []).map((i) => i.text)].join(' ');
  if (c.type === 'link') return [c.title, c.url, c.description].join(' ');
  if (c.type === 'board') return Store.get(c.boardId)?.title || '';
  if (c.type === 'sketch') return '';
  if (c.type === 'table') return Table.searchText(c);
  if (c.type === 'column') return c.title || '';
  return [c.name, c.caption].join(' ');
}

function openSearch() {
  Edit.stop();
  const input = el('input', { class: 'input', placeholder: 'Искать во всех досках…' });
  const list = el('div', { class: 'search-results' });
  const TYPE = { note: 'Заметка', todo: 'To-do', link: 'Ссылка', board: 'Доска', image: 'Картинка', file: 'Файл', sketch: 'Скетч', table: 'Таблица', column: 'Колонка' };
  let results = [];
  const run = () => {
    const q = input.value.trim().toLowerCase();
    list.innerHTML = '';
    results = [];
    if (!q) return;
    for (const b of Object.values(Store.boards)) {
      if (b.orphanedAt) continue;
      for (const c of b.cards) {
        const text = cardText(c);
        const i = text.toLowerCase().indexOf(q);
        if (i < 0) continue;
        results.push({ b, c, text, i });
      }
    }
    for (const r of results.slice(0, 60)) {
      const start = Math.max(0, r.i - 40);
      const snip = (start ? '…' : '') + r.text.slice(start, r.i) ;
      const row = el('button', { class: 'search-row' },
        el('div', { class: 'search-path', text: Store.pathTo(r.b.id).map((x) => x.title).join(' / ') + ' · ' + TYPE[r.c.type] }),
        el('div', { class: 'search-snip' }, snip, el('mark', { text: r.text.slice(r.i, r.i + q.length) }), r.text.slice(r.i + q.length, r.i + q.length + 80)));
      row.addEventListener('click', () => { $('#modal-root').innerHTML = ''; App.open(r.b.id, r.c.id); });
      list.append(row);
    }
    if (!results.length) list.append(el('div', { class: 'search-empty', text: 'Ничего не найдено' }));
  };
  input.addEventListener('input', run);
  modal({ title: 'Поиск', body: el('div', {}, input, list), okText: 'Закрыть', cancelText: null, wide: true });
}

// ---------- Запуск ----------
(async function boot() {
  const data = await window.api.loadAll();
  Store.init(data);
  const last = Store.settings.lastBoard;
  App.boardId = last && Store.get(last) && !Store.get(last).orphanedAt ? last : HOME_ID;
  App.view = { ...(App.board.view || { x: 80, y: 60, z: 1 }) };
  App.applyView();
  Render.board();
  App.header();
  Interact.init();

  window.api.onBeforeClose(async () => {
    Edit.stop();
    await Store.flush();
    window.api.readyToClose();
  });
})();
