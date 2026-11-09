// Мини-карта: появляется в правом нижнем углу, пока двигаем холст,
// и схематично показывает все карточки доски и видимую область (рамку экрана).

const Minimap = {
  box: null,
  canvas: null,
  hideTimer: null,
  frame: 0,
  MAX_W: 240,
  MAX_H: 170,

  ensure() {
    if (this.box) return;
    this.canvas = el('canvas');
    this.box = el('div', { id: 'minimap' }, this.canvas);
    $('#viewport').append(this.box);
  },

  // Показать и перерисовать (не чаще раза за кадр)
  show() {
    this.ensure();
    clearTimeout(this.hideTimer);
    this.box.classList.add('visible');
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  },

  hideSoon(delay = 300) {
    if (!this.box) return;
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.box.classList.remove('visible'), delay);
  },

  hideNow() {
    if (!this.box) return;
    clearTimeout(this.hideTimer);
    this.box.classList.remove('visible');
  },

  // Цвет карточки на схеме
  colorOf(c) {
    if (c.type === 'board') return Store.get(c.boardId)?.color || '#8d8f94';
    if (c.type === 'note') {
      const col = NOTE_COLORS[c.color];
      return c.style === 'stripe' || !col || c.color === 'none' ? '#ffffff' : col.bg;
    }
    if (c.type === 'image' || c.type === 'sketch') return '#cfd3d9';
    if (c.type === 'column') return '#dfe2e7';
    return '#ffffff';
  },

  draw() {
    const vpEl = $('#viewport');
    const vr = vpEl.getBoundingClientRect();
    const a = App.screenToWorld(vr.left, vr.top);
    const b = App.screenToWorld(vr.right, vr.bottom);
    const view = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };

    // Карточки (вложенные в колонку рисуются как часть колонки)
    const rects = [];
    for (const c of App.board.cards) {
      if (c.col) continue;
      const r = Render.cardRect(c.id);
      if (r) rects.push({ r, c });
    }

    // Границы схемы: всё содержимое + текущий экран, с небольшим запасом
    let minX = view.x, minY = view.y, maxX = view.x + view.w, maxY = view.y + view.h;
    for (const { r } of rects) {
      minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
    }
    const pad = Math.max(maxX - minX, maxY - minY) * 0.04;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const bw = maxX - minX, bh = maxY - minY;

    // Размер мини-карты по пропорциям содержимого
    let W = this.MAX_W, H = Math.round(W * bh / bw);
    if (H > this.MAX_H) { H = this.MAX_H; W = Math.round(H * bw / bh); }
    W = Math.max(W, 90); H = Math.max(H, 60);
    const k = Math.min(W / bw, H / bh);
    const ox = (W - bw * k) / 2, oy = (H - bh * k) / 2;
    const tx = (x) => ox + (x - minX) * k;
    const ty = (y) => oy + (y - minY) * k;

    const dpr = window.devicePixelRatio || 1;
    const cv = this.canvas;
    if (cv.width !== W * dpr || cv.height !== H * dpr) {
      cv.width = W * dpr; cv.height = H * dpr;
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    // Стрелки
    g.strokeStyle = 'rgba(74, 79, 87, .45)';
    g.lineWidth = 1;
    for (const line of App.board.lines) {
      const p = Render.endpoints(line);
      if (!p) continue;
      g.beginPath();
      g.moveTo(tx(p.a.x), ty(p.a.y));
      g.lineTo(tx(p.b.x), ty(p.b.y));
      g.stroke();
    }

    // Карточки
    for (const { r, c } of rects) {
      const x = tx(r.x), y = ty(r.y);
      const w = Math.max(4, r.w * k), h = Math.max(3, r.h * k);
      if (c.type === 'board') {
        // у доски рисуем только значок (верхняя квадратная часть)
        const s = Math.max(5, Math.min(w, 72 * k));
        g.fillStyle = this.colorOf(c);
        this.roundRect(g, x + (w - s) / 2, y, s, s, Math.min(3, s / 4));
        g.fill();
        continue;
      }
      g.fillStyle = this.colorOf(c);
      this.roundRect(g, x, y, w, h, 1.5);
      g.fill();
      g.strokeStyle = 'rgba(20, 24, 30, .14)';
      g.stroke();
      if (App.selected.has(c.id)) {
        g.strokeStyle = '#2f7cf6';
        g.lineWidth = 1.5;
        g.stroke();
        g.lineWidth = 1;
      }
    }

    // Видимая область
    const vx = tx(view.x), vy = ty(view.y), vw = view.w * k, vh = view.h * k;
    g.fillStyle = 'rgba(47, 124, 246, .08)';
    g.fillRect(vx, vy, vw, vh);
    g.strokeStyle = '#2f7cf6';
    g.lineWidth = 1.5;
    g.strokeRect(vx + 0.75, vy + 0.75, Math.max(0, vw - 1.5), Math.max(0, vh - 1.5));
  },

  roundRect(g, x, y, w, h, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r);
    else g.rect(x, y, w, h);
  },
};
