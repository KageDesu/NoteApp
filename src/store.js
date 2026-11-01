// Данные: доски, сохранение на диск, отмена/повтор действий.
//
// Формат доски:
// { id, title, parentId, color, icon, view:{x,y,z}, cards:[...], lines:[...] }
// Карточка: { id, type: 'note'|'board'|'link'|'todo'|'sketch'|'image'|'file', x, y, w, ...поля типа }
// Линия:    { id, from: {card} | {x,y}, to: {card} | {x,y}, arrow: true }

const HOME_ID = 'home';
const BOARD_COLORS = ['#f28b82', '#e8634a', '#f6a35b', '#f7c948', '#7fd1ae', '#5bc0c4', '#6aa7f8', '#9b7cf6', '#c77dde', '#8d8f94', '#3a3d42', '#c8a27a'];
const BOARD_ICONS = ['📁', '🎮', '🧩', '🛠️', '💡', '📌', '📚', '🎯', '🗂️', '⭐', '🔥', '🚀', '🎨', '🧪', '📝', '📦', '🔧', '⚙️', '🗺️', '🏆', '💰', '🧠', '📈', '🎵', '🎬', '🌍', '❤️', '✅', '🪖', '🔫', '🛡️', '🗑️'];

const Store = {
  boards: {},
  settings: {},
  dataDir: '',
  dirty: new Set(),
  saveTimer: null,
  history: {}, // boardId -> { undo: [], redo: [] }

  init(data) {
    this.boards = data.boards || {};
    this.settings = data.settings || {};
    this.dataDir = data.dataDir;
    if (!this.boards[HOME_ID]) {
      this.boards[HOME_ID] = this.newBoardObject({ id: HOME_ID, title: 'Главная', icon: '🏠', color: '#6aa7f8' });
      this.markDirty(HOME_ID);
    }
    this.collectOrphans();
  },

  newBoardObject({ id, title, parentId = null, color, icon }) {
    return {
      id: id || uid(),
      title: title || 'Без названия',
      parentId,
      color: color || BOARD_COLORS[Math.floor(Math.random() * BOARD_COLORS.length)],
      icon: icon || '📁',
      view: { x: 80, y: 60, z: 1 },
      cards: [],
      lines: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  },

  get(id) { return this.boards[id]; },

  createBoard(opts) {
    const b = this.newBoardObject(opts);
    this.boards[b.id] = b;
    this.markDirty(b.id);
    return b;
  },

  // Путь от главной до доски: [home, ..., board]
  pathTo(id) {
    const out = [];
    const seen = new Set();
    let b = this.boards[id];
    while (b && !seen.has(b.id)) {
      out.unshift(b);
      seen.add(b.id);
      b = b.parentId ? this.boards[b.parentId] : null;
    }
    return out;
  },

  // Содержимое доски для подписи на карточке: «3 доски, 12 карточек»
  countContents(id) {
    const b = this.boards[id];
    if (!b) return { boards: 0, cards: 0 };
    let boards = 0, cards = 0;
    for (const c of b.cards) (c.type === 'board' ? boards++ : cards++);
    return { boards, cards };
  },

  // Доски, на которые больше никто не ссылается (удалены вместе с карточкой).
  // Помечаем их и физически удаляем через 30 дней — чтобы «Отменить» успело сработать.
  collectOrphans() {
    const reachable = new Set();
    const visit = (id) => {
      if (reachable.has(id) || !this.boards[id]) return;
      reachable.add(id);
      for (const c of this.boards[id].cards) if (c.type === 'board') visit(c.boardId);
    };
    visit(HOME_ID);
    const now = Date.now();
    for (const b of Object.values(this.boards)) {
      if (reachable.has(b.id)) {
        if (b.orphanedAt) { delete b.orphanedAt; this.markDirty(b.id); }
        continue;
      }
      if (!b.orphanedAt) { b.orphanedAt = now; this.markDirty(b.id); }
      else if (now - b.orphanedAt > 30 * 864e5) {
        delete this.boards[b.id];
        window.api.deleteBoard(b.id);
      }
    }
  },

  // Глубокая копия доски со всеми вложенными досками (для копирования карточек-досок)
  cloneBoardTree(id, newParentId) {
    const src = this.boards[id];
    if (!src) return null;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid();
    copy.parentId = newParentId;
    delete copy.orphanedAt;
    copy.createdAt = copy.updatedAt = Date.now();
    this.boards[copy.id] = copy;
    for (const c of copy.cards) if (c.type === 'board') c.boardId = this.cloneBoardTree(c.boardId, copy.id);
    this.markDirty(copy.id);
    return copy.id;
  },

  // ---------- сохранение ----------
  markDirty(id, touch = true) {
    const b = this.boards[id];
    if (!b) return;
    if (touch) b.updatedAt = Date.now();
    this.dirty.add(id);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 400);
  },

  async flush() {
    clearTimeout(this.saveTimer);
    const ids = Array.from(this.dirty);
    this.dirty.clear();
    await Promise.all(ids.map((id) => this.boards[id] && window.api.saveBoard(this.boards[id]).catch((e) => {
      console.error(e);
      this.dirty.add(id);
      toast('Не удалось сохранить доску: ' + e.message);
    })));
  },

  saveSettings() {
    window.api.saveSettings(this.settings);
  },

  // ---------- отмена / повтор ----------
  hist(id) {
    return (this.history[id] ||= { undo: [], redo: [] });
  },
  stateOf(id) {
    const b = this.boards[id];
    return JSON.stringify({ cards: b.cards, lines: b.lines });
  },
  // Вызывать ПЕРЕД изменением доски. extra — другие доски, затронутые тем же действием
  snapshot(id = App.boardId, extra = []) {
    const h = this.hist(id);
    const entry = { s: this.stateOf(id), extra: {} };
    for (const x of extra) if (this.boards[x]) entry.extra[x] = this.stateOf(x);
    const top = h.undo[h.undo.length - 1];
    if (top && top.s === entry.s && !extra.length && !Object.keys(top.extra).length) return;
    h.undo.push(entry);
    if (h.undo.length > 150) h.undo.shift();
    h.redo.length = 0;
  },
  // Если изменение в итоге ничего не поменяло — убрать лишний снимок
  dropSnapshotIfSame(id = App.boardId) {
    const h = this.hist(id);
    const top = h.undo[h.undo.length - 1];
    if (top && !Object.keys(top.extra).length && top.s === this.stateOf(id)) h.undo.pop();
  },
  restore(id, s) {
    const b = this.boards[id];
    if (!b) return;
    const st = JSON.parse(s);
    b.cards = st.cards;
    b.lines = st.lines;
    // Карточки-доски могли «воскреснуть» — вернуть им родителя
    for (const c of b.cards) if (c.type === 'board' && this.boards[c.boardId]) {
      this.boards[c.boardId].parentId = id;
      delete this.boards[c.boardId].orphanedAt;
      this.markDirty(c.boardId, false);
    }
    this.markDirty(id);
  },
  apply(id, from, to) {
    const h = this.hist(id);
    if (!h[from].length) return false;
    const entry = h[from].pop();
    const back = { s: this.stateOf(id), extra: {} };
    for (const x of Object.keys(entry.extra)) if (this.boards[x]) back.extra[x] = this.stateOf(x);
    h[to].push(back);
    for (const [x, st] of Object.entries(entry.extra)) this.restore(x, st);
    this.restore(id, entry.s);
    return true;
  },
  undo(id) { return this.apply(id, 'undo', 'redo'); },
  redo(id) { return this.apply(id, 'redo', 'undo'); },
};
