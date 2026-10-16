// PDF書き出し用の表示（A4縦・左に台本、右にきっかけと舞台図）
import { h } from './vdom.js';
import { db } from './db.js';
import { S } from './state.js';
import { P, draftTitle } from './model.js';
import { buildRows, highlightRanges } from './script.js';
import { StageSVG } from './stage.js';
import { CastTable, Legend, ScriptLines, DotText, CueTitle } from './sheet.js';

const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0);

export async function loadPrint({ w, kind, id }) {
  const [work, episodes, tracks, drafts] = await Promise.all([
    db.get(P.work(w)), db.list(P.col(w, 'episodes')), db.list(P.col(w, 'tracks')), db.list(P.col(w, 'drafts')),
  ]);
  if (!work) throw new Error('作品が見つかりません');
  let targets = [];
  let fileName = '';
  if (kind === 'd') {
    const d = drafts.find((x) => x.id === id);
    if (!d) throw new Error('稿が見つかりません');
    const t = tracks.find((x) => x.id === d.trackId);
    const e = t && episodes.find((x) => x.id === t.episodeId);
    targets = [{ draft: d, track: t, ep: e }];
    fileName = draftTitle(work, e, t, d);
  } else {
    const e = episodes.find((x) => x.id === id);
    if (!e) throw new Error('話が見つかりません');
    const ts = tracks.filter((t) => t.episodeId === e.id).sort(byOrder);
    for (const t of ts) {
      const d = drafts.filter((x) => x.trackId === t.id).sort((a, b) => (b.no || 0) - (a.no || 0))[0];
      if (d) targets.push({ draft: d, track: t, ep: e });
    }
    const nos = [...new Set(targets.map((x) => x.draft.no))];
    const range = ts.length ? `${ts[0].title}-${ts.length > 1 ? ts[ts.length - 1].title.replace(/^トラ/, '') : ''}` : '';
    fileName = `${e.title}${range}図解結合版${nos.length === 1 ? `_第${nos[0]}稿` : ''}`;
  }
  for (const t of targets) {
    const [blocks, diagrams, images] = await Promise.all([
      db.list(P.col(w, 'blocks'), ['draftId', t.draft.id]),
      db.list(P.col(w, 'diagrams'), ['draftId', t.draft.id]),
      db.list(P.col(w, 'images'), ['draftId', t.draft.id]),
    ]);
    t.blocks = blocks;
    t.diagrams = Object.fromEntries(diagrams.map((g) => [g.id, g]));
    t.images = Object.fromEntries(images.map((im) => [im.id, im]));
  }
  return { work, targets, fileName, w, kind, id };
}

function NoteBlock(t, b) {
  const items = Object.entries(b.items || {}).map(([id, it]) => ({ id, ...it })).sort(byOrder);
  return h('div', { key: b.id, class: 'p-block' },
    b.cue ? CueTitle(b.cue) : null,
    items.map((it) => {
      if (it.kind === 'text') return h('div', { key: it.id, class: 'p-text' }, DotText(it.text));
      if (it.kind === 'diagram') {
        const g = t.diagrams[it.refId];
        return h('figure', { key: it.id, class: 'p-fig' },
          it.caption ? h('figcaption', null, it.caption) : null,
          g ? StageSVG(g.shapes, 'stage p-stage') : null);
      }
      if (it.kind === 'image') {
        const im = t.images[it.refId];
        return h('figure', { key: it.id, class: 'p-fig p-photo size-' + (it.size || 'm') },
          it.caption ? h('figcaption', null, it.caption) : null,
          im ? h('img', { src: im.data, alt: it.caption || '参考写真' }) : null);
      }
      return null;
    }));
}

function Sheet(data, t, i) {
  const { work } = data;
  const text = t.draft.script || '';
  const rows = buildRows(text, t.blocks);
  const hls = highlightRanges(text, t.blocks);
  const title = draftTitle(work, t.ep, t.track, t.draft);
  return h('table', { key: t.draft.id, class: 'sheet' + (i > 0 ? ' newpage' : '') },
    h('colgroup', null, h('col', { class: 'c-script' }), h('col', { class: 'c-notes' })),
    h('thead', null, h('tr', null, h('th', { colspan: 2, class: 'sheet-title' }, title))),
    h('tbody', null,
      h('tr', { class: 'info' }, h('td', { colspan: 2 },
        h('div', { class: 'info-line' }, '図解っ子：', t.draft.zukaikko || ''),
        h('div', { class: 'info-line' }, '表現したいこと（場面', h('i', { class: 'dot' }), '）：', t.draft.theme || ''),
        CastTable(work.cast),
        Legend())),
      text ? rows.map((row) => h('tr', { key: 'r' + row.start, class: 'p-row' },
        h('td', { class: 'p-script' }, ScriptLines(text, row.lines, hls)),
        h('td', { class: 'p-notes' }, row.blocks.map(({ b }) => NoteBlock(t, b)))))
        : h('tr', { class: 'p-row' }, h('td', { class: 'p-script' }, '（台本なし）'), h('td', { class: 'p-notes' }, ''))));
}

export function PrintView() {
  if (S.d.printError) return h('main', { class: 'page' }, h('p', null, S.d.printError), h('a', { href: '#/' }, '戻る'));
  const data = S.d.print;
  if (!data) return h('div', { class: 'loading' }, 'PDF用のページを準備しています…');
  document.title = data.fileName;
  const back = data.kind === 'd' ? `#/w/${data.w}/d/${data.id}` : `#/w/${data.w}`;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return [
    h('div', { class: 'print-bar no-print' },
      h('a', { class: 'btn', href: back, onclick: () => { document.title = '舞台図解メーカー'; } }, '← 戻る'),
      h('div', { class: 'grow' },
        h('b', null, data.fileName),
        h('div', { class: 'muted small' }, ios
          ? '「PDFを保存」→ 共有ボタン →「プリント」→ プレビューを2本指で広げる → 共有から「ファイルに保存」'
          : '「PDFを保存」を押し、印刷画面の送信先で「PDFに保存」を選んでください（用紙A4・縦、余白は既定）。')),
      h('button', { class: 'btn primary', onclick: () => window.print() }, 'PDFを保存')),
    h('div', { class: 'print-root' }, data.targets.length
      ? data.targets.map((t, i) => Sheet(data, t, i))
      : h('p', { class: 'pad' }, 'この話にはまだ稿がありません。')),
  ];
}
