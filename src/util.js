// Общие помощники интерфейса
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') {
      // CSS-переменные (--name) через Object.assign не задаются — только через setProperty
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) e.style.setProperty(prop, val);
        else e.style[prop] = val;
      }
    }
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}

function svgEl(tag, attrs = {}) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  return e;
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Русские окончания: plural(5, 'доска', 'доски', 'досок')
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' КБ';
  return (bytes / 1024 / 1024).toFixed(1) + ' МБ';
}

const assetUrl = (file) => 'nasset://a/' + encodeURIComponent(file);

function isUrl(text) {
  return /^(https?:\/\/|www\.)[^\s]+$/i.test(String(text).trim());
}
function normalizeUrl(text) {
  const t = String(text).trim();
  return /^www\./i.test(t) ? 'https://' + t : t;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i;

// Безопасный HTML для заметок: оставляем только простое форматирование.
const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'BR', 'DIV', 'P', 'SPAN', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'A', 'BLOCKQUOTE', 'CODE', 'PRE']);
const ALLOWED_CLASSES = new Set(['t-small', 't-callout']);
function sanitizeHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html || '';
  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 1) {
        if (!ALLOWED_TAGS.has(child.tagName)) {
          if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(child.tagName)) { child.remove(); continue; }
          walk(child);
          child.replaceWith(...child.childNodes);
          continue;
        }
        for (const a of Array.from(child.attributes)) {
          if (child.tagName === 'A' && a.name === 'href' && /^https?:/i.test(a.value)) continue;
          if (a.name === 'class') {
            const ok = a.value.split(/\s+/).filter((c) => ALLOWED_CLASSES.has(c));
            if (ok.length) { child.setAttribute('class', ok.join(' ')); continue; }
          }
          if (a.name === 'style' && child.tagName === 'SPAN') {
            // из стилей оставляем только цвет текста и цвет выделения
            const c = child.style.color, bg = child.style.backgroundColor;
            child.removeAttribute('style');
            if (c) child.style.color = c;
            if (bg && bg !== 'transparent') child.style.backgroundColor = bg;
            if (child.getAttribute('style')) continue;
          }
          child.removeAttribute(a.name);
        }
        walk(child);
      } else if (child.nodeType !== 3) {
        child.remove();
      }
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

function htmlToText(html) {
  const d = document.createElement('div');
  d.innerHTML = (html || '').replace(/<(br|\/div|\/p|\/li|\/h\d|\/pre|\/blockquote)>/gi, '\n$&');
  return d.textContent.replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- Всплывающее сообщение ----------
let toastTimer;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// ---------- Модальные окна (window.prompt в Electron не работает) ----------
function modal({ title, body, okText = 'OK', cancelText = 'Отмена', danger = false, onOk, wide = false, extra = null }) {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    const close = (val) => { root.innerHTML = ''; resolve(val); };
    const ok = el('button', { class: 'btn primary' + (danger ? ' danger' : ''), text: okText });
    const cancel = cancelText ? el('button', { class: 'btn', text: cancelText }) : null;
    const box = el('div', { class: 'modal' + (wide ? ' wide' : '') },
      title ? el('h3', { text: title }) : null,
      body,
      el('div', { class: 'modal-actions' }, extra ? el('div', { class: 'modal-extra' }, extra) : null, cancel, ok));
    const back = el('div', { class: 'modal-back' }, box);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(null); });
    ok.addEventListener('click', () => close(onOk ? onOk() : true));
    if (cancel) cancel.addEventListener('click', () => close(null));
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && !e.target.closest('.modal-extra')) { e.preventDefault(); ok.click(); }
    });
    root.append(back);
    const first = box.querySelector('input,textarea') || ok;
    setTimeout(() => { first.focus(); first.select && first.select(); }, 0);
  });
}

function promptText(title, value = '', placeholder = '') {
  const input = el('input', { class: 'input', value, placeholder });
  return modal({ title, body: input, onOk: () => input.value.trim() });
}

function confirmBox(title, text, okText = 'Удалить') {
  return modal({ title, body: el('p', { class: 'modal-text', text }), okText, danger: true });
}
