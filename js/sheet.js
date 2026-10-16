// 図解シートの部品（編集画面とPDFで共通）
import { h } from './vdom.js';
import { lineSegments } from './script.js';
import { numberCast } from './cast.js';

export function CastTable(cast) {
  const list = numberCast(cast);
  const rows = [];
  for (let i = 0; i < list.length; i += 4) rows.push(list.slice(i, i + 4));
  if (!rows.length) return h('p', { class: 'muted small' }, 'キャスト一覧が未入力です。');
  return h('table', { class: 'cast-table' }, h('tbody', null, rows.map((r, i) => h('tr', { key: 'r' + i },
    [0, 1, 2, 3].map((k) => {
      const c = r[k];
      return h('td', { key: 'c' + k },
        c ? [h('span', { class: 'cno' }, c.no), h('span', { class: 'cname' }, c.name, c.role ? `（${c.role}）` : '')] : null);
    })))));
}

export function Legend() {
  return h('div', { class: 'legend' },
    h('span', null, '《》タイミング'), h('span', null, h('i', { class: 'dot' }), '動き'), h('span', null, '☆意味'), h('span', null, '＊ポイント'));
}

// 「●」を丸い印に置き換えて表示
export function DotText(text) {
  const lines = String(text || '').replace(/\s+$/, '').split('\n');
  return lines.map((ln, i) => {
    const m = ln.match(/^(\s*)●\s?(.*)$/);
    if (m) return h('div', { key: 'l' + i, class: 'nline' }, m[1], h('i', { class: 'dot' }), m[2]);
    return h('div', { key: 'l' + i, class: 'nline' + (ln.trim() ? '' : ' blank') }, ln || ' ');
  });
}

export function CueTitle(cue) {
  return h('div', { class: 'cue' }, '《', h('mark', null, cue), '》');
}

export function ScriptLines(text, lines, highlights, opts = {}) {
  return lines.map((l) => {
    const segs = lineSegments(text, l, highlights);
    const cls = 'sline' + (l.indent ? ' indent' : '') + (l.blank ? ' blank' : '') + (opts.lineSel === l.start ? ' picked' : '');
    return h('div', { key: 'L' + l.start, class: cls, 'data-ls': l.start, onclick: opts.onLine ? (e) => opts.onLine(e, l) : null },
      l.blank ? h('span', { 'data-s': l.start, 'data-blank': '1' }, ' ') : segs.map((s) => h('span', {
        key: 'S' + s.s, 'data-s': s.s, class: (s.label ? 'spk' : '') + (s.hl ? ' hl' : '') || null,
      }, s.text)));
  });
}
