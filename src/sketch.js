// Скетч: карточка с рисунком и простой редактор рисования.
//
// Карточка: { type: 'sketch', x, y, w, strokes: [{ c: '#цвет', s: толщина, p: [x0, y0, x1, y1, …] }] }
// Координаты штрихов — в логическом поле SKETCH_W × SKETCH_H, поэтому рисунок
// масштабируется вместе с шириной карточки.

const SKETCH_W = 600;
const SKETCH_H = 400;
const SKETCH_COLORS = ['#2b2e33', '#f05a5a', '#f59a3c', '#f2c230', '#5cbf6a', '#3d8ef0', '#9a6cf0', '#f27fb2', '#8a8f98'];
const SKETCH_SIZES = [2, 4, 8, 14];

const SKETCH_ICONS = {
  pen: '<path d="M4 20l1.2-4.6L15.6 5a2.1 2.1 0 0 1 3 3L8.2 18.4z"/><path d="M13.8 6.8l3 3"/>',
  select: '<path d="M5 4l5.5 15 2.2-6.3L19 10.5z"/>',
  eraser: '<path d="M8.5 19.5l-4-4a1.6 1.6 0 0 1 0-2.3l8.7-8.7a1.6 1.6 0 0 1 2.3 0l4 4a1.6 1.6 0 0 1 0 2.3L12 19.5z"/><path d="M9 9l6.5 6.5M8.5 19.5H20"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
};
const sketchIcon = (name) => {
  const s = svgEl('svg', { viewBox: '0 0 24 24' });
  s.innerHTML = SKETCH_ICONS[name];
  return s;
};

