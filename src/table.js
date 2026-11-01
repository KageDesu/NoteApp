// Таблица: данные, редактирование ячеек, строки и столбцы.
// Карточка: { type: 'table', x, y, w, title, desc, header: true, cells: [['A1', 'B1'], ['A2', 'B2']] }
// Первая строка — строка заголовка (если header !== false).

const Table = {
  make(rows = 4, cols = 3) {
    return Array.from({ length: rows }, () => Array(cols).fill(''));
  },

  colName(i) {
    let s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  },

  size(card) {
    return { rows: card.cells.length, cols: card.cells[0]?.length || 0 };
  },

  // Текст для копирования и поиска: столбцы через Tab, строки через перевод строки (вставляется в Excel)
  toText(card) {
    const rows = (card.cells || []).map((r) => r.map((v) => String(v).replace(/[\t\n]+/g, ' ')).join('\t'));
    return [card.title, ...rows, card.desc].filter((s) => s && s.trim()).join('\n');
  },

  searchText(card) {
    return [card.title, ...(card.cells || []).flat(), card.desc].filter(Boolean).join(' ');
  },

  // Текст из Excel / Google Таблиц: несколько строк с одинаковым числом табуляций
  parseTsv(text) {
    const lines = String(text).replace(/\r/g, '').replace(/\n+$/, '').split('\n');
    if (!lines.length || !lines[0].includes('\t')) return null;
    const rows = lines.map((l) => l.split('\t'));
    const cols = Math.max(...rows.map((r) => r.length));
    if (cols > 50 || rows.length > 500) return null;
    return rows.map((r) => [...r, ...Array(cols - r.length).fill('')]);
  },

  // ---------- изменение структуры ----------
  insertRow(card, at) {
    card.cells.splice(at, 0, Array(this.size(card).cols).fill(''));
  },
  deleteRow(card, r) {
    if (card.cells.length > 1) card.cells.splice(r, 1);
  },
  insertCol(card, at) {
    for (const row of card.cells) row.splice(at, 0, '');
    const cols = this.size(card).cols;
    card.w = Math.min(1400, Math.max(card.w || CARD_DEFAULT_W.table, cols * 110));
  },
  deleteCol(card, c) {
    if (this.size(card).cols > 1) for (const row of card.cells) row.splice(c, 1);
  },

  // Применить изменение к таблице: во время редактирования — сохраняя режим редактирования,
  // иначе — отдельным шагом отмены.
  change(card, fn, focus) {
    const editing = App.editingId === card.id;
    const active = document.activeElement?.closest?.('.tbl-cell');
    if (editing) Edit.read(); else Store.snapshot();
    fn(card);
    Store.markDirty(App.boardId);
    Render.card(card);
    if (editing) {
      const e = Render.els.get(card.id);
      this.enable(e);
      focus ||= active ? this.cellPos(active) : null;
      const target = focus && this.cellEl(card, Math.min(focus.r, card.cells.length - 1), Math.min(focus.c, this.size(card).cols - 1));
      this.focusEl(target || $('.tbl-title', e));
    }
  },

  // ---------- редактирование ----------
  enable(e) {
    for (const t of $$('.tbl-title, .tbl-cell, .tbl-desc', e)) t.contentEditable = 'plaintext-only';
  },

  // Элемент, с которого начать редактирование
  startTarget(card, e, { isNew, point, focusCell }) {
    if (focusCell) return this.cellEl(card, focusCell.r, focusCell.c);
    const under = point && document.elementFromPoint(point.x, point.y)?.closest('.tbl-cell, .tbl-title, .tbl-desc');
    if (under && e.contains(under)) return under;
    if (isNew) return $('.tbl-cell', e);
    return $('.tbl-title', e);
  },

  read(card, e) {
    card.title = $('.tbl-title', e).textContent.trim();
    card.desc = $('.tbl-desc', e).innerText.trim();
    for (const cell of $$('.tbl-cell', e)) {
      const r = +cell.closest('.tbl-row').dataset.row, c = +cell.dataset.col;
      if (card.cells[r]) card.cells[r][c] = cell.innerText.replace(/\n$/, '');
    }
  },

  cellEl(card, r, c) {
    const e = Render.els.get(card.id);
    return e && $(`.tbl-row[data-row="${r}"] .tbl-cell[data-col="${c}"]`, e);
  },

  cellPos(cell) {
    return { r: +cell.closest('.tbl-row').dataset.row, c: +cell.dataset.col };
  },

  focusEl(t, selectAll = false) {
    if (!t) return;
    t.focus();
    const s = window.getSelection();
    s.selectAllChildren(t);
    if (!selectAll) s.collapseToEnd();
  },

  focusCell(card, r, c, selectAll) {
    this.focusEl(this.cellEl(card, r, c), selectAll);
  },

  // Клавиши внутри редактируемой таблицы
  key(ev) {
    const card = App.cardById(App.editingId);
    if (!card || card.type !== 'table' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const e = Render.els.get(card.id);
    const t = ev.target;
    const cell = t.closest('.tbl-cell');
    const { rows, cols } = this.size(card);

    if (ev.key === 'Tab') {
      ev.preventDefault();
      if (!cell) {
        if (t.classList.contains('tbl-title') && !ev.shiftKey) this.focusCell(card, 0, 0, true);
        else if (t.classList.contains('tbl-desc') && ev.shiftKey) this.focusCell(card, rows - 1, cols - 1, true);
        return;
      }
      let { r, c } = this.cellPos(cell);
      if (ev.shiftKey) {
        if (--c < 0) { c = cols - 1; r--; }
        if (r < 0) { this.focusEl($('.tbl-title', e)); return; }
      } else if (++c >= cols) {
        c = 0; r++;
        if (r >= rows) { this.change(card, (k) => this.insertRow(k, rows), { r, c }); return; }
      }
      this.focusCell(card, r, c, true);
      return;
    }

    if (ev.key === 'Enter' && !ev.shiftKey) {
      if (t.classList.contains('tbl-title')) { ev.preventDefault(); this.focusCell(card, 0, 0); return; }
      if (!cell) return; // в описании Enter — новая строка
      ev.preventDefault();
      const { r, c } = this.cellPos(cell);
      if (r + 1 >= rows) this.change(card, (k) => this.insertRow(k, rows), { r: r + 1, c });
      else this.focusCell(card, r + 1, c);
      return;
    }

    if ((ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && !ev.shiftKey) {
      const down = ev.key === 'ArrowDown';
      let next = null;
      if (cell) {
        if (cell.innerText.replace(/\n$/, '').includes('\n')) return; // многострочная ячейка — обычное движение курсора
        const { r, c } = this.cellPos(cell);
        next = down ? (r + 1 < rows ? this.cellEl(card, r + 1, c) : $('.tbl-desc', e)) : (r > 0 ? this.cellEl(card, r - 1, c) : $('.tbl-title', e));
      } else if (t.classList.contains('tbl-title') && down) next = this.cellEl(card, 0, 0);
      else if (t.classList.contains('tbl-desc') && !down && !t.innerText.trim().includes('\n')) next = this.cellEl(card, rows - 1, 0);
      if (next) { ev.preventDefault(); this.focusEl(next); }
    }
  },

  // Вставка нескольких ячеек (из Excel) в ячейку таблицы. true — вставка обработана.
  paste(text, target) {
    const card = App.cardById(App.editingId);
    const cell = target.closest?.('.tbl-cell');
    if (!card || card.type !== 'table' || !cell) return false;
    const data = this.parseTsv(text);
    if (!data) return false;
    const { r, c } = this.cellPos(cell);
    this.change(card, (k) => {
      while (k.cells.length < r + data.length) this.insertRow(k, k.cells.length);
      const need = c + data[0].length;
      while (this.size(k).cols < need) this.insertCol(k, this.size(k).cols);
      data.forEach((row, i) => row.forEach((v, j) => { k.cells[r + i][c + j] = v; }));
    }, { r: r + data.length - 1, c: c + data[0].length - 1 });
    return true;
  },

  // ---------- меню ----------
  rowItems(card, r) {
    const { rows } = this.size(card);
    return [
      { label: 'Вставить строку выше', run: () => this.change(card, (k) => this.insertRow(k, r), { r, c: 0 }) },
      { label: 'Вставить строку ниже', run: () => this.change(card, (k) => this.insertRow(k, r + 1), { r: r + 1, c: 0 }) },
      { label: 'Удалить строку', danger: true, disabled: rows <= 1, run: () => this.change(card, (k) => this.deleteRow(k, r), { r: Math.min(r, rows - 2), c: 0 }) },
    ];
  },

  colItems(card, c) {
    const { cols } = this.size(card);
    return [
      { label: 'Вставить столбец слева', run: () => this.change(card, (k) => this.insertCol(k, c), { r: 0, c }) },
      { label: 'Вставить столбец справа', run: () => this.change(card, (k) => this.insertCol(k, c + 1), { r: 0, c: c + 1 }) },
      { label: 'Удалить столбец', danger: true, disabled: cols <= 1, run: () => this.change(card, (k) => this.deleteCol(k, c), { r: 0, c: Math.min(c, cols - 2) }) },
    ];
  },

  headerItem(card) {
    return { label: (card.header !== false ? '✓ ' : '') + 'Строка заголовка', run: () => this.change(card, (k) => { k.header = k.header === false; }) };
  },
};
