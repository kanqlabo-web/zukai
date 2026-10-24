// 閲覧モード（プレゼンテーションのように、図を大きく見せる）
// 図を1枚ずつ表示し、横（縦長の画面では下）に、そのタイミングの説明とテーマ活動の友を出す。
// ←→キー・図の左右・テーマ活動の友の行をクリックで移動する。
import { h } from './vdom.js';
import { S, rerender, go } from './state.js';
import { draftTitle } from './model.js';
import { workIndex } from './cast.js';
import { buildRows, highlightRanges, sortBlocks } from './script.js';
import { StageSVG } from './stage.js';
import { DotText, CueTitle, ScriptLines } from './sheet.js';
import { openEditorAfter } from './editor.js';
import { canEdit } from './access.js';
import { icon } from './icons.js';

const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0);
const V = { key: '', i: 0, scrolled: -1, side: null };

try { V.side = localStorage.getItem('zukai.showSide') || null; } catch (e) { /* 使えない環境 */ }

// 1枚ずつの並び（図ごと。図のないタイミングは、前の図のまま）
function stepsOf(data) {
  const out = [];
  data.targets.forEach((t, ti) => {
    const text = t.draft.script || '';
    const sorted = sortBlocks(text, t.blocks || []);
    let last = null;
    if (!sorted.length) out.push({ ti, b: null, off: 0, fig: null });
    for (const { b, r } of sorted) {
      const items = Object.entries(b.items || {}).map(([id, it]) => ({ id, ...it })).sort(byOrder);
      // 図だけを1枚ずつ。写真は説明の欄に出す
      const figs = items.filter((it) => it.kind === 'diagram');
      const texts = items.filter((it) => it.kind === 'text');
      const imgs = items.filter((it) => it.kind === 'image');
      if (figs.length) {
        figs.forEach((f, k) => out.push({ ti, b, off: r.offset, fig: f, texts, imgs, part: figs.length > 1 ? [k + 1, figs.length] : null }));
        last = figs[figs.length - 1];
      } else {
        out.push({ ti, b, off: r.offset, fig: last, carried: !!last, texts, imgs });
      }
    }
  });
  return out;
}

let cache = { data: null, steps: [] };
function steps() {
  const data = S.d.print;
  if (cache.data !== data) cache = { data, steps: data ? stepsOf(data) : [] };
  return cache.steps;
}

function goTo(i) {
  const n = steps().length;
  const j = Math.max(0, Math.min(n - 1, i));
  if (j === V.i) return;
  V.i = j;
  V.zoom = null;
  try { history.replaceState(null, '', location.hash.replace(/\?.*$/, '') + '?' + (j + 1)); } catch (e) { /* noop */ }
  rerender();
}
const next = () => goTo(V.i + 1);
const prev = () => goTo(V.i - 1);

function backHref() {
  const d = S.d.print;
  if (!d) return '#/';
  return d.kind === 'd' ? `#/w/${d.w}/d/${d.id}` : `#/w/${d.w}`;
}

// テーマ活動の友の行をクリック：その位置までのいちばん後ろのタイミングへ
function jumpToText(ti, off) {
  const list = steps();
  let best = -1;
  list.forEach((s, i) => { if (s.ti === ti && s.off <= off) best = i; });
  if (best < 0) best = list.findIndex((s) => s.ti === ti);
  if (best >= 0) {
    // 同じタイミングに図が何枚かあるときは、その最初の図へ
    const s = list[best];
    while (best > 0 && list[best - 1].b === s.b && s.b) best--;
    goTo(best);
  }
}

function Figure(data, t, s, idx) {
  if (!s.fig) return h('div', { class: 'show-empty' }, 'このタイミングには図がありません');
  const g = t.diagrams[s.fig.refId];
  return g ? StageSVG(g.shapes, { cls: 'stage show-stage', idx, roleVis: g.roleVis || {} }) : null;
}

