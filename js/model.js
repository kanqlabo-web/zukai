// 作品・話・トラ・稿・タイミング・図・写真のデータ操作
import { db, newId } from './db.js';
import { resolveAnchor } from './script.js';

export const P = {
  work: (w) => `works/${w}`,
  col: (w, c) => `works/${w}/${c}`,
  doc: (w, c, id) => `works/${w}/${c}/${id}`,
};
const now = () => Date.now();

// 画面では「トラック」、PDFのタイトルなど細かい所では「トラ」と表記する
export function shortTrack(title) { return String(title || '').replace(/トラック/g, 'トラ'); }

export function draftTitle(work, ep, track, draft) {
  const prefix = work && work.prefix != null ? work.prefix : '【表現活動】';
  return `${prefix}${ep ? ep.title : ''}図解_${track ? shortTrack(track.title) : ''}_第${draft ? draft.no : 1}稿`;
}

export async function createWork(title, user) {
  const id = newId();
  await db.set(P.work(id), { title, prefix: '【表現活動】', admins: [user.email], participants: [user.email], cast: [{ id: newId(8), tag: 'CD', name: '', roles: [] }], createdAt: now(), updatedAt: now(), createdBy: user.name });
  return id;
}

export async function createEpisode(w, title, order) {
  const id = newId();
  await db.set(P.doc(w, 'episodes', id), { title, order, createdAt: now() });
  return id;
}

export async function createTrack(w, episodeId, title, order, user) {
  const id = newId();
  const d = newId();
  await db.batch([
    { op: 'set', path: P.doc(w, 'tracks', id), data: { episodeId, title, order, createdAt: now() } },
    { op: 'set', path: P.doc(w, 'drafts', d), data: emptyDraft(id, 1, user) },
  ]);
  return { trackId: id, draftId: d };
}

export function emptyDraft(trackId, no, user) {
  return { trackId, no, zukaikko: '', theme: '', script: '', createdAt: now(), updatedAt: now(), updatedBy: user ? user.name : '' };
}

// 稿を複製して新しい稿を作る（タイミング・図・写真ごと）
export async function copyDraft(w, draftId, user) {
  const src = await db.get(P.doc(w, 'drafts', draftId));
  if (!src) throw new Error('元の稿が見つかりません');
  const all = await db.list(P.col(w, 'drafts'), ['trackId', src.trackId]);
  const no = Math.max(0, ...all.map((d) => d.no || 0)) + 1;
  const nd = newId();
  const ops = [{ op: 'set', path: P.doc(w, 'drafts', nd), data: { ...src, no, createdAt: now(), updatedAt: now(), updatedBy: user.name, copiedFrom: draftId } }];
  const [blocks, diagrams, images] = await Promise.all([
    db.list(P.col(w, 'blocks'), ['draftId', draftId]),
    db.list(P.col(w, 'diagrams'), ['draftId', draftId]),
    db.list(P.col(w, 'images'), ['draftId', draftId]),
  ]);
  const map = {};
  for (const g of diagrams) {
    const id = newId(); map[g.id] = id;
    const { id: _, ...rest } = g;
    ops.push({ op: 'set', path: P.doc(w, 'diagrams', id), data: { ...rest, draftId: nd } });
  }
  for (const im of images) {
    const id = newId(); map[im.id] = id;
    const { id: _, ...rest } = im;
    ops.push({ op: 'set', path: P.doc(w, 'images', id), data: { ...rest, draftId: nd } });
  }
  for (const b of blocks) {
    const { id: _, ...rest } = b;
    const items = {};
    for (const [k, it] of Object.entries(b.items || {})) items[k] = it.refId ? { ...it, refId: map[it.refId] || it.refId } : it;
    ops.push({ op: 'set', path: P.doc(w, 'blocks', newId()), data: { ...rest, items, draftId: nd } });
  }
  await db.batch(ops);
  return nd;
}

export async function deleteDraft(w, draftId) {
  const [blocks, diagrams, images] = await Promise.all([
    db.list(P.col(w, 'blocks'), ['draftId', draftId]),
    db.list(P.col(w, 'diagrams'), ['draftId', draftId]),
    db.list(P.col(w, 'images'), ['draftId', draftId]),
  ]);
  const ops = [];
  for (const b of blocks) ops.push({ op: 'remove', path: P.doc(w, 'blocks', b.id) });
  for (const g of diagrams) ops.push({ op: 'remove', path: P.doc(w, 'diagrams', g.id) });
  for (const im of images) ops.push({ op: 'remove', path: P.doc(w, 'images', im.id) });
  ops.push({ op: 'remove', path: P.doc(w, 'drafts', draftId) });
  await db.batch(ops);
}

