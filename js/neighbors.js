// 前後のトラックの図（図の編集で、前のトラックの最後の図・次のトラックの最初の図を見るため）
import { db } from './db.js';
import { S } from './state.js';
import { P } from './model.js';
import { buildRows } from './script.js';

// 稿の図を、表示される順に並べる（図の id の並び）
export function sequenceOf(draft, blocks) {
  if (!draft) return [];
  const rows = buildRows(draft.script || '', blocks || [], draft.spkFix);
  const out = [];
  for (const row of rows) {
    for (const { b } of row.blocks) {
      const items = Object.values(b.items || {}).sort((x, y) => (x.order || 0) - (y.order || 0));
      for (const it of items) if (it.kind === 'diagram' && it.refId) out.push(it.refId);
    }
  }
  return out;
}

const latestOf = (trackId) => (S.d.drafts || []).filter((d) => d.trackId === trackId).sort((a, b) => (b.no || 0) - (a.no || 0))[0] || null;

// 同じ話の、ひとつ前・ひとつ後のトラック（それぞれ最新の稿）
export function neighborDrafts(draftId) {
  const d = (S.d.drafts || []).find((x) => x.id === draftId);
  const t = d && (S.d.tracks || []).find((x) => x.id === d.trackId);
  if (!t) return { prev: null, next: null };
  const list = (S.d.tracks || []).filter((x) => x.episodeId === t.episodeId).sort((a, b) => (a.order || 0) - (b.order || 0));
  const i = list.findIndex((x) => x.id === t.id);
  const side = (k) => { const tr = list[i + k]; const dr = tr && latestOf(tr.id); return dr ? { track: tr, draft: dr } : null; };
  return { prev: side(-1), next: side(1) };
}

// 読み込んだ前後の稿の図：{ [draftId]: { seq, byId } }
const cache = {};
let busy = {};
export async function loadNeighbor(w, draft, redraw) {
  if (!draft || busy[draft.id]) return;
  busy[draft.id] = true;
  try {
    const [blocks, diagrams] = await Promise.all([
      db.list(P.col(w, 'blocks'), ['draftId', draft.id]),
      db.list(P.col(w, 'diagrams'), ['draftId', draft.id]),
    ]);
    const byId = {};
    for (const g of diagrams) byId[g.id] = g;
    cache[draft.id] = { seq: sequenceOf(draft, blocks).filter((id) => byId[id]), byId };
  } catch (e) { /* 読めなければ出さない */ }
  busy[draft.id] = false;
  if (redraw) redraw();
}

// 前のトラックの最後の図・次のトラックの最初の図（まだ読んでいなければ null）
export function edgeDiagram(side, draftId) {
  const n = neighborDrafts(draftId)[side];
  if (!n) return null;
  const c = cache[n.draft.id];
  if (!c || !c.seq.length) return null;
  const id = side === 'prev' ? c.seq[c.seq.length - 1] : c.seq[0];
  return { ...n, diagram: c.byId[id] };
}
