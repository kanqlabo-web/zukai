// Googleドキュメント・スライドのような、上のメニューバー（ファイル・編集・表示…）と右クリックのメニュー
import { h } from './vdom.js';

// menus: [{ label, items: [{ label, kbd, onclick, disabled, checked, hint } | '-'] }]
// 開いているメニューは1つだけ。メニューが開いている間は、ほかの見出しにマウスを乗せるだけで切り替わる。
let open = null; // { bar, idx, hi }（hi：キーボードで選んでいる行）
const bars = {}; // 最後に描いたメニュー（Alt+文字・矢印キーで使う）
let redrawFn = () => {};
const close = () => { if (open || ctx) { open = null; ctx = null; redrawFn(); } };

export function MenuBar(id, menus, redraw) {
  redrawFn = redraw;
  bars[id] = { menus, redraw };
  const isOpen = (i) => open && open.bar === id && open.idx === i;
  return h('nav', { class: 'menubar', role: 'menubar' }, menus.map((m, i) => h('div', { key: m.label, class: 'mb-item' + (isOpen(i) ? ' open' : '') },
    h('button', {
      class: 'mb-btn', role: 'menuitem', 'aria-haspopup': 'true', 'aria-expanded': isOpen(i) ? 'true' : 'false',
      onmousedown: (e) => e.preventDefault(),
      onpointerdown: (e) => { e.preventDefault(); open = isOpen(i) ? null : { bar: id, idx: i }; ctx = null; redraw(); },
      onpointerenter: () => { if (open && open.bar === id && open.idx !== i) { open = { bar: id, idx: i }; redraw(); } },
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); open = { bar: id, idx: i }; redraw(); } },
    }, m.label),
    isOpen(i) ? MenuList(m.items, 'mb-menu', null, open.hi) : null)));
}

function MenuList(items, cls, style, hi) {
  return h('div', { class: 'menu-pop ' + cls, role: 'menu', style, onpointerdown: (e) => e.stopPropagation(), onmousedown: (e) => e.preventDefault() },
    items.filter(Boolean).map((it, k) => it === '-'
      ? h('div', { key: 's' + k, class: 'mp-sep', role: 'separator' })
      : h('button', {
        key: it.label, class: 'mp-row' + (hi && hi === it.label ? ' hi' : ''), role: 'menuitem', disabled: !!it.disabled, title: it.hint || null,
        onclick: () => { open = null; ctx = null; redrawFn(); if (!it.disabled && it.onclick) it.onclick(); },
      },
        h('span', { class: 'mp-check' }, it.checked ? h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': 'true' }, h('path', { d: 'M5 12l5 5 9-10', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) : null),
        h('span', { class: 'mp-label' }, it.label),
        it.kbd ? h('span', { class: 'mp-kbd' }, it.kbd) : null)));
}

// 右クリックのメニュー（x, y は画面の位置）
let ctx = null; // { x, y, items }
export function openContextMenu(x, y, items, redraw) {
  redrawFn = redraw;
  open = null;
  ctx = { x, y, items };
  redraw();
}
export function ContextMenu() {
  if (!ctx) return null;
  // 画面の端からはみ出さないように
  const x = Math.min(ctx.x, window.innerWidth - 260), y = Math.min(ctx.y, window.innerHeight - 40 - ctx.items.length * 30);
  return MenuList(ctx.items, 'ctx-menu', { left: Math.max(4, x) + 'px', top: Math.max(4, y) + 'px' }, ctx.hi);
}
export const menuOpen = () => !!(open || ctx);
export const closeMenus = close;

// ほかの所を押した・Esc で閉じる
document.addEventListener('pointerdown', (e) => {
  if ((open || ctx) && !(e.target.closest && e.target.closest('.menu-pop, .mb-btn'))) close();
}, true);
// キーボード：Alt+文字でメニューを開く（Googleドキュメントと同じ文字）。開いている間は ↑↓ で行、←→ でとなりのメニュー、Enter で決定
const ALT_KEYS = { f: 'ファイル', e: '編集', v: '表示', i: '挿入', o: ['表示形式', '配置'], h: 'ヘルプ' };
const activeBar = () => (document.querySelector('.ed-root') ? 'editor' : document.querySelector('.draft-head .menubar') ? 'doc' : null);
function rows() { return (ctx ? ctx.items : bars[open.bar].menus[open.idx].items).filter((it) => it && it !== '-' && !it.disabled); }
function moveHi(dir) {
  const list = rows();
  const holder = ctx || open;
  if (list.length) {
    const i = list.findIndex((it) => it.label === holder.hi);
    holder.hi = list[i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length].label;
  }
  redrawFn();
}
document.addEventListener('keydown', (e) => {
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    const want = ALT_KEYS[(e.code || '').replace(/^Key/, '').toLowerCase()];
    const id = activeBar();
    const bar = id && bars[id];
    if (want && bar) {
      const idx = bar.menus.findIndex((m) => (Array.isArray(want) ? want : [want]).includes(m.label));
      if (idx >= 0) { e.preventDefault(); e.stopPropagation(); open = { bar: id, idx, hi: null }; ctx = null; redrawFn = bar.redraw; moveHi(1); return; }
    }
  }
  if (!open && !ctx) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); moveHi(e.key === 'ArrowDown' ? 1 : -1); return; }
  if (open && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    e.preventDefault(); e.stopPropagation();
    const n = bars[open.bar].menus.length;
    open = { bar: open.bar, idx: (open.idx + (e.key === 'ArrowRight' ? 1 : -1) + n) % n, hi: null };
    moveHi(1);
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') {
    const hi = ctx ? ctx.hi : open.hi;
    const cur = hi && rows().find((it) => it.label === hi);
    if (cur) { e.preventDefault(); e.stopPropagation(); close(); if (cur.onclick) cur.onclick(); }
    return;
  }
  if (e.key === 'Tab') { close(); }
}, true);

// キーボードの表示（Mac は ⌘）
export const MOD = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';