export async function deleteTrack(w, trackId) {
  const drafts = await db.list(P.col(w, 'drafts'), ['trackId', trackId]);
  for (const d of drafts) await deleteDraft(w, d.id);
  await db.remove(P.doc(w, 'tracks', trackId));
}

export async function deleteEpisode(w, epId) {
  const tracks = await db.list(P.col(w, 'tracks'), ['episodeId', epId]);
  for (const t of tracks) await deleteTrack(w, t.id);
  await db.remove(P.doc(w, 'episodes', epId));
}

export async function deleteWork(w) {
  const ops = [];
  for (const c of ['episodes', 'tracks', 'drafts', 'blocks', 'diagrams', 'images']) {
    const items = await db.list(P.col(w, c));
    for (const it of items) ops.push({ op: 'remove', path: P.doc(w, c, it.id) });
  }
  ops.push({ op: 'remove', path: P.work(w) });
  await db.batch(ops);
}

// 台本を保存し、タイミングの位置を付け直す
export async function saveScript(w, draftId, script, blocks, user) {
  const ops = [{ op: 'update', path: P.doc(w, 'drafts', draftId), data: { script, updatedAt: now(), updatedBy: user.name } }];
  for (const b of blocks) {
    const r = resolveAnchor(script, b.anchor);
    if (r.ok && r.offset !== b.anchor.offset) ops.push({ op: 'update', path: P.doc(w, 'blocks', b.id), data: { 'anchor.offset': r.offset } });
  }
  await db.batch(ops);
}

// 図解（《タイミング》＋動きの文章＋舞台図）を作る。舞台図は必ず1枚つける
export async function createBlock(w, draftId, { cue, offset, anchorText, shapes }) {
  const id = newId();
  const itemId = newId(8);
  const diaItem = newId(8);
  const gid = newId();
  await db.batch([
    { op: 'set', path: P.doc(w, 'diagrams', gid), data: { draftId, shapes: shapes || {}, createdAt: now() } },
    {
      op: 'set', path: P.doc(w, 'blocks', id), data: {
        draftId, cue: cue || '', anchor: { offset, text: anchorText || '' }, newRow: true, createdAt: now(),
        items: { [itemId]: { order: 1, kind: 'text', text: '● ' }, [diaItem]: { order: 2, kind: 'diagram', refId: gid, caption: '' } },
      },
    },
  ]);
  return { id, itemId, diagramId: gid };
}

export async function createDiagram(w, draftId, shapes = {}) {
  const id = newId();
  await db.set(P.doc(w, 'diagrams', id), { draftId, shapes, createdAt: now() });
  return id;
}

export async function createImage(w, draftId, img) {
  const id = newId();
  await db.set(P.doc(w, 'images', id), { draftId, ...img, createdAt: now() });
  return id;
}

// メンバーの貼り付けを解析：「1 ぐっち（ビーヴァー奥さん）」「ぐっち<TAB>ビーヴァー奥さん<TAB>奥」など
// 先頭の数字は無視（番号は一覧の順で自動）。「CD ばにく」のように先頭が英字の記号なら記号として扱う
export function parseCast(text) {
  const out = [];
  for (let line of (text || '').split('\n')) {
    line = line.replace(/\u3000/g, ' ').trim();
    if (!line) continue;
    let cols = line.split('\t').map((s) => s.trim());
    let tag = '';
    if (cols.length === 1) {
      const m = line.match(/^(\S+)\s+(.+)$/);
      cols = m ? [m[1], m[2]] : [line];
    }
    if (cols.length >= 2 && /^[0-9０-９]+$/.test(cols[0])) cols.shift();
    else if (cols.length >= 2 && /^[A-Za-z]{1,4}$/.test(cols[0])) tag = cols.shift();
    let [name = '', role = '', label = ''] = cols;
    const rm = name.match(/^(.*?)\s*[（(](.*)[）)]\s*$/);
    if (rm && !role) { name = rm[1]; role = rm[2]; }
    const names = role.split(/[\/／]/).map((x) => x.trim());
    const labels = label.split(/[\/／]/).map((x) => x.trim());
    const roles = names.map((n, k) => ({ name: n, label: labels[k] || '' })).filter((r) => r.name || r.label);
    out.push({ id: newId(8), name: name.trim(), roles, tag });
  }
  return out;
}

export function extractEmails(text) {
  const m = (text || '').match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) || [];
  return [...new Set(m.map((s) => s.toLowerCase()))];
}
