// 画面で使う小さなアイコン（絵文字は使わず SVG で描く）
import { h } from './vdom.js';

const P = {
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  more: null, // 点3つ（下で円を描く）
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  chevron: 'M9 6l6 6-6 6',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  plus: 'M12 5v14M5 12h14',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01',
};

export function icon(name, size = 18, cls = '') {
  const attrs = { class: 'ico' + (cls ? ' ' + cls : ''), viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  if (name === 'grip') {
    return h('svg', { ...attrs, stroke: 'none', fill: 'currentColor' },
      [[9, 6], [15, 6], [9, 12], [15, 12], [9, 18], [15, 18]].map(([x, y]) => h('circle', { cx: x, cy: y, r: 1.7 })));
  }
  if (name === 'more') {
    return h('svg', { ...attrs, stroke: 'none', fill: 'currentColor' },
      h('circle', { cx: 5, cy: 12, r: 1.8 }), h('circle', { cx: 12, cy: 12, r: 1.8 }), h('circle', { cx: 19, cy: 12, r: 1.8 }));
  }
  return h('svg', attrs, h('path', { d: P[name] }));
}
