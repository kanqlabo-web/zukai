// 図解シートの部品（編集画面とPDFで共通）
import { h } from './vdom.js';
import { lineSegments } from './script.js';
import { attrsOf, runsOf, markStyle, linkify } from './richtext.js';
import { numberCast, roleText } from './cast.js';

export function CastTable(cast) {
  const list = numberCast(cast);
  const rows = [];
  for (let i = 0; i < list.length; i += 4) rows.push(list.slice(i, i + 4));
  if (!rows.length) return h('p', { class: 'muted small' }, 'メンバー一覧が未入力です。');
  return h('table', { class: 'cast-table' }, h('tbody', null, rows.map((r, i) => h('tr', { key: 'r' + i },
    [0, 1, 2, 3].map((k) => {
      const c = r[k];
      return h('td', { key: 'c' + k },
        c ? [h('span', { class: 'cno' }, c.no), h('span', { class: 'cname' }, c.name, roleText(c) ? `（${roleText(c)}）` : '')] : null);
    })))));
}

export function Legend() {
  return h('div', { class: 'legend' },
    h('span', null, '《》タイミング'), h('span', null, h('i', { class: 'dot' }), '動き'), h('span', null, '☆意味'), h('span', null, '＊ポイント'));
}

// 「●」を丸い印に置き換えて表示
// isNew(行)：更新した行なら true（青字にする）／ marks：手で付けた色・塗り
export function DotText(text, isNew, marks) {
  const src = String(text || '');
  const body = src.replace(/\s+$/, '');
  const lines = body.split('\n');
  const at = attrsOf(src, marks);
  let pos = 0;
  return lines.map((ln, i) => {
    const st = pos; pos += ln.length + 1;
    const upd = isNew && isNew(ln) ? ' upd' : '';
    if (!ln.trim()) return h('div', { key: 'l' + i, class: 'nline blank' + upd }, ' ');
    const m = ln.match(/^(\s*)●\s?/);
    const from = m ? st + m[0].length : st;
    const runs = runsOf(from, st + ln.length, at).map((r) => (r.c || r.bg || r.b
      ? h('span', { style: markStyle(r.c, r.bg, r.b) }, linkify(src.slice(r.s, r.e))) : linkify(src.slice(r.s, r.e))));
    return h('div', { key: 'l' + i, class: 'nline' + upd }, m ? [m[1], h('i', { class: 'dot' })] : null, runs);
  });
}

export function CueTitle(cue, upd, end = '') {
  return h('div', { class: 'cue' + (upd ? ' upd' : '') }, '《', h('mark', null, cue), '》', end ? ['～《', h('mark', null, end), '》'] : null);
}

export function ScriptLines(text, lines, highlights, opts = {}) {
  return lines.map((l) => {
    const segs = lineSegments(text, l, highlights, opts.marks);
    const cls = 'sline' + (l.indent ? ' indent' : '') + (l.blank ? ' blank' : '') + (opts.lineSel === l.start ? ' picked' : '');
    return h('div', { key: 'L' + l.start, class: cls, 'data-ls': l.start, onclick: opts.onLine ? (e) => opts.onLine(e, l) : null },
      l.blank || !segs.length ? h('span', { 'data-s': l.start, 'data-blank': '1' }, ' ') : segs.map((s) => h('span', {
        key: 'S' + s.s, 'data-s': s.s, class: (s.label ? 'spk' : '') + (s.hl ? ' hl' : '') || null,
        style: s.c || s.bg || s.b ? markStyle(s.c, s.bg, s.b) : null,
      }, s.text)));
  });
}