export function ShowView() {
  if (S.d.printError) return h('main', { class: 'page' }, h('p', null, S.d.printError), h('a', { href: '#/' }, '戻る'));
  const data = S.d.print;
  if (!data) return h('div', { class: 'loading' }, '閲覧モードを準備しています…');
  if (V.key !== data) {
    V.key = data;
    const m = /\?(\d+)$/.exec(location.hash);
    V.i = m ? Math.max(0, +m[1] - 1) : 0;
    // 図の編集から来たとき（?g=図の id）は、その図から
    const g = /\?g=([^&]+)$/.exec(location.hash);
    if (g) {
      const i = steps().findIndex((s) => s.fig && s.fig.refId === g[1] && !s.carried);
      V.i = Math.max(0, i);
      try { history.replaceState(null, '', location.hash.replace(/\?.*$/, '') + '?' + (V.i + 1)); } catch (e) { /* noop */ }
    }
    V.scrolled = -1;
  }
  const list = steps();
  if (V.i >= list.length) V.i = Math.max(0, list.length - 1);
  const s = list[V.i];
  if (!s) return h('main', { class: 'page' }, h('p', null, '表示できる図がありません。'), h('a', { class: 'btn', href: backHref() }, '← 戻る'));
  const t = data.targets[s.ti];
  const idx = workIndex(data.work);
  const title = draftTitle(data.work, t.ep, t.track, t.draft);
  document.title = title;
  const text = t.draft.script || '';
  const rows = buildRows(text, t.blocks || [], t.draft.spkFix);
  const hls = highlightRanges(text, t.blocks || []);
  const side = V.side || 'auto';

  // いまのタイミングのテマ友の段（次のタイミングの手前まで）
  const nextOff = (() => {
    for (let i = V.i + 1; i < list.length; i++) if (list[i].ti === s.ti && list[i].b !== s.b) return list[i].off;
    return Infinity;
  })();

  return h('main', { class: 'show side-' + side, tabindex: '-1' },
    h('div', { class: 'show-bar' },
      h('a', { class: 'btn', href: backHref() }, '← 戻る'),
      h('div', { class: 'show-title' }, title),
      h('div', { class: 'show-nav' },
        h('button', { class: 'btn', disabled: V.i === 0, onclick: prev, title: '前へ（←）' }, '◀'),
        h('span', { class: 'show-count' }, `${V.i + 1} / ${list.length}`),
        h('button', { class: 'btn', disabled: V.i >= list.length - 1, onclick: next, title: '次へ（→）' }, '▶')),
      h('select', {
        class: 'show-side', title: '説明とテーマ活動の友の位置', value: side,
        onchange: (e) => { V.side = e.target.value === 'auto' ? null : e.target.value; try { localStorage.setItem('zukai.showSide', V.side || ''); } catch (er) { /* noop */ } V.scrolled = -1; rerender(); },
      }, h('option', { value: 'auto' }, '説明の位置：自動'), h('option', { value: 'right' }, '説明の位置：右'), h('option', { value: 'bottom' }, '説明の位置：下')),
      s.fig && canEdit(data.work) ? h('button', { class: 'btn', title: 'この図を編集する', onclick: () => openEditorAfter(data.w, t.draft.id, s.fig.refId) }, icon('pencil', 16), '図を編集') : null,
      h('button', { class: 'btn', title: '全画面（F）', onclick: toggleFull }, '全画面')),
    h('div', { class: 'show-body' },
      h('div', { class: 'show-fig', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX - r.left < r.width * 0.35) prev(); else next(); } },
        Figure(data, t, s, idx),
        s.carried ? h('div', { class: 'show-carried' }, '前の図のまま') : null,
        s.part ? h('div', { class: 'show-carried' }, `このタイミングの図 ${s.part[0]} / ${s.part[1]}`) : null,
        V.i > 0 ? h('div', { class: 'show-arrow left' }, '‹') : null,
        V.i < list.length - 1 ? h('div', { class: 'show-arrow right' }, '›') : null),
      h('div', { class: 'show-side-pane' },
        h('div', { class: 'show-notes' },
          s.b && s.b.cue ? CueTitle(s.b.cue, false, s.b.cueEnd) : h('div', { class: 'cue muted' }, s.b ? '（タイミングの語句なし）' : ''),
          (s.texts || []).map((it) => h('div', { key: it.id, class: 'p-text' }, DotText(it.text, null, it.marks))),
          (s.imgs || []).length ? h('div', { class: 'show-photos' }, s.imgs.map((it) => {
            const im = t.images[it.refId];
            return im ? h('figure', { key: it.id },
              h('img', { src: im.data, alt: it.caption || '参考写真', title: 'クリックで大きく表示', onclick: () => { V.zoom = { src: im.data, cap: it.caption || '' }; rerender(); } }),
              it.caption ? h('figcaption', null, it.caption) : null) : null;
          })) : null),
        h('div', { class: 'show-script' },
          text ? rows.map((row) => h('div', {
            key: 'r' + row.start,
            class: 'show-row' + (s.b && row.start <= s.off && s.off < row.end ? ' cur' : '') + (row.start > s.off && row.start < nextOff ? ' cur' : ''),
          }, ScriptLines(text, row.lines, hls, { onLine: (e, l) => jumpToText(s.ti, l.end) })))
            : h('p', { class: 'muted' }, '（テマ友なし）')))),
    V.zoom ? h('div', { class: 'show-zoom', onclick: () => { V.zoom = null; rerender(); } },
      h('img', { src: V.zoom.src, alt: V.zoom.cap || '参考写真' }),
      V.zoom.cap ? h('div', { class: 'show-zoom-cap' }, V.zoom.cap) : null) : null);
}

