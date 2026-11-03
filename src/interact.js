// Взаимодействие: мышь, клавиатура, перетаскивание, вставка, контекстное меню.

const Interact = {
  drag: null,       // текущее действие мышью
  spaceDown: false,
  suppressCtx: false,
  lastPointer: { x: 0, y: 0 },

  init() {
    const vp = $('#viewport');
    vp.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    vp.addEventListener('dblclick', (e) => this.onDblClick(e));
    vp.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    vp.addEventListener('contextmenu', (e) => this.onContext(e));
    vp.addEventListener('click', (e) => {
      if (e.target.closest('a')) e.preventDefault(); // ссылки открываем сами
    });
    vp.addEventListener('keydown', (e) => { if (App.editingId && !Format.key(e)) { Edit.todoKey(e); Edit.columnKey(e); Table.key(e); } });
    vp.addEventListener('input', () => { if (App.editingId) requestAnimationFrame(() => { Render.lines(); Format.position(); }); });
    vp.addEventListener('paste', (e) => this.onEditPaste(e), true);
    vp.addEventListener('focusout', (e) => {
      // Ушли из редактируемой карточки (кликом в другое место) — завершить редактирование
      if (!App.editingId) return;
      const card = Render.els.get(App.editingId);
      if (card && !card.contains(e.relatedTarget) && !this.drag) setTimeout(() => {
        // карточка могла перерисоваться (таблица после вставки строки) — берём актуальный элемент
        const cur = Render.els.get(App.editingId);
        if (App.editingId && !(cur && cur.contains(document.activeElement))) Edit.stop();
      }, 0);
    });

    document.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('keyup', (e) => { if (e.code === 'Space') { this.spaceDown = false; vp.classList.remove('grab'); } });
    document.addEventListener('paste', (e) => this.onPaste(e));
    document.addEventListener('mouseup', (e) => { if (e.button === 3 && !App.editingId) App.goUp(); });

    vp.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; vp.classList.add('drop'); });
    vp.addEventListener('dragleave', (e) => { if (e.target === vp) vp.classList.remove('drop'); });
    vp.addEventListener('drop', (e) => this.onDrop(e));

    this.initToolbar();
    this.initHeader();
    window.addEventListener('blur', () => { this.spaceDown = false; });
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#ctx-menu')) this.hideMenu(); }, true);
  },

  // ---------- мышь ----------
  onDown(e) {
    this.lastPointer = { x: e.clientX, y: e.clientY };
    const t = e.target;
    const cardEl = t.closest('.card');
    const lineEl = t.closest('[data-line]');
    const role = t.closest('[data-role]')?.dataset.role;

    // Панорама: средняя кнопка, правая кнопка по пустому месту, или пробел + левая
    if (e.button === 1 || (e.button === 0 && this.spaceDown) || (e.button === 2 && !cardEl && !lineEl)) {
      e.preventDefault();
      this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: App.view.x, vy: App.view.y, moved: false, button: e.button };
      $('#viewport').classList.add('panning');
      return;
    }
    if (e.button !== 0) {
      if (cardEl && !App.selected.has(cardEl.dataset.id)) App.select([cardEl.dataset.id]);
      return;
    }

    // Конец стрелки
    if (t.classList.contains('line-end')) {
      e.preventDefault();
      Store.snapshot();
      this.drag = { kind: 'line-end', lineId: t.dataset.line, end: t.dataset.end, moved: false };
      return;
    }
    // Клик по стрелке
    if (lineEl && !cardEl) {
      e.preventDefault();
      Edit.stop();
      const id = lineEl.dataset.line;
      if (e.shiftKey || e.ctrlKey) {
        App.selectedLines.has(id) ? App.selectedLines.delete(id) : App.selectedLines.add(id);
      } else {
        App.selected.clear();
        App.selectedLines = new Set([id]);
      }
      Render.selection();
      Render.lines();
      // тянуть свободную стрелку целиком
      const line = App.board.lines.find((l) => l.id === id);
      if (line && !line.from.card && !line.to.card) {
        const p = App.screenToWorld(e.clientX, e.clientY);
        this.drag = { kind: 'line-move', line, start: p, from: { ...line.from }, to: { ...line.to }, moved: false };
      }
      return;
    }

    if (cardEl) {
      const id = cardEl.dataset.id;
      const card = App.cardById(id);
      if (!card) return;

      // Внутри редактируемой карточки — обычное выделение текста
      if (App.editingId === id && t.closest('[contenteditable]')) return;

      if (role === 'resize') {
        e.preventDefault();
        Store.snapshot();
        this.drag = { kind: 'resize', card, sx: e.clientX, w: cardEl.offsetWidth, moved: false };
        return;
      }
      if (role === 'connect') {
        e.preventDefault();
        Edit.stop();
        App.tempLine = { from: id, to: App.screenToWorld(e.clientX, e.clientY), toCard: null };
        this.drag = { kind: 'connect', from: id, moved: false };
        return;
      }
      if (role === 'check') {
        e.preventDefault();
        this.toggleCheck(card, t.closest('.todo-item').dataset.item);
        return;
      }
      if (role === 'todo-add') {
        e.preventDefault();
        if (App.editingId !== id) Edit.start(id);
        Edit.read();
        Edit.insertItem(card, card.items.length);
        return;
      }
      if (role === 'tbl-add-row' || role === 'tbl-add-col') {
        e.preventDefault();
        const { rows, cols } = Table.size(card);
        if (role === 'tbl-add-row') Table.change(card, (k) => Table.insertRow(k, rows), { r: rows, c: 0 });
        else Table.change(card, (k) => Table.insertCol(k, cols), { r: 0, c: cols });
        return;
      }
      if (role === 'tbl-row' || role === 'tbl-col') {
        e.preventDefault();
        const lab = t.closest('[data-role]');
        const r = lab.getBoundingClientRect();
        const items = role === 'tbl-row' ? Table.rowItems(card, +lab.dataset.row) : Table.colItems(card, +lab.dataset.col);
        if (role === 'tbl-row' && +lab.dataset.row === 0) items.push('-', Table.headerItem(card));
        this.showMenu(role === 'tbl-row' ? r.right + 4 : r.left, role === 'tbl-row' ? r.top : r.bottom + 4, items, true);
        return;
      }

      e.preventDefault();
      if (App.editingId && App.editingId !== id) Edit.stop();
      const wasSelected = App.selected.has(id) && App.selected.size === 1;
      if (e.shiftKey || e.ctrlKey) {
        App.selected.has(id) ? App.selected.delete(id) : App.selected.add(id);
        Render.selection();
        Render.lines();
      } else if (!App.selected.has(id)) {
        App.select([id]);
      }
      const start = App.screenToWorld(e.clientX, e.clientY);
      // карточки внутри выбранной колонки едут вместе с ней, отдельно их не двигаем
      const items = App.board.cards.filter((c) => App.selected.has(c.id) && !(c.col && App.selected.has(c.col))).map((c) => ({ c, x: c.x, y: c.y }));
      const onHead = card.type === 'column' && t.closest('.card') === cardEl && !!t.closest('.col-head');
      this.drag = { kind: 'move', id, items, start, sx: e.clientX, sy: e.clientY, moved: false, wasSelected, role, onHead, point: { x: e.clientX, y: e.clientY }, shift: e.shiftKey || e.ctrlKey };
      return;
    }

    // Пустое место — рамка выделения
    if (App.editingId) Edit.stop();
    this.hideMenu();
    $('#viewport').focus({ preventScroll: true });
    const vp = $('#viewport').getBoundingClientRect();
    this.drag = { kind: 'marquee', sx: e.clientX - vp.left, sy: e.clientY - vp.top, add: e.shiftKey || e.ctrlKey, moved: false, base: new Set(App.selected), baseLines: new Set(App.selectedLines) };
    if (!this.drag.add) App.clearSelection();
  },

  onMove(e) {
    this.lastPointer = { x: e.clientX, y: e.clientY };
    const d = this.drag;
    if (!d) return;
    const p = App.screenToWorld(e.clientX, e.clientY);

    if (d.kind === 'pan') {
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      App.view.x = d.vx + dx;
      App.view.y = d.vy + dy;
      App.applyView();
      return;
    }

    if (d.kind === 'move') {
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
      if (!d.moved) {
        d.moved = true;
        Store.snapshot();
        this.detachFromColumns(d);
        $('#viewport').classList.add('dragging');
        for (const it of d.items) Render.els.get(it.c.id)?.classList.add('lifting');
      }
      const dx = p.x - d.start.x, dy = p.y - d.start.y;
      for (const it of d.items) {
        it.c.x = Math.round(it.x + dx);
        it.c.y = Math.round(it.y + dy);
        Render.position(it.c);
      }
      // Подсветка доски, в которую можно бросить
      const target = this.boardCardAt(e.clientX, e.clientY, App.selected);
      if (d.dropTarget !== target) {
        if (d.dropTarget) Render.els.get(d.dropTarget.id)?.classList.remove('drop-target');
        d.dropTarget = target;
        if (target) Render.els.get(target.id)?.classList.add('drop-target');
        $('#viewport').classList.toggle('over-board', !!target);
      }
      // ...или колонка, в которую можно положить карточки (сами колонки не вкладываются)
      this.updateColumnTarget(d, target ? null : e);
      Render.lines();
      return;
    }

    if (d.kind === 'resize') {
      d.moved = true;
      const minW = d.card.type === 'image' || d.card.type === 'sketch' ? 90 : d.card.type === 'table' ? Math.max(140, Table.size(d.card).cols * 48) : d.card.type === 'column' ? 200 : 140;
      const w = Math.max(minW, Math.min(1400, d.w + (e.clientX - d.sx) / App.view.z));
      d.card.w = Math.round(w);
      Render.position(d.card);
      Render.lines();
      return;
    }

    if (d.kind === 'connect') {
      d.moved = true;
      const target = this.cardAt(e.clientX, e.clientY, new Set([d.from]));
      App.tempLine.to = p;
      App.tempLine.toCard = target ? target.id : null;
      $$('.card.connect-target').forEach((x) => x.classList.remove('connect-target'));
      if (target) Render.els.get(target.id)?.classList.add('connect-target');
      Render.lines();
      return;
    }

    if (d.kind === 'line-end') {
      d.moved = true;
      const line = App.board.lines.find((l) => l.id === d.lineId);
      const other = d.end === 'from' ? line.to : line.from;
      const target = this.cardAt(e.clientX, e.clientY, new Set(other.card ? [other.card] : []));
      line[d.end] = target ? { card: target.id } : { x: Math.round(p.x), y: Math.round(p.y) };
      $$('.card.connect-target').forEach((x) => x.classList.remove('connect-target'));
      if (target) Render.els.get(target.id)?.classList.add('connect-target');
      Render.lines();
      return;
    }

    if (d.kind === 'line-move') {
      if (!d.moved) Store.snapshot();
      d.moved = true;
      const dx = p.x - d.start.x, dy = p.y - d.start.y;
      d.line.from = { x: Math.round(d.from.x + dx), y: Math.round(d.from.y + dy) };
      d.line.to = { x: Math.round(d.to.x + dx), y: Math.round(d.to.y + dy) };
      Render.lines();
      return;
    }

    if (d.kind === 'marquee') {
      const vp = $('#viewport').getBoundingClientRect();
      const x = e.clientX - vp.left, y = e.clientY - vp.top;
      if (!d.moved && Math.hypot(x - d.sx, y - d.sy) < 4) return;
      d.moved = true;
      const m = $('#marquee');
      const left = Math.min(x, d.sx), top = Math.min(y, d.sy), w = Math.abs(x - d.sx), h = Math.abs(y - d.sy);
      Object.assign(m.style, { left: left + 'px', top: top + 'px', width: w + 'px', height: h + 'px' });
      m.hidden = false;
      const a = App.screenToWorld(left + vp.left, top + vp.top);
      const b = App.screenToWorld(left + w + vp.left, top + h + vp.top);
      const sel = new Set(d.base);
      for (const c of App.board.cards) {
        const r = Render.cardRect(c.id);
        if (r && r.x < b.x && r.x + r.w > a.x && r.y < b.y && r.y + r.h > a.y) sel.add(c.id);
      }
      const selL = new Set(d.baseLines);
      for (const l of App.board.lines) {
        const pts = Render.endpoints(l);
        if (!pts) continue;
        const mx = (pts.a.x + pts.b.x) / 2, my = (pts.a.y + pts.b.y) / 2;
        if (mx > a.x && mx < b.x && my > a.y && my < b.y) selL.add(l.id);
      }
      App.selected = sel;
      App.selectedLines = selL;
      Render.selection();
      Render.lines();
    }
  },

  onUp(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    $('#viewport').classList.remove('panning', 'dragging', 'over-board');
    $$('.card.lifting, .card.connect-target, .card.drop-target, .card.col-target').forEach((x) => x.classList.remove('lifting', 'connect-target', 'drop-target', 'col-target'));
    $$('.col-marker').forEach((x) => x.remove());

    if (d.kind === 'pan') {
      if (d.button === 2) {
        this.suppressCtx = d.moved;
      }
      return;
    }

    if (d.kind === 'move') {
      if (d.moved) {
        if (d.dropTarget) {
          Actions.moveToBoard(new Set(App.selected), d.dropTarget.boardId);
        } else if (d.colTarget) {
          Actions.insertIntoColumn(new Set(d.items.map((it) => it.c.id)), d.colTarget.id, d.colBefore);
        } else {
          Store.markDirty(App.boardId);
        }
        return;
      }
      const card = App.cardById(d.id);
      // Клик без перетаскивания
      if (d.role === 'open-link' && card?.url) { window.api.openExternal(card.url); return; }
      if (!d.shift && !d.wasSelected) { App.select([d.id]); return; }
      // Повторный клик по выбранной заметке (или по заголовку колонки) — начать редактирование
      if (!d.shift && d.wasSelected && card && (['note', 'todo', 'table'].includes(card.type) || (card.type === 'column' && d.onHead))) {
        Edit.start(card.id, { point: d.point, focusItem: e.target.closest?.('.todo-item')?.dataset.item });
      }
      return;
    }

    if (d.kind === 'resize') {
      Store.dropSnapshotIfSame();
      Store.markDirty(App.boardId);
      return;
    }

    if (d.kind === 'connect') {
      const t = App.tempLine;
      App.tempLine = null;
      if (t && (t.toCard || (d.moved && this.farFromCard(t.from, t.to)))) {
        Store.snapshot();
        const line = { id: uid(), from: { card: t.from }, to: t.toCard ? { card: t.toCard } : { x: Math.round(t.to.x), y: Math.round(t.to.y) }, arrow: true };
        App.board.lines.push(line);
        Store.markDirty(App.boardId);
        App.selected.clear();
        App.selectedLines = new Set([line.id]);
        Render.selection();
      }
      Render.lines();
      return;
    }

    if (d.kind === 'line-end' || d.kind === 'line-move') {
      Store.dropSnapshotIfSame();
      Store.markDirty(App.boardId);
      Render.lines();
      return;
    }

    if (d.kind === 'marquee') {
      $('#marquee').hidden = true;
    }
  },

  farFromCard(cardId, p) {
    const r = Render.cardRect(cardId);
    if (!r) return false;
    return p.x < r.x - 30 || p.x > r.x + r.w + 30 || p.y < r.y - 30 || p.y > r.y + r.h + 30;
  },

  cardAt(clientX, clientY, exclude = new Set()) {
    const p = App.screenToWorld(clientX, clientY);
    // карточки внутри колонок лежат поверх колонки — проверяем их первыми
    const cards = [...App.board.cards.filter((c) => !c.col), ...App.board.cards.filter((c) => c.col)];
    for (let i = cards.length - 1; i >= 0; i--) {
      const c = cards[i];
      if (exclude.has(c.id) || (c.col && exclude.has(c.col))) continue;
      const r = Render.cardRect(c.id);
      if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return c;
    }
    return null;
  },

  // Начали тащить карточки, лежащие в колонке: вынуть их на холст на том же месте
  detachFromColumns(d) {
    const out = d.items.filter((it) => it.c.col);
    if (!out.length) return;
    for (const it of out) {
      const r = Render.cardRect(it.c.id);
      if (!r) continue;
      it.x = it.c.x = Math.round(r.x);
      it.y = it.c.y = Math.round(r.y);
      it.c.w = Math.round(r.w);
    }
    for (const it of out) delete it.c.col;
    Render.sync();
  },

  // Колонка под курсором и место вставки в ней; e = null — убрать подсветку
  updateColumnTarget(d, e) {
    let col = null, before = null;
    if (e && !d.items.some((it) => it.c.type === 'column')) {
      const p = App.screenToWorld(e.clientX, e.clientY);
      const moving = new Set(d.items.map((it) => it.c.id));
      const cards = App.board.cards;
      for (let i = cards.length - 1; i >= 0 && !col; i--) {
        const c = cards[i];
        if (c.type !== 'column' || moving.has(c.id)) continue;
        const r = Render.cardRect(c.id);
        if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) col = c;
      }
      if (col) for (const c of cards) {
        if (c.col !== col.id || moving.has(c.id)) continue;
        const r = Render.cardRect(c.id);
        if (r && p.y < r.y + r.h / 2) { before = c.id; break; }
      }
    }
    if (d.colTarget === col && d.colBefore === before) return;
    if (d.colTarget) Render.els.get(d.colTarget.id)?.classList.remove('col-target');
    $$('.col-marker').forEach((x) => x.remove());
    d.colTarget = col;
    d.colBefore = before;
    if (!col) return;
    const ce = Render.els.get(col.id);
    ce.classList.add('col-target');
    const list = $('.col-list', ce);
    list.insertBefore(el('div', { class: 'col-marker' }), before ? Render.els.get(before) : null);
  },

  boardCardAt(clientX, clientY, exclude) {
    const c = this.cardAt(clientX, clientY, exclude);
    return c && c.type === 'board' ? c : null;
  },

  toggleCheck(card, itemId) {
    const it = card.items.find((i) => i.id === itemId);
    if (!it) return;
    if (App.editingId === card.id) {
      Edit.read();
      it.done = !it.done;
      const e = Render.els.get(card.id);
      $(`[data-item="${itemId}"]`, e).classList.toggle('done', it.done);
      Store.markDirty(App.boardId);
      return;
    }
    Store.snapshot();
    it.done = !it.done;
    Store.markDirty(App.boardId);
    Render.card(card);
  },

  onDblClick(e) {
    const cardEl = e.target.closest('.card');
    if (!cardEl) {
      if (e.target.closest('[data-line]')) return;
      const p = App.screenToWorld(e.clientX, e.clientY);
      Actions.note({ x: Math.round(p.x - 20), y: Math.round(p.y - 20) });
      return;
    }
    const card = App.cardById(cardEl.dataset.id);
    if (!card) return;
    if (card.type === 'board') App.open(card.boardId);
    else if (card.type === 'link') window.api.openExternal(card.url);
    else if (card.type === 'image' || card.type === 'file') window.api.openAsset(card.file);
    else if (card.type === 'sketch') Sketch.open(card);
    else if (App.editingId !== card.id) Edit.start(card.id, { point: { x: e.clientX, y: e.clientY } });
  },

  onWheel(e) {
    if (e.target.closest('.card.editing')) return;
    e.preventDefault();
    const vp = $('#viewport').getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      App.zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX - vp.left, e.clientY - vp.top);
    } else {
      const k = e.deltaMode === 1 ? 30 : 1;
      App.view.x -= (e.shiftKey ? e.deltaY : e.deltaX) * k;
      App.view.y -= (e.shiftKey ? 0 : e.deltaY) * k;
      App.applyView();
    }
  },

  // ---------- клавиатура ----------
  onKey(e) {
    if ($('#modal-root').children.length) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const inText = App.editingId || e.target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(e.target.tagName);

    if (e.key === 'Escape') {
      this.hideMenu();
      if (App.editingId) { Edit.stop(); return; }
      if (e.target.id === 'board-title') { e.target.blur(); return; }
      App.clearSelection();
      return;
    }
    if (ctrl && k === 'f') { e.preventDefault(); openSearch(); return; }
    if (inText) {
      if (App.editingId && ctrl && e.key === 'Enter') { e.preventDefault(); Edit.stop(); }
      return;
    }
    if (e.code === 'Space') { this.spaceDown = true; $('#viewport').classList.add('grab'); e.preventDefault(); return; }

    if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); if (Store.undo(App.boardId)) this.afterHistory(); return; }
    if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); if (Store.redo(App.boardId)) this.afterHistory(); return; }
    if (ctrl && k === 'd') { e.preventDefault(); Actions.duplicate(); return; }
    if (ctrl && k === 'a') { e.preventDefault(); App.selected = new Set(App.board.cards.map((c) => c.id)); App.selectedLines = new Set(App.board.lines.map((l) => l.id)); Render.selection(); Render.lines(); return; }
    if (ctrl && k === 'c') { if (Actions.copy()) e.preventDefault(); return; }
    if (ctrl && k === 'x') { if (Actions.copy()) { e.preventDefault(); Actions.deleteSelection(); } return; }
    if (ctrl && (k === '0')) { e.preventDefault(); App.view.z = 1; App.applyView(); return; }
    if (ctrl && (k === '=' || k === '+')) { e.preventDefault(); const r = $('#viewport').getBoundingClientRect(); App.zoomAt(1.2, r.width / 2, r.height / 2); return; }
    if (ctrl && k === '-') { e.preventDefault(); const r = $('#viewport').getBoundingClientRect(); App.zoomAt(1 / 1.2, r.width / 2, r.height / 2); return; }
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) { e.preventDefault(); App.goUp(); return; }

    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); Actions.deleteSelection(); return; }
    if (e.key === 'Enter' && App.selected.size === 1) {
      const c = App.cardById([...App.selected][0]);
      if (c?.type === 'board') App.open(c.boardId);
      else if (c?.type === 'sketch') Sketch.open(c);
      else if (c) Edit.start(c.id);
      e.preventDefault();
      return;
    }
    if (e.key.startsWith('Arrow') && App.selected.size) {
      e.preventDefault();
      const step = e.shiftKey ? 20 : 2;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      Store.snapshot();
      for (const c of App.board.cards) if (App.selected.has(c.id)) { c.x += dx; c.y += dy; Render.position(c); }
      Render.lines();
      Store.markDirty(App.boardId);
      return;
    }
    if (!ctrl && !e.altKey) {
      const pos = this.pointerPos();
      if (k === 'n') { e.preventDefault(); Actions.note(pos); }
      else if (k === 't') { e.preventDefault(); Actions.todo(pos); }
      else if (k === 'l') { e.preventDefault(); Actions.link(pos); }
      else if (k === 'b') { e.preventDefault(); Actions.board(pos); }
      else if (k === 'a') { e.preventDefault(); Actions.line(pos); }
      else if (k === 'd') { e.preventDefault(); Actions.sketch(pos); }
      else if (k === 'g') { e.preventDefault(); Actions.table(pos); }
      else if (k === 'c') { e.preventDefault(); Actions.column(pos); }
    }
  },

  // Позиция под курсором, если он над холстом, иначе центр экрана
  pointerPos() {
    const vp = $('#viewport').getBoundingClientRect();
    const { x, y } = this.lastPointer;
    if (x > vp.left && x < vp.right && y > vp.top && y < vp.bottom) {
      const p = App.screenToWorld(x, y);
      return { x: Math.round(p.x - 20), y: Math.round(p.y - 20) };
    }
    return App.centerPos();
  },

  afterHistory() {
    App.editingId = null;
    const ids = new Set(App.board.cards.map((c) => c.id));
    App.selected = new Set([...App.selected].filter((id) => ids.has(id)));
    App.selectedLines.clear();
    Render.board();
  },

  // ---------- вставка ----------
  onEditPaste(e) {
    // Вставка в заметку: только простой текст (без чужих стилей)
    if (!App.editingId || !e.target.closest('[contenteditable]')) return;
    const text = e.clipboardData.getData('text/plain');
    const hasImage = Array.from(e.clipboardData.items).some((i) => i.kind === 'file');
    if (hasImage && !text) return; // картинку обработает общий обработчик — создаст карточку
    e.preventDefault();
    e.stopPropagation();
    if (Table.paste(text, e.target)) return; // несколько ячеек из Excel — разложить по таблице
    document.execCommand('insertText', false, text);
  },

  async onPaste(e) {
    if (App.editingId || e.target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
      if (!App.editingId) return;
      const hasFile = Array.from(e.clipboardData.items).some((i) => i.kind === 'file');
      if (!hasFile) return;
    }
    e.preventDefault();
    const pos = this.pointerPos();
    const cd = e.clipboardData;
    const text = cd.getData('text/plain');
    if (App.clip && text && text === App.clip.text) { Actions.pasteClip(pos); return; }

    const files = Array.from(cd.files || []);
    if (files.length) {
      const assets = [];
      for (const f of files) {
        const p = window.api.pathForFile(f);
        if (p) assets.push(...(await window.api.importPaths([p])));
        else {
          const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
          assets.push(await window.api.saveBuffer(f.name && f.name !== 'image.png' ? f.name : 'pasted.' + ext, await f.arrayBuffer()));
        }
      }
      if (App.editingId) Edit.stop();
      Actions.addAssets(pos, assets);
      return;
    }
    if (!text.trim()) return;
    if (isUrl(text)) { Actions.link(pos, text.trim()); return; }
    const tsv = Table.parseTsv(text);
    if (tsv && tsv.length > 1) { Actions.table(pos, tsv); return; } // ячейки из Excel → таблица
    const html = escapeHtml(text.trim()).replace(/\r?\n/g, '<br>');
    Actions.note(pos, html);
  },

  async onDrop(e) {
    e.preventDefault();
    $('#viewport').classList.remove('drop');
    const p = App.screenToWorld(e.clientX, e.clientY);
    const pos = { x: Math.round(p.x - 20), y: Math.round(p.y - 20) };
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) {
      const paths = files.map((f) => window.api.pathForFile(f)).filter(Boolean);
      let assets = await window.api.importPaths(paths);
      if (!assets.length) {
        for (const f of files) assets.push(await window.api.saveBuffer(f.name, await f.arrayBuffer()));
      }
      Actions.addAssets(pos, assets);
      return;
    }
    const uri = (e.dataTransfer.getData('text/uri-list') || '').split('\n').find((l) => l && !l.startsWith('#'));
    const text = e.dataTransfer.getData('text/plain');
    if (uri && /^https?:/i.test(uri)) Actions.link(pos, uri.trim());
    else if (text && isUrl(text)) Actions.link(pos, text.trim());
    else if (text) Actions.note(pos, escapeHtml(text).replace(/\r?\n/g, '<br>'));
  },

  // ---------- панель инструментов ----------
  initToolbar() {
    const create = (tool, pos) => {
      const p = pos || App.centerPos(CARD_DEFAULT_W[tool] || 200);
      ({
        note: () => Actions.note(p),
        link: () => Actions.link(p),
        todo: () => Actions.todo(p),
        line: () => Actions.line(p),
        board: () => Actions.board(p),
        sketch: () => Actions.sketch(p),
        table: () => Actions.table(p),
        column: () => Actions.column(p),
        image: () => Actions.pick('image', p),
        file: () => Actions.pick('file', p),
      })[tool]?.();
    };
    for (const btn of $$('.tool[data-tool]')) {
      btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        Edit.stop();
        const tool = btn.dataset.tool;
        let ghost = null;
        const move = (ev) => {
          if (!ghost && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 6) {
            ghost = el('div', { class: 'tool-ghost ghost-' + tool, text: btn.querySelector('span').textContent });
            document.body.append(ghost);
          }
          if (ghost) { ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px'; }
        };
        const up = (ev) => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          if (ghost) {
            ghost.remove();
            const vp = $('#viewport').getBoundingClientRect();
            if (ev.clientX > vp.left && ev.clientY > vp.top) {
              const p = App.screenToWorld(ev.clientX, ev.clientY);
              create(tool, { x: Math.round(p.x - 20), y: Math.round(p.y - 16) });
            }
          } else {
            create(tool);
          }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    }
    $('#btn-data').addEventListener('click', () => window.api.openDataDir());
  },

  initHeader() {
    const title = $('#board-title');
    title.addEventListener('click', () => {
      title.contentEditable = 'plaintext-only';
      title.focus();
      const s = window.getSelection(); s.selectAllChildren(title);
    });
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); title.blur(); }
      e.stopPropagation();
    });
    title.addEventListener('blur', () => {
      title.contentEditable = 'false';
      const v = title.textContent.trim();
      if (v && v !== App.board.title) {
        App.board.title = v;
        Store.markDirty(App.boardId);
        // обновить карточку этой доски у родителя не нужно сейчас — она перерисуется при открытии
      }
      App.header();
    });
    $('#btn-search').addEventListener('click', openSearch);
    $('#btn-zoom').addEventListener('click', () => { App.view.z = 1; App.applyView(); });
  },

  // ---------- контекстное меню ----------
  onContext(e) {
    e.preventDefault();
    if (this.suppressCtx) { this.suppressCtx = false; return; }
    if (App.editingId && e.target.closest('.card.editing')) {
      this.hideMenu();
      if (Format.cardId) Format.openMenu({ x: e.clientX, y: e.clientY });
      const cell = e.target.closest('.tbl-cell');
      const card = App.cardById(App.editingId);
      if (cell && card?.type === 'table') {
        const { r, c } = Table.cellPos(cell);
        this.showMenu(e.clientX, e.clientY, [...Table.rowItems(card, r), '-', ...Table.colItems(card, c), '-', Table.headerItem(card)], true);
      }
      return;
    }
    const cardEl = e.target.closest('.card');
    const lineEl = e.target.closest('[data-line]');
    if (cardEl) {
      const id = cardEl.dataset.id;
      if (!App.selected.has(id)) App.select([id]);
      this.showCardMenu(e.clientX, e.clientY);
    } else if (lineEl) {
      const id = lineEl.dataset.line;
      if (!App.selectedLines.has(id)) { App.selected.clear(); App.selectedLines = new Set([id]); Render.selection(); Render.lines(); }
      this.showLineMenu(e.clientX, e.clientY);
    } else {
      const p = App.screenToWorld(e.clientX, e.clientY);
      const pos = { x: Math.round(p.x - 20), y: Math.round(p.y - 20) };
      this.showMenu(e.clientX, e.clientY, [
        { label: 'Заметка', key: 'N', run: () => Actions.note(pos) },
        { label: 'Ссылка', key: 'L', run: () => Actions.link(pos) },
        { label: 'To-do', key: 'T', run: () => Actions.todo(pos) },
        { label: 'Доска', key: 'B', run: () => Actions.board(pos) },
        { label: 'Стрелка', key: 'A', run: () => Actions.line(pos) },
        { label: 'Скетч', key: 'D', run: () => Actions.sketch(pos) },
        { label: 'Таблица', key: 'G', run: () => Actions.table(pos) },
        { label: 'Колонка', key: 'C', run: () => Actions.column(pos) },
        { label: 'Картинка…', run: () => Actions.pick('image', pos) },
        { label: 'Файл…', run: () => Actions.pick('file', pos) },
        App.clip ? '-' : null,
        App.clip ? { label: 'Вставить карточки', key: 'Ctrl+V', run: () => Actions.pasteClip(pos) } : null,
        App.board.parentId ? '-' : null,
        App.board.parentId ? { label: 'Наверх, к родительской доске', key: 'Alt+←', run: () => App.goUp() } : null,
      ]);
    }
  },

  showCardMenu(x, y) {
    const cards = App.board.cards.filter((c) => App.selected.has(c.id));
    const one = cards.length === 1 ? cards[0] : null;
    const items = [];
    if (cards.some((c) => c.type === 'note' || c.type === 'column')) {
      const cur = one?.type === 'note' || one?.type === 'column' ? one : null;
      items.push({
        custom: () => el('div', { class: 'menu-colors' },
          Object.entries(NOTE_COLORS).map(([k, v]) => el('button', {
            class: 'swatch sm' + (cur?.color === k ? ' on' : ''), title: k, style: { background: v.bg },
            onclick: () => { Actions.setNoteColor(k); this.hideMenu(); },
          }))),
      });
      items.push({ label: cur?.style === 'stripe' ? 'Стиль: залить цветом' : 'Стиль: цветная полоска сверху', run: () => Actions.setNoteColor(null, cur?.style === 'stripe' ? 'fill' : 'stripe') });
      items.push('-');
    }
    if (one?.type === 'table') {
      const { rows, cols } = Table.size(one);
      items.push({ label: 'Редактировать', key: 'Enter', run: () => Edit.start(one.id) });
      items.push({ label: 'Добавить строку', run: () => Table.change(one, (k) => Table.insertRow(k, rows)) });
      items.push({ label: 'Добавить столбец', run: () => Table.change(one, (k) => Table.insertCol(k, cols)) });
      items.push(Table.headerItem(one));
    }
    if (one?.type === 'note' || one?.type === 'todo') items.push({ label: 'Редактировать', key: 'Enter', run: () => Edit.start(one.id) });
    if (one?.type === 'column') items.push({ label: 'Изменить заголовок', key: 'Enter', run: () => Edit.start(one.id) });
    if (cards.some((c) => c.col)) items.push({ label: 'Вынуть из колонки', run: () => Actions.takeOutOfColumn(new Set(cards.filter((c) => c.col).map((c) => c.id))) });
    if (one?.type === 'board') {
      items.push({ label: 'Открыть', key: 'Enter', run: () => App.open(one.boardId) });
      items.push({ label: 'Название, цвет, значок…', run: () => Actions.editBoard(one.boardId) });
    }
    if (one?.type === 'link') {
      items.push({ label: 'Открыть в браузере', run: () => window.api.openExternal(one.url) });
      items.push({ label: 'Изменить адрес…', run: async () => {
        const url = await promptText('Адрес ссылки', one.url);
        if (url) { Store.snapshot(); one.url = normalizeUrl(url); Actions.loadPreview(one); }
      } });
      items.push({ label: 'Обновить превью', run: () => Actions.loadPreview(one) });
      items.push({ label: one.image ? 'Скрыть картинку' : 'Картинка скрыта', disabled: !one.image, run: () => { Store.snapshot(); one.image = ''; Store.markDirty(App.boardId); Render.card(one); } });
    }
    if (one?.type === 'image' || one?.type === 'file') {
      items.push({ label: 'Открыть', run: () => window.api.openAsset(one.file) });
      items.push({ label: 'Показать в папке', run: () => window.api.showAsset(one.file) });
      if (one.type === 'image') items.push({ label: one.caption ? 'Изменить подпись…' : 'Добавить подпись…', run: async () => {
        const v = await promptText('Подпись к картинке', one.caption || '');
        if (v != null) { Store.snapshot(); one.caption = v; Store.markDirty(App.boardId); Render.card(one); }
      } });
    }
    if (one?.type === 'sketch') {
      items.push({ label: 'Рисовать', key: 'Enter', run: () => Sketch.open(one) });
      items.push({ label: 'Очистить рисунок', disabled: !one.strokes?.length, run: () => { Store.snapshot(); one.strokes = []; Store.markDirty(App.boardId); Render.card(one); } });
    }
    if (one?.type === 'todo') {
      items.push({ label: 'Убрать выполненные', run: () => { Store.snapshot(); one.items = one.items.filter((i) => !i.done); Store.markDirty(App.boardId); Render.card(one); } });
    }
    if (items.length && items[items.length - 1] !== '-') items.push('-');
    items.push(
      { label: 'Копировать', key: 'Ctrl+C', run: () => Actions.copy() },
      { label: 'Дублировать', key: 'Ctrl+D', run: () => Actions.duplicate() },
      cards.every((c) => c.col) ? null : { label: 'На передний план', run: () => Actions.order(true) },
      cards.every((c) => c.col) ? null : { label: 'На задний план', run: () => Actions.order(false) },
      '-',
      { label: cards.length > 1 ? `Удалить (${cards.length})` : 'Удалить', key: 'Del', danger: true, run: () => Actions.deleteSelection() },
    );
    this.showMenu(x, y, items);
  },

  showLineMenu(x, y) {
    const lines = App.board.lines.filter((l) => App.selectedLines.has(l.id));
    const upd = (fn) => { Store.snapshot(); lines.forEach(fn); Store.markDirty(App.boardId); Render.lines(); };
    const l0 = lines[0];
    this.showMenu(x, y, [
      { label: (l0.arrow !== false ? '✓ ' : '') + 'Стрелка на конце', run: () => upd((l) => (l.arrow = l0.arrow === false)) },
      { label: (l0.arrowStart ? '✓ ' : '') + 'Стрелка в начале', run: () => upd((l) => (l.arrowStart = !l0.arrowStart)) },
      { label: (l0.dashed ? '✓ ' : '') + 'Пунктир', run: () => upd((l) => (l.dashed = !l0.dashed)) },
      { label: 'Развернуть', run: () => upd((l) => { const f = l.from; l.from = l.to; l.to = f; }) },
      '-',
      { label: 'Удалить', key: 'Del', danger: true, run: () => Actions.deleteSelection() },
    ]);
  },

  showMenu(x, y, items, keepFocus = false) {
    const m = $('#ctx-menu');
    m.innerHTML = '';
    for (const it of items) {
      if (!it) continue;
      if (it === '-') { m.append(el('div', { class: 'menu-sep' })); continue; }
      if (it.custom) { m.append(it.custom()); continue; }
      const b = el('button', { class: 'menu-item' + (it.danger ? ' danger' : ''), disabled: it.disabled },
        el('span', { text: it.label }), it.key ? el('kbd', { text: it.key }) : null);
      if (keepFocus) b.addEventListener('mousedown', (ev) => ev.preventDefault());
      b.addEventListener('click', () => { this.hideMenu(); it.run(); });
      m.append(b);
    }
    m.hidden = false;
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
    m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  },

  hideMenu() { $('#ctx-menu').hidden = true; },
};
