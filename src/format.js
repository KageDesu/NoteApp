// Форматирование текста в заметках: панель над заметкой и меню «Стиль».

const TEXT_COLORS = [
  { id: 'default', title: 'Обычный', value: null },
  { id: 'blue', title: 'Синий', value: '#2f9bea' },
  { id: 'green', title: 'Зелёный', value: '#3aa547' },
  { id: 'orange', title: 'Оранжевый', value: '#f5841f' },
  { id: 'red', title: 'Красный', value: '#e8302f' },
  { id: 'gray', title: 'Серый', value: '#6b7280' },
];
const HIGHLIGHTS = [
  { id: 'none', title: 'Без выделения', value: null },
  { id: 'cyan', title: 'Голубое', value: '#8fdcff' },
  { id: 'lime', title: 'Салатовое', value: '#d4f20a' },
  { id: 'amber', title: 'Жёлтое', value: '#ffc533' },
  { id: 'pink', title: 'Розовое', value: '#ffa3dc' },
  { id: 'gray', title: 'Серое', value: '#e3e5e8' },
];

// Типы абзацев. key — сочетание для подсказки, code — KeyboardEvent.code (+Ctrl, +Shift если shift:true)
const BLOCK_TYPES = [
  { id: 'h1', label: 'Крупный заголовок', tag: 'H1', key: 'Ctrl ⇧1', code: 'Digit1', shift: true },
  { id: 'h2', label: 'Заголовок', tag: 'H2', key: 'Ctrl ⇧2', code: 'Digit2', shift: true },
  { id: 'normal', label: 'Обычный текст', tag: 'DIV', key: 'Ctrl ⇧0', code: 'Digit0', shift: true },
  { id: 'small', label: 'Мелкий текст', tag: 'DIV', cls: 't-small', key: 'Ctrl ⇧9', code: 'Digit9', shift: true },
  { id: 'code', label: 'Блок кода', tag: 'PRE', key: 'Ctrl ⇧.', code: 'Period', shift: true, extra: true },
  { id: 'callout', label: 'Выноска', tag: 'DIV', cls: 't-callout', key: 'Ctrl ⇧6', code: 'Digit6', shift: true, extra: true },
  { id: 'quote', label: 'Цитата', tag: 'BLOCKQUOTE', key: "Ctrl '", code: 'Quote', shift: false, extra: true },
];
const BLOCK_TAGS = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'PRE', 'BLOCKQUOTE', 'UL', 'OL']);

