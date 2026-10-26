// プルダウン（OS の select を使わず、アプリのメニューと同じ見た目で開く）
// 使い方は h('select', props, option…) と同じ：Select({ value, onchange, class, title, 'aria-label', disabled }, h('option', …), h('optgroup', …))
// onchange には { target: { value } } を渡す。display を渡すと、ボタンの中身をそれにする（caret: false で ▼ を出さない）
import { h } from './vdom.js';
import { rerender } from './state.js';
import { openContextMenu } from './menubar.js';

const textOf = (v) => (v.tag === '#text' ? v.text : (v.children || []).map(textOf).join(''));

function optionsOf(kids, group, out = []) {
  for (const v of kids) {
    if (v.tag === 'option') out.push({ v: v.props.value == null ? textOf(v) : String(v.props.value), label: textOf(v), disabled: !!v.props.disabled, selected: !!v.props.selected, group });
    else if (v.tag === 'optgroup') { out.push({ head: v.props.label || '' }); optionsOf(v.children, v.props.label, out); }
  }
  return out;
}

export function Select(props, ...kids) {
  props = props || {};
  const opts = optionsOf(h('x', null, ...kids).children);
  const list = opts.filter((o) => !o.head);
  const picked = props.value != null ? list.find((o) => o.v === String(props.value)) : list.find((o) => o.selected);
  const cur = picked || list[0] || null;
  const choose = (v) => { if (props.onchange) props.onchange({ target: { value: v }, currentTarget: { value: v } }); };
  const openList = (el) => {
    const r = el.getBoundingClientRect();
    const items = opts.map((o) => (o.head != null ? { head: o.head } : { label: o.label, checked: cur && o.v === cur.v, disabled: o.disabled, onclick: () => choose(o.v) }));
    openContextMenu(r.left, r.bottom + 4, items, props.redraw || rerender, { hi: cur ? cur.label : null, minWidth: Math.round(r.width) });
  };
  return h('button', {
    key: props.key, type: 'button', class: (props.plain ? '' : 'sel-btn ') + (props.class || ''), title: props.title || null,
    'aria-label': props['aria-label'] || null, 'aria-haspopup': 'listbox', disabled: !!props.disabled,
    onmousedown: (e) => e.preventDefault(),
    onclick: (e) => openList(e.currentTarget),
    onkeydown: (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openList(e.currentTarget); } },
  },
  props.display != null ? props.display : h('span', { class: 'sel-label' }, cur ? cur.label : ''),
  props.caret === false ? null : h('svg', { class: 'sel-caret', viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': 'true' }, h('path', { d: 'M7 10l5 5 5-5', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })));
}