function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else (document.querySelector('.show') || document.documentElement).requestFullscreen?.().catch(() => {});
}

// 描いたあと：いまの段が見えるようにテマ友をスクロール
export function afterShow() {
  if (S.route.name !== 'show') return;
  slidePeople();
  if (V.scrolled === V.i) return;
  const pane = document.querySelector('.show-script');
  const cur = pane && pane.querySelector('.show-row.cur');
  if (!pane) return;
  V.scrolled = V.i;
  if (cur) pane.scrollTo({ top: Math.max(0, cur.offsetTop - pane.offsetTop - 12), behavior: 'smooth' });
  const notes = document.querySelector('.show-notes');
  if (notes) notes.scrollTop = 0;
}

document.addEventListener('keydown', (e) => {
  if (S.route.name !== 'show' || e.target.closest('input,select,textarea')) return;
  if (V.zoom) { if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); V.zoom = null; rerender(); } return; }
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); next(); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'ArrowUp') { e.preventDefault(); prev(); }
  else if (e.key === 'Home') goTo(0);
  else if (e.key === 'End') goTo(steps().length - 1);
  else if (e.key === 'f' || e.key === 'F') toggleFull();
  else if (e.key === 'Escape' && !document.fullscreenElement) go(backHref());
});

// スマホ：図を左右にスワイプ
let tx = null, ty = null;
document.addEventListener('touchstart', (e) => {
  if (S.route.name !== 'show' || !e.target.closest('.show-fig')) { tx = null; return; }
  tx = e.touches[0].clientX; ty = e.touches[0].clientY;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (tx == null) return;
  const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
  tx = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? next : prev)();
});

// 図を送ったとき：同じ人（同じメンバー・同じ番号）は、前の図の位置から新しい位置へすべるように動かす
let lastPos = null, lastI = -1, lastData = null;
const posOf = (g) => {
  const m = /translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)\s*\)/.exec(g.getAttribute('transform') || '');
  return m ? [+m[1], +m[2]] : null;
};
function slidePeople() {
  if (V.i === lastI && S.d.print === lastData) return;
  const svg = document.querySelector('.show-fig svg');
  const now = new Map();
  if (svg) for (const g of svg.querySelectorAll('g[data-pk]')) { const p = posOf(g); if (p && !now.has(g.dataset.pk)) now.set(g.dataset.pk, { g, p }); }
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (lastPos && S.d.print === lastData && Math.abs(V.i - lastI) === 1 && !reduce && svg) {
    const D = 650;
    let moved = 0;
    for (const [k, { g, p }] of now) {
      const o = lastPos.get(k);
      if (!o) { g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: D * 0.6, fill: 'backwards' }); continue; }
      if (Math.hypot(o[0] - p[0], o[1] - p[1]) < 0.5) continue;
      moved++;
      g.animate([{ transform: `translate(${o[0]}px, ${o[1]}px)` }, { transform: `translate(${p[0]}px, ${p[1]}px)` }], { duration: D, easing: 'cubic-bezier(.45,0,.25,1)' });
    }
    // 名前などの文字は、動き終わるころに出す
    if (moved) {
      const labels = svg.querySelector(':scope > g:last-of-type');
      if (labels) labels.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: D * 0.8, fill: 'backwards' });
    }
  }
  lastPos = new Map([...now].map(([k, v]) => [k, v.p]));
  lastI = V.i; lastData = S.d.print;
}