const Format = {
  bar: null,
  menu: null,
  cardId: null,

  root() {
    const e = this.cardId && Render.els.get(this.cardId);
    return e ? $('.note-content', e) : null;
  },

  // ---------- панель над заметкой ----------
  show(cardId) {
    this.cardId = cardId;
    if (!this.bar) this.buildBar();
    this.bar.hidden = false;
    this.position();
  },

  hide() {
    this.cardId = null;
    if (this.bar) this.bar.hidden = true;
    this.closeMenu();
  },

  buildBar() {
    const btn = (html, title, run, cls = '') => {
      const b = el('button', { class: 'fmt-btn ' + cls, title, html });
      b.addEventListener('click', run);
      return b;
    };
    this.styleBtn = btn('<span class="fmt-aa">Aa</span> Стиль <span class="fmt-caret">▾</span>', 'Стиль текста', () => this.toggleMenu(), 'fmt-style');
    this.bar = el('div', { id: 'format-bar', hidden: true },
      this.styleBtn,
      el('span', { class: 'fmt-sep' }),
      btn('<b>B</b>', 'Жирный (Ctrl+B)', () => this.exec('bold')),
      btn('<i>I</i>', 'Курсив (Ctrl+I)', () => this.exec('italic')),
      btn('<u>U</u>', 'Подчёркнутый (Ctrl+U)', () => this.exec('underline')),
      btn('<s>S</s>', 'Зачёркнутый', () => this.exec('strikeThrough')),
      el('span', { class: 'fmt-sep' }),
      btn('<svg viewBox="0 0 24 24"><circle cx="5" cy="7" r="1.4"/><circle cx="5" cy="12" r="1.4"/><circle cx="5" cy="17" r="1.4"/><path d="M10 7h10M10 12h10M10 17h10"/></svg>', 'Маркированный список', () => this.exec('insertUnorderedList')),
      btn('<svg viewBox="0 0 24 24"><path d="M10 7h10M10 12h10M10 17h10"/><text x="2.5" y="9.5">1</text><text x="2.5" y="19.5">2</text></svg>', 'Нумерованный список', () => this.exec('insertOrderedList')),
    );
    // Не забирать фокус у текста — иначе пропадёт выделение
    this.bar.addEventListener('mousedown', (e) => e.preventDefault());
    this.bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.append(this.bar);
  },

  position() {
    if (!this.bar || this.bar.hidden || !this.cardId) return;
    const e = Render.els.get(this.cardId);
    if (!e) return;
    const r = e.getBoundingClientRect();
    const vp = $('#viewport').getBoundingClientRect();
    const bw = this.bar.offsetWidth || 300;
    let top = r.top - 46;
    if (top < vp.top + 6) top = Math.min(r.bottom + 8, vp.bottom - 46);
    const left = Math.max(vp.left + 6, Math.min(r.left, innerWidth - bw - 8));
    this.bar.style.left = left + 'px';
    this.bar.style.top = top + 'px';
    if (this.menu && !this.menu.hidden && this.menuAnchored) this.placeMenuUnderBar();
  },

  // ---------- меню «Стиль» ----------
  toggleMenu() {
    if (this.menu && !this.menu.hidden) this.closeMenu();
    else this.openMenu();
  },

  openMenu(point) {
    if (!this.root()) return;
    if (!this.menu) {
      this.menu = el('div', { id: 'style-menu', hidden: true });
      this.menu.addEventListener('mousedown', (e) => e.preventDefault());
      this.menu.addEventListener('pointerdown', (e) => e.stopPropagation());
      document.body.append(this.menu);
      document.addEventListener('pointerdown', (e) => {
        if (this.menu.hidden) return;
        if (!this.menu.contains(e.target) && !this.styleBtn.contains(e.target)) this.closeMenu();
      }, true);
      document.addEventListener('selectionchange', () => { if (!this.menu.hidden) this.refreshMenu(); });
    }
    this.refreshMenu();
    this.menu.hidden = false;
    this.styleBtn.classList.add('on');
    this.menuAnchored = !point;
    if (point) {
      const r = this.menu.getBoundingClientRect();
      this.menu.style.left = Math.min(point.x, innerWidth - r.width - 8) + 'px';
      this.menu.style.top = Math.max(8, Math.min(point.y, innerHeight - r.height - 8)) + 'px';
    } else {
      this.placeMenuUnderBar();
    }
  },

  // Меню ставим сбоку от заметки (слева, если есть место, иначе справа), чтобы видеть результат
  placeMenuUnderBar() {
    const card = Render.els.get(this.cardId);
    const b = this.bar.getBoundingClientRect();
    const c = card ? card.getBoundingClientRect() : b;
    const vp = $('#viewport').getBoundingClientRect();
    const r = this.menu.getBoundingClientRect();
    let left;
    if (c.left - r.width - 12 >= vp.left + 4) left = c.left - r.width - 12;
    else if (c.right + 12 + r.width <= innerWidth - 8) left = c.right + 12;
    else left = Math.min(b.left, innerWidth - r.width - 8);
    const top = Math.max(vp.top + 8, Math.min(b.top, innerHeight - r.height - 8));
    this.menu.style.left = left + 'px';
    this.menu.style.top = top + 'px';
  },

  closeMenu() {
    if (this.menu) this.menu.hidden = true;
    if (this.styleBtn) this.styleBtn.classList.remove('on');
  },

  refreshMenu() {
    const m = this.menu;
    const cur = this.currentBlockType();
    m.innerHTML = '';
    const blocks = el('div', { class: 'sm-blocks' });
    let extraStarted = false;
    for (const t of BLOCK_TYPES) {
      if (t.extra && !extraStarted) { extraStarted = true; blocks.append(el('div', { class: 'sm-sep' })); }
      const sample = el('span', { class: 'sm-sample sm-' + t.id, text: t.label });
      const row = el('button', { class: 'sm-row' + (cur === t.id ? ' on' : '') }, sample,
        cur === t.id ? el('span', { class: 'sm-check', text: '✓' }) : el('kbd', { text: t.key }));
      row.addEventListener('click', () => { this.setBlock(t.id); this.refreshMenu(); });
      blocks.append(row);
    }
    m.append(blocks, el('div', { class: 'sm-sep' }));

    const curColor = this.currentInline('color');
    const curHl = this.currentInline('backgroundColor');
    const colors = el('div', { class: 'sm-swatches' }, TEXT_COLORS.map((c) => {
      const b = el('button', { class: 'sm-a' + (curColor === c.id ? ' on' : ''), title: c.title, text: 'A', style: { color: c.value || 'inherit' } });
      b.addEventListener('click', () => { this.setColor(c); this.refreshMenu(); });
      return b;
    }));
    const hls = el('div', { class: 'sm-swatches' }, HIGHLIGHTS.map((c) => {
      const b = el('button', { class: 'sm-a sm-hl' + (c.value ? '' : ' none') + (curHl === c.id ? ' on' : ''), title: c.title, text: 'A', style: c.value ? { background: c.value } : {} });
      b.addEventListener('click', () => { this.setHighlight(c); this.refreshMenu(); });
      return b;
    }));
    m.append(el('div', { class: 'sm-label', text: 'Цвет' }), colors, el('div', { class: 'sm-sep' }), el('div', { class: 'sm-label', text: 'Выделение' }), hls);
  },

  // ---------- команды ----------
  exec(cmd, value = null) {
    if (!this.root()) return;
    document.execCommand(cmd, false, value);
    this.changed();
  },

  changed() {
    requestAnimationFrame(() => { Render.lines(); this.position(); });
  },

  // Горячие клавиши внутри заметки. Возвращает true, если обработано.
  key(e) {
    if (!this.cardId || !(e.ctrlKey || e.metaKey) || e.altKey) return false;
    const t = BLOCK_TYPES.find((b) => b.code === e.code && !!b.shift === e.shiftKey);
    if (!t) return false;
    e.preventDefault();
    this.setBlock(t.id);
    if (this.menu && !this.menu.hidden) this.refreshMenu();
    return true;
  },

  // ---------- абзацы ----------
  typeOf(block) {
    if (!block) return 'normal';
    switch (block.tagName) {
      case 'H1': return 'h1';
      case 'H2': case 'H3': return 'h2';
      case 'PRE': return 'code';
      case 'BLOCKQUOTE': return 'quote';
    }
    if (block.classList.contains('t-small')) return 'small';
    if (block.classList.contains('t-callout')) return 'callout';
    return 'normal';
  },

  topBlockOf(node) {
    const root = this.root();
    if (!root || !node || !root.contains(node) || node === root) return null;
    while (node.parentNode !== root) node = node.parentNode;
    return node.nodeType === 1 && BLOCK_TAGS.has(node.tagName) ? node : null;
  },

  currentBlockType() {
    const sel = getSelection();
    if (!sel.rangeCount) return 'normal';
    return this.typeOf(this.topBlockOf(sel.anchorNode));
  },

  // Вставить невидимые метки на место выделения, чтобы восстановить его после перестройки DOM
  markSelection() {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    const mk = (id) => { const s = document.createElement('span'); s.dataset.selMark = id; return s; };
    const end = mk('e');
    const re = r.cloneRange(); re.collapse(false); re.insertNode(end);
    const start = mk('s');
    const rs = r.cloneRange(); rs.collapse(true); rs.insertNode(start);
    return { start, end };
  },

  restoreSelection(m) {
    if (!m) return;
    const r = document.createRange();
    r.setStartAfter(m.start);
    r.setEndBefore(m.end);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    // Выделение «живое»: после удаления меток оно само сдвинется на их место
    m.start.remove();
    m.end.remove();
  },

  // Обернуть «голые» строки верхнего уровня в div; списки при необходимости разложить на строки
  normalizeBlocks(root, unwrapLists) {
    let run = [];
    const flush = (before) => {
      if (!run.length) return;
      const d = document.createElement('div');
      root.insertBefore(d, before);
      for (const n of run) d.append(n);
      run = [];
    };
    for (const n of Array.from(root.childNodes)) {
      if (n.nodeType === 1 && BLOCK_TAGS.has(n.tagName)) {
        flush(n);
      } else if (n.nodeType === 1 && n.tagName === 'BR') {
        if (run.length) { flush(n); n.remove(); }
        else { const d = document.createElement('div'); root.insertBefore(d, n); d.append(n); }
      } else {
        run.push(n);
      }
    }
    flush(null);
    for (const list of unwrapLists || []) {
      for (const li of Array.from(list.children)) {
        const d = document.createElement('div');
        while (li.firstChild) d.append(li.firstChild);
        list.parentNode.insertBefore(d, list);
      }
      list.remove();
    }
  },

  // Строки верхнего уровня между метками выделения
  selectedBlocks(marks) {
    const root = this.root();
    if (!root) return [];
    const r = document.createRange();
    r.setStartBefore(marks.start);
    r.setEndAfter(marks.end);
    return Array.from(root.children).filter((b) => BLOCK_TAGS.has(b.tagName) && r.intersectsNode(b));
  },

  setBlock(typeId) {
    const root = this.root();
    if (!root) return;
    const t = BLOCK_TYPES.find((b) => b.id === typeId);
    const marks = this.markSelection();
    if (!marks) return;
    this.normalizeBlocks(root);
    let blocks = this.selectedBlocks(marks);
    const lists = blocks.filter((b) => b.tagName === 'UL' || b.tagName === 'OL');
    if (lists.length) { this.normalizeBlocks(root, lists); blocks = this.selectedBlocks(marks); }
    if (!blocks.length) { this.restoreSelection(marks); return; }
    // Повторное применение того же стиля возвращает обычный текст
    const target = blocks.every((b) => this.typeOf(b) === typeId) && typeId !== 'normal' ? BLOCK_TYPES.find((b) => b.id === 'normal') : t;
    for (const b of blocks) {
      if (this.typeOf(b) === target.id && b.tagName === target.tag) continue;
      const n = document.createElement(target.tag);
      if (target.cls) n.className = target.cls;
      while (b.firstChild) n.append(b.firstChild);
      if (!n.textContent && !n.querySelector('br')) n.append(document.createElement('br'));
      b.replaceWith(n);
    }
    this.restoreSelection(marks);
    this.changed();
  },

  // ---------- цвет и выделение ----------
  currentInline(prop) {
    const sel = getSelection();
    const root = this.root();
    if (!sel.rangeCount || !root) return prop === 'color' ? 'default' : 'none';
    let n = sel.anchorNode;
    if (n && n.nodeType === 3) n = n.parentNode;
    const list = prop === 'color' ? TEXT_COLORS : HIGHLIGHTS;
    while (n && n !== root) {
      const v = n.style && n.style[prop];
      if (v) {
        const hex = toHex(v);
        const found = list.find((c) => c.value && c.value === hex);
        if (found) return found.id;
      }
      n = n.parentNode;
    }
    return prop === 'color' ? 'default' : 'none';
  },

  setColor(c) {
    const root = this.root();
    if (!root) return;
    document.execCommand('styleWithCSS', false, true);
    // «Обычный» = цвет текста самой заметки: Chromium в этом случае снимает лишнюю окраску
    document.execCommand('foreColor', false, c.value || getComputedStyle(root).color);
    document.execCommand('styleWithCSS', false, false);
    this.cleanup(root);
    this.changed();
  },

  setHighlight(c) {
    const root = this.root();
    if (!root) return;
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('hiliteColor', false, c.value || 'transparent');
    document.execCommand('styleWithCSS', false, false);
    this.cleanup(root);
    this.changed();
  },

  // Убрать «пустые» стили, которые остаются после снятия цвета
  cleanup(root) {
    const noteColor = toHex(getComputedStyle(root).color);
    for (const s of Array.from(root.querySelectorAll('[style]'))) {
      if (s.dataset.selMark) continue;
      const bg = s.style.backgroundColor;
      if (bg && (bg === 'transparent' || /rgba\(.*,\s*0\)$/.test(bg))) s.style.backgroundColor = '';
      if (s.style.color && toHex(s.style.color) === noteColor && !s.parentElement.closest('[style*="color"]')) s.style.color = '';
      if (!s.getAttribute('style')?.trim()) {
        s.removeAttribute('style');
        if (s.tagName === 'SPAN' && !s.attributes.length) s.replaceWith(...s.childNodes);
      }
    }
  },
};

// Любой CSS-цвет → '#rrggbb'
const _colorCtx = document.createElement('canvas').getContext('2d');
function toHex(v) {
  _colorCtx.fillStyle = '#000';
  _colorCtx.fillStyle = v;
  return String(_colorCtx.fillStyle).toLowerCase();
}
