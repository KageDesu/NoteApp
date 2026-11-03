// Отрисовка доски: карточки и стрелки.

const NOTE_COLORS = {
  none: { bg: '#ffffff', fg: '#2b2e33' },
  yellow: { bg: '#fdd54f', fg: '#3b3214' },
  orange: { bg: '#d9965b', fg: '#33230f' },
  salmon: { bg: '#dca184', fg: '#3a2418' },
  red: { bg: '#f26b5b', fg: '#ffffff' },
  pink: { bg: '#f6a5c0', fg: '#3b1d28' },
  purple: { bg: '#a78bfa', fg: '#ffffff' },
  blue: { bg: '#7cb4f8', fg: '#13243b' },
  teal: { bg: '#62d6c3', fg: '#0f3530' },
  green: { bg: '#9fd67a', fg: '#1e3311' },
  gray: { bg: '#d4d6da', fg: '#2b2e33' },
  dark: { bg: '#33363c', fg: '#f1f2f4' },
};

const CARD_DEFAULT_W = { note: 280, link: 320, todo: 280, image: 320, file: 240, board: 128, sketch: 360, table: 420, column: 300 };

const Render = {
  els: new Map(), // cardId -> element

  board() {
    const cardsLayer = $('#cards');
    cardsLayer.innerHTML = '';
    this.els.clear();
    const b = App.board;
    for (const c of b.cards) this.createCardEl(c);
    this.place();
    this.lines();
    this.selection();
    $('#empty-hint').hidden = b.cards.length > 0 || b.lines.length > 0;
  },

  // Пересоздать одну карточку (после изменения её данных)
  card(card) {
    const old = this.els.get(card.id);
    const fresh = this.createCardEl(card);
    if (old) old.replaceWith(fresh); else $('#cards').append(fresh);
    if (card.type === 'column') this.place(); // вернуть карточки внутрь новой колонки
    else if (card.col) this.columnMeta(card.col);
    this.selection();
    this.lines();
  },

  // Синхронизировать порядок/наличие карточек с моделью (после удаления, вставки, смены порядка)
  sync() {
    const b = App.board;
    const ids = new Set(b.cards.map((c) => c.id));
    for (const [id, e] of this.els) if (!ids.has(id)) { e.remove(); this.els.delete(id); }
    for (const c of b.cards) if (!this.els.has(c.id)) this.createCardEl(c);
    this.place();
    this.lines();
    this.selection();
    $('#empty-hint').hidden = b.cards.length > 0 || b.lines.length > 0;
  },

  // Разложить элементы карточек: свободные — на холст, карточки колонок — внутрь колонок.
  // append переставляет существующий узел, поэтому порядок в b.cards задаёт и z-порядок,
  // и порядок карточек внутри колонки.
  place() {
    const layer = $('#cards');
    const cards = App.board.cards;
    const lists = new Map();
    for (const c of cards) if (c.type === 'column') {
      const e = this.els.get(c.id);
      if (e) { this.position(c); lists.set(c.id, $('.col-list', e)); }
    }
    for (const c of cards) {
      if (c.type === 'column') continue;
      const e = this.els.get(c.id);
      if (!e) continue;
      const list = c.col && lists.get(c.col);
      if (!list) delete c.col; // колонки больше нет — карточка остаётся на холсте
      if (list) list.append(e);
      this.position(c);
    }
    // колонки должны оставаться в своём z-порядке относительно свободных карточек
    for (const c of cards) if (!c.col) { const e = this.els.get(c.id); if (e) layer.append(e); }
    for (const id of lists.keys()) this.columnMeta(id);
  },

  // Подпись под заголовком колонки: «1 доска, 2 карточки»
  columnMeta(colId) {
    const e = this.els.get(colId);
    if (!e) return;
    let boards = 0, cards = 0;
    for (const c of App.board.cards) if (c.col === colId) (c.type === 'board' ? boards++ : cards++);
    const parts = [];
    if (boards) parts.push(boards + ' ' + plural(boards, 'доска', 'доски', 'досок'));
    if (cards || !boards) parts.push(cards + ' ' + plural(cards, 'карточка', 'карточки', 'карточек'));
    $('.col-meta', e).textContent = parts.join(', ');
    e.classList.toggle('empty', !boards && !cards);
  },

  position(card) {
    const e = this.els.get(card.id);
    if (!e) return;
    if (card.col) { // внутри колонки положение и ширину задаёт сама колонка
      e.style.left = e.style.top = e.style.width = '';
      return;
    }
    e.style.left = card.x + 'px';
    e.style.top = card.y + 'px';
    if (card.type !== 'board') e.style.width = (card.w || CARD_DEFAULT_W[card.type]) + 'px';
  },

  createCardEl(card) {
    const e = el('div', { class: 'card card-' + card.type, 'data-id': card.id });
    const fn = this['body_' + card.type];
    if (fn) fn.call(this, card, e);
    if (card.type !== 'board') e.append(el('div', { class: 'resize-handle', 'data-role': 'resize' }));
    e.append(el('div', { class: 'connect-handle', 'data-role': 'connect', title: 'Потяните, чтобы соединить стрелкой' }));
    this.els.set(card.id, e);
    this.position(card);
    return e;
  },

  // ---------- типы карточек ----------
  body_column(card, e) {
    const col = NOTE_COLORS[card.color] || NOTE_COLORS.none;
    if (card.style === 'stripe') {
      e.style.setProperty('--stripe', col.bg);
      e.classList.add('stripe');
    } else {
      e.style.background = col.bg;
      e.style.setProperty('--col-fg', col.fg);
    }
    if (card.color && card.color !== 'none') e.classList.add('colored');
    const title = el('div', { class: 'col-title', 'data-field': 'title', text: card.title || '' });
    title.dataset.placeholder = 'Колонка';
    e.append(
      el('div', { class: 'col-head' }, title, el('div', { class: 'col-meta' })),
      el('div', { class: 'col-list' }),
      el('div', { class: 'col-empty', text: 'Перетащите сюда карточки' }),
    );
  },

  body_note(card, e) {
    const col = NOTE_COLORS[card.color] || NOTE_COLORS.none;
    if (card.style === 'stripe') {
      e.style.setProperty('--stripe', col.bg);
      e.classList.add('stripe');
    } else {
      e.style.background = col.bg;
      e.style.color = col.fg;
    }
    if (card.color && card.color !== 'none' && card.style !== 'stripe') e.classList.add('colored');
    const content = el('div', { class: 'note-content', html: sanitizeHtml(card.html || '') });
    content.dataset.placeholder = 'Пишите здесь…';
    e.append(content);
  },

  body_board(card, e) {
    const b = Store.get(card.boardId);
    if (!b) { e.append(el('div', { class: 'board-missing', text: 'Доска не найдена' })); return; }
    const n = Store.countContents(b.id);
    const parts = [];
    if (n.boards) parts.push(n.boards + ' ' + plural(n.boards, 'доска', 'доски', 'досок'));
    if (n.cards || !n.boards) parts.push(n.cards + ' ' + plural(n.cards, 'карточка', 'карточки', 'карточек'));
    e.append(
      el('div', { class: 'board-icon', style: { background: b.color } }, el('span', { text: b.icon || '📁' })),
      el('div', { class: 'board-title', text: b.title }),
      el('div', { class: 'board-meta', text: parts.join(', ') }),
    );
  },

  body_link(card, e) {
    if (card.image) e.append(el('div', { class: 'link-image' }, el('img', { src: assetUrl(card.image), draggable: 'false', onerror: (ev) => ev.target.parentElement.remove() })));
    const inner = el('div', { class: 'link-inner' });
    const host = (() => { try { return new URL(card.url).hostname.replace(/^www\./, ''); } catch { return card.url; } })();
    inner.append(el('div', { class: 'link-url' },
      card.favicon ? el('img', { class: 'favicon', src: assetUrl(card.favicon), draggable: 'false', onerror: (ev) => ev.target.remove() }) : el('span', { class: 'favicon-dot' }),
      el('span', { text: card.url, title: card.url })));
    if (card.loading) {
      inner.append(el('div', { class: 'link-loading', text: 'Загружаю превью…' }));
    } else {
      inner.append(el('a', { class: 'link-title', href: card.url, 'data-role': 'open-link', text: card.title || host }));
      if (card.description) inner.append(el('div', { class: 'link-desc', text: card.description }));
    }
    e.append(inner);
  },

  body_todo(card, e) {
    const items = card.items || [];
    const done = items.filter((i) => i.done).length;
    const head = el('div', { class: 'todo-head' },
      el('div', { class: 'todo-title', 'data-field': 'title', text: card.title || '' }),
      items.length ? el('span', { class: 'todo-progress', text: done + '/' + items.length }) : null);
    head.firstChild.dataset.placeholder = 'Список дел';
    e.append(head);
    if (items.length) {
      const bar = el('div', { class: 'todo-bar' }, el('div', { style: { width: (done / items.length) * 100 + '%' } }));
      e.append(bar);
    }
    const list = el('div', { class: 'todo-list' });
    for (const it of items) {
      list.append(el('div', { class: 'todo-item' + (it.done ? ' done' : ''), 'data-item': it.id },
        el('span', { class: 'todo-check', 'data-role': 'check' }),
        el('div', { class: 'todo-text', text: it.text })));
    }
    e.append(list);
    e.append(el('div', { class: 'todo-add', 'data-role': 'todo-add', text: '+ Добавить пункт' }));
  },

  body_image(card, e) {
    const img = el('img', { src: assetUrl(card.file), draggable: 'false', alt: card.name || '' });
    img.addEventListener('load', () => {
      if (!card.natW) { card.natW = img.naturalWidth; card.natH = img.naturalHeight; Store.markDirty(App.boardId, false); }
      Render.lines();
    });
    e.append(el('div', { class: 'image-wrap' }, img));
    if (card.caption) e.append(el('div', { class: 'image-caption', text: card.caption }));
  },

  body_file(card, e) {
    const ext = ((card.name || '').split('.').pop() || '').slice(0, 5).toUpperCase();
    e.append(el('div', { class: 'file-row' },
      el('div', { class: 'file-icon' }, el('span', { text: ext || 'FILE' })),
      el('div', { class: 'file-info' },
        el('div', { class: 'file-name', text: card.name || card.file, title: card.name }),
        el('div', { class: 'file-size', text: formatSize(card.size) + ' · двойной щелчок — открыть' }))));
  },

  body_sketch(card, e) {
    const strokes = card.strokes || [];
    const wrap = el('div', { class: 'sketch-wrap' });
    if (strokes.length) wrap.append(Sketch.svg(strokes));
    else wrap.append(el('div', { class: 'sketch-empty' }, sketchIcon('pen'), el('span', { text: 'Дважды щёлкните, чтобы рисовать' })));
    e.append(wrap);
  },

  body_table(card, e) {
    const cells = card.cells || (card.cells = Table.make());
    const cols = cells[0]?.length || 1;
    e.style.setProperty('--cols', cols);
    const title = el('div', { class: 'tbl-title', text: card.title || '' });
    title.dataset.placeholder = 'Новая таблица';
    // буквы столбцов (видны при редактировании)
    const colbar = el('div', { class: 'tbl-colbar' },
      Array.from({ length: cols }, (_, c) => el('div', { class: 'tbl-label', 'data-role': 'tbl-col', 'data-col': c, tabindex: '-1', text: Table.colName(c) })),
      el('div', { class: 'tbl-add tbl-add-col', 'data-role': 'tbl-add-col', tabindex: '-1', title: 'Добавить столбец', text: '+' }));
    const grid = el('div', { class: 'tbl-grid' });
    cells.forEach((row, r) => {
      grid.append(el('div', { class: 'tbl-row' + (r === 0 && card.header !== false ? ' head' : ''), 'data-row': r },
        el('div', { class: 'tbl-label tbl-rowlabel', 'data-role': 'tbl-row', 'data-row': r, tabindex: '-1', text: String(r + 1) }),
        row.map((v, c) => el('div', { class: 'tbl-cell', 'data-col': c, text: v }))));
    });
    grid.append(el('div', { class: 'tbl-add tbl-add-row', 'data-role': 'tbl-add-row', tabindex: '-1', title: 'Добавить строку', text: '+' }));
    const desc = el('div', { class: 'tbl-desc', text: card.desc || '' });
    desc.dataset.placeholder = 'Добавьте описание';
    e.append(colbar, title, grid, desc);
  },

  // ---------- выделение ----------
  selection() {
    for (const [id, e] of this.els) {
      e.classList.toggle('selected', App.selected.has(id));
      e.classList.toggle('editing', App.editingId === id);
    }
  },

  // ---------- стрелки ----------
  cardRect(id) {
    const c = App.cardById(id);
    const e = this.els.get(id);
    if (!c || !e) return null;
    if (c.col) { // карточка в колонке: позиция = колонка + смещение внутри неё
      const p = this.cardRect(c.col);
      const pe = this.els.get(c.col);
      if (!p || !pe) return null;
      return { x: p.x + pe.clientLeft + e.offsetLeft, y: p.y + pe.clientTop + e.offsetTop, w: e.offsetWidth, h: e.offsetHeight };
    }
    return { x: c.x, y: c.y, w: e.offsetWidth, h: e.offsetHeight };
  },

  // Точка на краю прямоугольника по направлению к цели
  edgePoint(r, tx, ty, gap = 8) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const hw = r.w / 2 + gap, hh = r.h / 2 + gap;
    const s = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
    if (s >= 1) return { x: cx, y: cy }; // цель внутри карточки
    return { x: cx + dx * s, y: cy + dy * s };
  },

  endpoints(line) {
    const ra = line.from.card ? this.cardRect(line.from.card) : null;
    const rb = line.to.card ? this.cardRect(line.to.card) : null;
    if ((line.from.card && !ra) || (line.to.card && !rb)) return null;
    const ca = ra ? { x: ra.x + ra.w / 2, y: ra.y + ra.h / 2 } : line.from;
    const cb = rb ? { x: rb.x + rb.w / 2, y: rb.y + rb.h / 2 } : line.to;
    const a = ra ? this.edgePoint(ra, cb.x, cb.y) : { x: ca.x, y: ca.y };
    const b = rb ? this.edgePoint(rb, ca.x, ca.y) : { x: cb.x, y: cb.y };
    return { a, b };
  },

  lines() {
    const g = $('#lines-g');
    const hg = $('#lines-handles');
    g.innerHTML = '';
    hg.innerHTML = '';
    // стрелки к карточкам внутри колонок рисуем поверх карточек, иначе их закроет фон колонки
    const og = document.createDocumentFragment(); // такие стрелки пойдут перед кружками-ручками
    const inCol = (end) => end.card && App.cardById(end.card)?.col;
    for (const line of App.board.lines) {
      const p = this.endpoints(line);
      if (!p) continue;
      const sel = App.selectedLines.has(line.id);
      const d = `M${p.a.x},${p.a.y} L${p.b.x},${p.b.y}`;
      const grp = svgEl('g', { class: 'line' + (sel ? ' selected' : ''), 'data-line': line.id });
      grp.append(svgEl('path', { d, class: 'line-hit' }));
      grp.append(svgEl('path', {
        d, class: 'line-path',
        'marker-end': line.arrow !== false ? (sel ? 'url(#arrow-head-sel)' : 'url(#arrow-head)') : null,
        'marker-start': line.arrowStart ? (sel ? 'url(#arrow-head-sel)' : 'url(#arrow-head)') : null,
        'stroke-dasharray': line.dashed ? '8 6' : null,
      }));
      if (inCol(line.from) || inCol(line.to)) { grp.classList.add('over'); og.append(grp); } else g.append(grp);
      if (sel && App.selectedLines.size === 1) {
        hg.append(svgEl('circle', { cx: p.a.x, cy: p.a.y, r: 6, class: 'line-end', 'data-line': line.id, 'data-end': 'from' }));
        hg.append(svgEl('circle', { cx: p.b.x, cy: p.b.y, r: 6, class: 'line-end', 'data-line': line.id, 'data-end': 'to' }));
      }
    }
    hg.prepend(...og.childNodes);
    // Временная стрелка, пока пользователь тянет соединение
    if (App.tempLine) {
      const t = App.tempLine;
      const ra = this.cardRect(t.from);
      if (ra) {
        const target = t.toCard ? this.cardRect(t.toCard) : null;
        const tp = target ? { x: target.x + target.w / 2, y: target.y + target.h / 2 } : t.to;
        const a = this.edgePoint(ra, tp.x, tp.y);
        const b = target ? this.edgePoint(target, a.x, a.y) : tp;
        (App.cardById(t.from)?.col || (t.toCard && App.cardById(t.toCard)?.col) ? hg : g)
          .append(svgEl('path', { d: `M${a.x},${a.y} L${b.x},${b.y}`, class: 'line-path temp', 'marker-end': 'url(#arrow-head-sel)' }));
      }
    }
  },

  // Обновить x/y карточек в колонках по их фактическому положению на экране —
  // нужно перед копированием/переносом, чтобы карточка без своей колонки встала на то же место
  syncChildPos() {
    for (const c of App.board.cards) if (c.col) {
      const r = this.cardRect(c.id);
      if (r) { c.x = Math.round(r.x); c.y = Math.round(r.y); c.w = Math.round(r.w); }
    }
  },
};