const Sketch = {
  active: null, // открытый редактор

  // Сглаженная линия через середины отрезков
  pathD(p) {
    if (p.length < 2) return '';
    if (p.length <= 4) {
      const [x0, y0] = p;
      const x1 = p.length > 2 ? p[2] : x0 + 0.01, y1 = p.length > 2 ? p[3] : y0;
      return `M${x0} ${y0}L${x1} ${y1}`;
    }
    let d = `M${p[0]} ${p[1]}`;
    for (let i = 2; i < p.length - 2; i += 2) {
      const mx = ((p[i] + p[i + 2]) / 2).toFixed(1), my = ((p[i + 1] + p[i + 3]) / 2).toFixed(1);
      d += `Q${p[i]} ${p[i + 1]} ${mx} ${my}`;
    }
    return d + `L${p[p.length - 2]} ${p[p.length - 1]}`;
  },

  strokeEl(st) {
    return svgEl('path', { d: this.pathD(st.p), stroke: st.c, 'stroke-width': st.s, class: 'sk-stroke' });
  },

  // Готовый SVG рисунка (для карточки)
  svg(strokes) {
    const s = svgEl('svg', { viewBox: `0 0 ${SKETCH_W} ${SKETCH_H}`, class: 'sketch-svg' });
    for (const st of strokes) s.append(this.strokeEl(st));
    return s;
  },

  // ---------- геометрия ----------
  bbox(st) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (let i = 0; i < st.p.length; i += 2) {
      x1 = Math.min(x1, st.p[i]); x2 = Math.max(x2, st.p[i]);
      y1 = Math.min(y1, st.p[i + 1]); y2 = Math.max(y2, st.p[i + 1]);
    }
    const h = st.s / 2;
    return { x1: x1 - h, y1: y1 - h, x2: x2 + h, y2: y2 + h };
  },

  // Расстояние от точки до штриха
  dist(st, x, y) {
    const p = st.p;
    let best = Infinity;
    if (p.length === 2) return Math.hypot(x - p[0], y - p[1]);
    for (let i = 0; i < p.length - 2; i += 2) {
      const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
      const dx = bx - ax, dy = by - ay;
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
      best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
    }
    return best;
  },

  hit(strokes, x, y, r) {
    for (let i = strokes.length - 1; i >= 0; i--) if (this.dist(strokes[i], x, y) <= r + strokes[i].s / 2) return i;
    return -1;
  },

  // ---------- редактор ----------
  open(card) {
    if (this.active || !card) return;
    Edit.stop();
    Interact.hideMenu();
    const prefs = Store.settings.sketch || {};
    const ed = {
      card,
      strokes: JSON.parse(JSON.stringify(card.strokes || [])),
      original: JSON.stringify(card.strokes || []),
      undo: [], redo: [],
      tool: 'pen',
      color: SKETCH_COLORS.includes(prefs.color) ? prefs.color : SKETCH_COLORS[1],
      size: SKETCH_SIZES.includes(prefs.size) ? prefs.size : SKETCH_SIZES[1],
      sel: new Set(),
      drag: null,
    };
    this.active = ed;

    ed.svg = svgEl('svg', { viewBox: `0 0 ${SKETCH_W} ${SKETCH_H}`, class: 'sketch-svg' });
    ed.gSel = svgEl('g', { class: 'sk-sel' });
    ed.gStrokes = svgEl('g');
    ed.gOver = svgEl('g');
    ed.svg.append(ed.gSel, ed.gStrokes, ed.gOver);
    ed.paper = el('div', { class: 'sketch-paper' }, ed.svg);

    const toolBtn = (tool, title) => el('button', { class: 'sk-btn', 'data-tool': tool, title, onclick: () => this.setTool(tool) }, sketchIcon(tool));
    ed.colorBtn = el('button', { class: 'sk-btn sk-color', title: 'Цвет', onclick: (e) => this.popup(e.currentTarget, 'color') }, el('span'));
    ed.sizeBtn = el('button', { class: 'sk-btn sk-size', title: 'Толщина', onclick: (e) => this.popup(e.currentTarget, 'size') }, el('span'));
    ed.undoBtn = el('button', { class: 'sk-btn', title: 'Отменить (Ctrl+Z)', onclick: () => this.history('undo', 'redo') }, sketchIcon('undo'));
    ed.redoBtn = el('button', { class: 'sk-btn', title: 'Повторить (Ctrl+Y)', onclick: () => this.history('redo', 'undo') }, sketchIcon('redo'));
    ed.bar = el('div', { class: 'sketch-bar' },
      toolBtn('pen', 'Карандаш (P)'), toolBtn('select', 'Выделение (V)'), toolBtn('eraser', 'Ластик (E)'),
      el('div', { class: 'sk-sep' }),
      ed.colorBtn, ed.sizeBtn,
      el('div', { class: 'sk-sep' }),
      ed.undoBtn, ed.redoBtn,
      el('div', { class: 'sk-sep' }),
      el('button', { class: 'btn', text: 'Отмена', title: 'Закрыть без сохранения (Esc)', onclick: () => this.close(false) }),
      el('button', { class: 'btn primary', text: 'Сохранить', title: 'Сохранить (Ctrl+Enter)', onclick: () => this.close(true) }));
    ed.root = el('div', { class: 'sketch-editor' }, ed.paper, ed.bar);
    document.body.append(ed.root);

    ed.svg.addEventListener('pointerdown', (e) => this.down(e));
    ed.svg.addEventListener('pointermove', (e) => this.move(e));
    ed.svg.addEventListener('pointerup', (e) => this.up(e));
    ed.svg.addEventListener('pointercancel', (e) => this.up(e));
    ed.root.addEventListener('pointerdown', (e) => { if (!e.target.closest('.sk-pop, .sk-color, .sk-size')) this.closePopup(); });
    ed.root.addEventListener('contextmenu', (e) => e.preventDefault());
    ed.onKey = (e) => this.key(e);
    ed.onBlock = (e) => { if (!$('#modal-root').children.length) e.stopPropagation(); };
    ed.onResize = () => this.layout();
    document.addEventListener('keydown', ed.onKey, true);
    document.addEventListener('paste', ed.onBlock, true);
    document.addEventListener('mouseup', ed.onBlock, true);
    window.addEventListener('resize', ed.onResize);

    this.layout();
    this.setTool('pen');
    this.updateStyleBtns();
    this.draw();
  },

  // Вписать лист 3:2 в окно
  layout() {
    const ed = this.active;
    const maxW = innerWidth - 80, maxH = innerHeight - 150;
    const w = Math.max(200, Math.min(maxW, maxH * SKETCH_W / SKETCH_H));
    ed.paper.style.width = w + 'px';
    ed.paper.style.height = (w * SKETCH_H / SKETCH_W) + 'px';
  },

  async close(save) {
    const ed = this.active;
    if (!ed) return;
    const changed = JSON.stringify(ed.strokes) !== ed.original;
    if (!save && changed && !(await confirmBox('Закрыть без сохранения?', 'Изменения в рисунке будут потеряны.', 'Не сохранять'))) return;
    document.removeEventListener('keydown', ed.onKey, true);
    document.removeEventListener('paste', ed.onBlock, true);
    document.removeEventListener('mouseup', ed.onBlock, true);
    window.removeEventListener('resize', ed.onResize);
    ed.root.remove();
    this.active = null;
    Store.settings.sketch = { color: ed.color, size: ed.size };
    Store.saveSettings();
    if (save && changed && App.cardById(ed.card.id)) {
      Store.snapshot();
      ed.card.strokes = ed.strokes;
      Store.markDirty(App.boardId);
      Render.card(ed.card);
    }
    $('#viewport').focus({ preventScroll: true });
  },

  setTool(tool) {
    const ed = this.active;
    ed.tool = tool;
    if (tool !== 'select') ed.sel.clear();
    $$('.sk-btn[data-tool]', ed.bar).forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
    ed.svg.dataset.tool = tool;
    this.draw();
  },

  updateStyleBtns() {
    const ed = this.active;
    ed.colorBtn.firstChild.style.background = ed.color;
    const d = 4 + SKETCH_SIZES.indexOf(ed.size) * 4;
    Object.assign(ed.sizeBtn.firstChild.style, { width: d + 'px', height: d + 'px' });
    ed.undoBtn.disabled = !ed.undo.length;
    ed.redoBtn.disabled = !ed.redo.length;
  },

  popup(anchor, kind) {
    const ed = this.active;
    const wasOpen = ed.pop && ed.pop.dataset.kind === kind;
    this.closePopup();
    if (wasOpen) return;
    const pick = (fn) => { fn(); this.updateStyleBtns(); this.closePopup(); };
    const items = kind === 'color'
      ? SKETCH_COLORS.map((c) => el('button', { class: 'sk-swatch' + (c === ed.color ? ' on' : ''), style: { background: c }, title: c,
          onclick: () => pick(() => { ed.color = c; this.restyleSelection({ c }); }) }))
      : SKETCH_SIZES.map((s, i) => el('button', { class: 'sk-sizeopt' + (s === ed.size ? ' on' : ''), title: ['Тонкая', 'Средняя', 'Толстая', 'Маркер'][i],
          onclick: () => pick(() => { ed.size = s; this.restyleSelection({ s }); }) }, el('span', { style: { height: Math.max(2, s / 1.5) + 'px', background: ed.color } })));
    ed.pop = el('div', { class: 'sk-pop sk-pop-' + kind, 'data-kind': kind }, items);
    ed.root.append(ed.pop);
    const r = anchor.getBoundingClientRect();
    const pr = ed.pop.getBoundingClientRect();
    ed.pop.style.left = Math.max(8, r.left + r.width / 2 - pr.width / 2) + 'px';
    ed.pop.style.top = (r.top - pr.height - 10) + 'px';
  },
  closePopup() {
    const ed = this.active;
    if (ed?.pop) { ed.pop.remove(); ed.pop = null; }
  },

  // Новый цвет/толщина применяется и к выделенным штрихам
  restyleSelection(patch) {
    const ed = this.active;
    if (ed.tool !== 'select' || !ed.sel.size) return;
    this.push();
    for (const i of ed.sel) Object.assign(ed.strokes[i], patch);
    this.draw();
  },

  // ---------- история внутри редактора ----------
  push() {
    const ed = this.active;
    ed.undo.push(JSON.stringify(ed.strokes));
    if (ed.undo.length > 200) ed.undo.shift();
    ed.redo.length = 0;
    this.updateStyleBtns();
  },
  history(from, to) {
    const ed = this.active;
    if (!ed[from].length) return;
    ed[to].push(JSON.stringify(ed.strokes));
    ed.strokes = JSON.parse(ed[from].pop());
    ed.sel.clear();
    this.updateStyleBtns();
    this.draw();
  },

  // ---------- отрисовка ----------
  draw() {
    const ed = this.active;
    ed.gStrokes.innerHTML = '';
    ed.gSel.innerHTML = '';
    ed.gOver.innerHTML = '';
    ed.strokes.forEach((st, i) => {
      const p = this.strokeEl(st);
      ed.gStrokes.append(p);
      if (ed.sel.has(i)) ed.gSel.append(svgEl('path', { d: p.getAttribute('d'), 'stroke-width': st.s + 7, class: 'sk-halo' }));
    });
    if (ed.sel.size) {
      const b = this.selBox();
      ed.gOver.append(svgEl('rect', { x: b.x1 - 6, y: b.y1 - 6, width: b.x2 - b.x1 + 12, height: b.y2 - b.y1 + 12, class: 'sk-selbox' }));
    }
    if (ed.drag?.kind === 'marquee' && ed.drag.moved) {
      const m = ed.drag;
      ed.gOver.append(svgEl('rect', { x: Math.min(m.x0, m.x), y: Math.min(m.y0, m.y), width: Math.abs(m.x - m.x0), height: Math.abs(m.y - m.y0), class: 'sk-marquee' }));
    }
    $('.sketch-hint', ed.paper)?.remove();
    if (!ed.strokes.length && !ed.drag) ed.paper.append(el('div', { class: 'sketch-hint', text: 'Рисуйте здесь' }));
  },

  selBox() {
    const ed = this.active;
    const b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    for (const i of ed.sel) {
      const r = this.bbox(ed.strokes[i]);
      b.x1 = Math.min(b.x1, r.x1); b.y1 = Math.min(b.y1, r.y1);
      b.x2 = Math.max(b.x2, r.x2); b.y2 = Math.max(b.y2, r.y2);
    }
    return b;
  },

  // ---------- мышь / перо ----------
  pt(e) {
    const r = this.active.svg.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * SKETCH_W * 10) / 10,
      y: Math.round(((e.clientY - r.top) / r.height) * SKETCH_H * 10) / 10,
    };
  },
  // Сколько логических единиц в одном экранном пикселе
  unit() { return SKETCH_W / this.active.svg.getBoundingClientRect().width; },

  down(e) {
    const ed = this.active;
    if (e.button !== 0 || ed.drag) return;
    e.preventDefault();
    ed.svg.setPointerCapture(e.pointerId);
    const p = this.pt(e);
    $('.sketch-hint', ed.paper)?.remove();

    if (ed.tool === 'pen') {
      this.push();
      const st = { c: ed.color, s: ed.size, p: [p.x, p.y] };
      ed.strokes.push(st);
      const path = this.strokeEl(st);
      ed.gStrokes.append(path);
      ed.drag = { kind: 'pen', st, path };
      return;
    }
    if (ed.tool === 'eraser') {
      this.push();
      ed.drag = { kind: 'eraser', erased: false };
      this.erase(p);
      return;
    }
    // выделение
    const i = this.hit(ed.strokes, p.x, p.y, 6 * this.unit());
    const inBox = ed.sel.size && (() => { const b = this.selBox(); return p.x >= b.x1 - 6 && p.x <= b.x2 + 6 && p.y >= b.y1 - 6 && p.y <= b.y2 + 6; })();
    if (i >= 0 || inBox) {
      if (i >= 0 && e.shiftKey) { ed.sel.has(i) ? ed.sel.delete(i) : ed.sel.add(i); this.draw(); return; }
      if (i >= 0 && !ed.sel.has(i)) ed.sel = new Set([i]);
      ed.drag = { kind: 'move', x0: p.x, y0: p.y, orig: [...ed.sel].map((k) => [k, ed.strokes[k].p.slice()]), moved: false };
      this.draw();
      return;
    }
    ed.drag = { kind: 'marquee', x0: p.x, y0: p.y, x: p.x, y: p.y, add: e.shiftKey, base: new Set(e.shiftKey ? ed.sel : []), moved: false };
    if (!e.shiftKey) { ed.sel.clear(); this.draw(); }
  },

  move(e) {
    const ed = this.active;
    const d = ed?.drag;
    if (!d) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (d.kind === 'pen') {
      const minStep = 0.8 * this.unit();
      for (const ev of events.length ? events : [e]) {
        const p = this.pt(ev);
        const n = d.st.p.length;
        if (Math.hypot(p.x - d.st.p[n - 2], p.y - d.st.p[n - 1]) < minStep) continue;
        d.st.p.push(p.x, p.y);
      }
      d.path.setAttribute('d', this.pathD(d.st.p));
      return;
    }
    if (d.kind === 'eraser') {
      for (const ev of events.length ? events : [e]) this.erase(this.pt(ev));
      return;
    }
    const p = this.pt(e);
    if (d.kind === 'move') {
      const dx = p.x - d.x0, dy = p.y - d.y0;
      if (!d.moved && Math.hypot(dx, dy) < 2 * this.unit()) return;
      if (!d.moved) { d.moved = true; this.push(); }
      for (const [k, orig] of d.orig) ed.strokes[k].p = orig.map((v, j) => Math.round((v + (j % 2 ? dy : dx)) * 10) / 10);
      this.draw();
      return;
    }
    if (d.kind === 'marquee') {
      d.x = p.x; d.y = p.y;
      d.moved = true;
      const x1 = Math.min(d.x0, d.x), x2 = Math.max(d.x0, d.x), y1 = Math.min(d.y0, d.y), y2 = Math.max(d.y0, d.y);
      ed.sel = new Set(d.base);
      ed.strokes.forEach((st, i) => {
        for (let j = 0; j < st.p.length; j += 2) {
          if (st.p[j] >= x1 && st.p[j] <= x2 && st.p[j + 1] >= y1 && st.p[j + 1] <= y2) { ed.sel.add(i); break; }
        }
      });
      this.draw();
    }
  },

  up() {
    const ed = this.active;
    const d = ed?.drag;
    if (!d) return;
    ed.drag = null;
    if (d.kind === 'eraser' && !d.erased) { ed.undo.pop(); this.updateStyleBtns(); }
    this.draw();
  },

  erase(p) {
    const ed = this.active;
    const r = Math.max(6, ed.size) * this.unit();
    let i;
    while ((i = this.hit(ed.strokes, p.x, p.y, r)) >= 0) {
      ed.strokes.splice(i, 1);
      ed.drag.erased = true;
    }
    if (ed.drag.erased) this.draw();
  },

  deleteSelected() {
    const ed = this.active;
    if (!ed.sel.size) return;
    this.push();
    ed.strokes = ed.strokes.filter((_, i) => !ed.sel.has(i));
    ed.sel.clear();
    this.draw();
  },

  // ---------- клавиатура ----------
  key(e) {
    const ed = this.active;
    if (!ed || $('#modal-root').children.length) return; // открыт диалог подтверждения — пусть он обрабатывает
    e.stopPropagation();
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (ed.pop) this.closePopup();
      else if (ed.sel.size) { ed.sel.clear(); this.draw(); }
      else this.close(false);
      return;
    }
    if (ctrl && e.key === 'Enter') { e.preventDefault(); this.close(true); return; }
    if (ed.drag) return;
    if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); this.history('undo', 'redo'); return; }
    if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this.history('redo', 'undo'); return; }
    if (ctrl && k === 'a') { e.preventDefault(); this.setTool('select'); ed.sel = new Set(ed.strokes.map((_, i) => i)); this.draw(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteSelected(); return; }
    if (ctrl || e.altKey) return;
    if (k === 'p' || k === 'b') this.setTool('pen');
    else if (k === 'v') this.setTool('select');
    else if (k === 'e') this.setTool('eraser');
    else if (k === '[' || k === ']') {
      const i = SKETCH_SIZES.indexOf(ed.size) + (k === ']' ? 1 : -1);
      if (SKETCH_SIZES[i]) { ed.size = SKETCH_SIZES[i]; this.restyleSelection({ s: ed.size }); this.updateStyleBtns(); }
    }
  },
};
