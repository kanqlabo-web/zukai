// Googleドキュメント・スライドのような、上のメニューバー（ファイル・編集・表示…）と右クリックのメニュー
import { h } from './vdom.js';

// menus: [{ label, items: [{ label, kbd, onclick, disabled, checked, hint } | '-'] }]
// 開いているメニューは1つだけ。メニューが開いている間は、ほかの見出しにマウスを乗せるだけで切り替わる。
let open = null; // { bar, idx }
let redrawFn = () => {};
const close = () => { if (open || ctx) { open = null; ctx = null; redrawFn(); } };

export function MenuBar(id, menus, redraw) {
  redrawFn = redraw;
  const isOpen = (i) => open && open.bar === id && open.idx === i;
  return h('nav', { class: 'menubar', role: 'menubar' }, menus.map((m, i) => h('div', { key: m.label, class: 'mb-item' + (isOpen(i) ? ' open' : '') },
    h('button', {
      class: 'mb-btn', role: 'menuitem', 'aria-haspopup': 'true', 'aria-expanded': isOpen(i) ? 'true' : 'false',
      onmousedown: (e) => e.preventDefault(),
      onpointerdown: (e) => { e.preventDefault(); open = isOpen(i) ? null : { bar: id, idx: i }; ctx = null; redraw(); },
      onpointerenter: () => { if (open && open.bar === id && open.idx !== i) { open = { bar: id, idx: i }; redraw(); } },
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); open = { bar: id, idx: i }; redraw(); } },
    }, m.label),
    isOpen(i) ? MenuList(m.items, 'mb-menu') : null)));
}

function MenuList(items, cls, style) {
  return h('div', { class: 'menu-pop ' + cls, role: 'menu', style, onpointerdown: (e) => e.stopPropagation(), onmousedown: (e) => e.preventDefault() },
    items.filter(Boolean).map((it, k) => it === '-'
      ? h('div', { key: 's' + k, class: 'mp-sep', role: 'separator' })
      : h('button', {
        key: it.label, class: 'mp-row', role: 'menuitem', disabled: !!it.disabled, title: it.hint || null,
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
  return MenuList(ctx.items, 'ctx-menu', { left: Math.max(4, x) + 'px', top: Math.max(4, y) + 'px' });
}
export const menuOpen = () => !!(open || ctx);
export const closeMenus = close;

// ほかの所を押した・Esc で閉じる
document.addEventListener('pointerdown', (e) => {
  if ((open || ctx) && !(e.target.closest && e.target.closest('.menu-pop, .mb-btn'))) close();
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (open || ctx)) { e.stopPropagation(); close(); } }, true);

// キーボードの表示（Mac は ⌘）
export const MOD = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';
