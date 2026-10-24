// ライブラリー・話・トラ・稿・タイミング・図・写真のデータ操作
import { db, newId } from './db.js';
import { makeOrig, blockUpdates } from './update.js';
import { resolveAnchor } from './script.js';
import { stageCount } from './stage.js';

export const P = {
  work: (w) => `works/${w}`,
  col: (w, c) => `works/${w}/${c}`,
  doc: (w, c, id) => `works/${w}/${c}/${id}`,
};
const now = () => Date.now();

// 画面では「トラック」、PDFのタイトルなど細かい所では「トラ」と表記する
export function shortTrack(title) { return String(title || '').replace(/トラック/g, 'トラ'); }

// 稿の呼び名（「第3稿」「最終稿」「2.5稿」など。自由に付けた名前があればそれ）
export function draftName(draft) {
  if (draft && draft.label) return draft.label;
  return `第${draft && draft.no != null ? draft.no : 1}稿`;
}
// 入力された稿の名前を整える（数字だけなら「第〇稿」にする）
export function normalizeDraftName(v) {
  const t = String(v || '').trim();
  if (/^[0-9０-９]+([.．][0-9０-９]+)?$/.test(t)) return `第${t}稿`;
  return t;
}
export function draftTitle(work, ep, track, draft) {
  const prefix = work && work.prefix != null ? work.prefix : '【表現活動】';
  return `${prefix}${ep ? ep.title : ''}図解_${track ? shortTrack(track.title) : ''}_${draftName(draft)}`;
}

export async function createWork(title, user) {
  const id = newId();
  await db.set(P.work(id), { title, prefix: '【表現活動】', participants: [user.email], owners: [user.email], viewers: [], linkRole: 'off', linkKey: newId(20), cast: [{ id: newId(8), tag: 'CD', name: '', roles: [] }], createdAt: now(), updatedAt: now(), createdBy: user.name });
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
// opts.label：新しい稿の名前（なければ「第〇稿」）
// opts.keepBlue：青字をそのままにする（前の稿で青だったところを、新しい稿でも青のままにする）。
//   しないときは、前の稿の青字（自動の青字・手で付けた青）は黒になる。ピンク・赤・灰色・太字・塗りはそのまま
export async function copyDraft(w, draftId, user, opts = {}) {
  const src = await db.get(P.doc(w, 'drafts', draftId));
  if (!src) throw new Error('元の稿が見つかりません');
  const all = await db.list(P.col(w, 'drafts'), ['trackId', src.trackId]);
  const no = Math.max(0, ...all.map((d) => d.no || 0)) + 1;
  const nd = newId();
  const label = opts.label && opts.label !== `第${no}稿` ? opts.label : '';
  const noBlue = (marks) => (marks || []).filter((m) => !(m.k === 'c' && m.v === 'blue'));
  const ops = [{ op: 'set', path: P.doc(w, 'drafts', nd), data: {
    ...src, no, label, createdAt: now(), updatedAt: now(), updatedBy: user.name, copiedFrom: draftId, updMark: true, updShow: true,
    scriptMarks: opts.keepBlue ? (src.scriptMarks || []) : noBlue(src.scriptMarks),
  } }];
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
  const byId = Object.fromEntries(diagrams.map((g) => [g.id, g]));
  for (const b of blocks) {
    const { id: _, orig: _o, cueBlue: _cb, ...rest } = b;
    const u = opts.keepBlue ? blockUpdates(src, b, byId) : null; // 前の稿での青字
    rest.orig = makeOrig(b, byId); // 更新箇所を青字にするための控え
    if (u && (u.cue || b.cueBlue) && b.cue) rest.cueBlue = true;
    const items = {};
    for (const [k, it] of Object.entries(b.items || {})) {
      items[k] = it.refId ? { ...it, refId: map[it.refId] || it.refId } : it;
      if (it.kind === 'text') {
        let marks = opts.keepBlue ? (it.marks || []) : noBlue(it.marks);
        if (u) {
          // 自動で青だった行に、青い色を付けておく（手で色を付けた文字はそのまま）
          const text = it.text || '';
          const colored = new Set();
          for (const m of marks) if (m.k === 'c') for (let i = m.s; i < m.e; i++) colored.add(i);
          let pos = 0;
          for (const ln of text.split('\n')) {
            const st = pos; pos += ln.length + 1;
            if (!u.line(k, ln)) continue;
            let i = st;
            while (i < st + ln.length) {
              if (colored.has(i)) { i++; continue; }
              let j = i;
              while (j < st + ln.length && !colored.has(j)) j++;
              marks = [...marks, { s: i, e: j, k: 'c', v: 'blue' }];
              i = j;
            }
          }
        }
        items[k] = { ...items[k], marks };
      }
      // 前の稿で「図解修正済み」だった図は、新しい稿でもそのまま
      if (u && it.kind === 'diagram' && u.diagram(k, it.refId)) rest.orig.dias[k] = 'changed';
    }
    ops.push({ op: 'set', path: P.doc(w, 'blocks', newId()), data: { ...rest, items, draftId: nd } });
  }
  await db.batch(ops);
  return nd;
}

export async function deleteDraft(w, draftId) {
  const [blocks, diagrams, images, comments] = await Promise.all([
    db.list(P.col(w, 'blocks'), ['draftId', draftId]),
    db.list(P.col(w, 'diagrams'), ['draftId', draftId]),
    db.list(P.col(w, 'images'), ['draftId', draftId]),
    db.list(P.col(w, 'comments'), ['draftId', draftId]).catch(() => []),
  ]);
  const ops = [];
  for (const c of comments) ops.push({ op: 'remove', path: P.doc(w, 'comments', c.id) });
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

// ライブラリーを丸ごと1つのファイル（JSON）にする（「サンプル用に書き出す」）
export const LIB_COLS = ['episodes', 'tracks', 'drafts', 'blocks', 'diagrams', 'images'];
export async function exportWork(w) {
  const work = await db.get(P.work(w));
  const out = { format: 'zukai-library', version: 1, exportedAt: now(), work: {}, cols: {} };
  for (const k of ['title', 'prefix', 'cast', 'roleList', 'labelRules']) if (work && work[k] !== undefined) out.work[k] = work[k];
  // 更新日時・更新した人は書き出さない（サンプルに名前が残らないように）
  for (const c of LIB_COLS) out.cols[c] = (await db.list(P.col(w, c))).map(({ updatedAt, updatedBy, createdBy, lastJoin, ...rest }) => rest);
  return out;
}

export async function deleteWork(w) {
  const ops = [];
  for (const c of ['episodes', 'tracks', 'drafts', 'blocks', 'diagrams', 'images', 'comments']) {
    const items = await db.list(P.col(w, c));
    for (const it of items) ops.push({ op: 'remove', path: P.doc(w, c, it.id) });
  }
  ops.push({ op: 'remove', path: P.work(w) });
  await db.batch(ops);
}

// テーマ活動の友を保存し、タイミングの位置を付け直す
export async function saveScript(w, draftId, script, blocks, user) {
  const ops = [{ op: 'update', path: P.doc(w, 'drafts', draftId), data: { script, updatedAt: now(), updatedBy: user.name } }];
  for (const b of blocks) {
    const r = resolveAnchor(script, b.anchor);
    if (r.ok && r.offset !== b.anchor.offset) ops.push({ op: 'update', path: P.doc(w, 'blocks', b.id), data: { 'anchor.offset': r.offset } });
    if (b.cueEnd && b.anchorEnd && b.anchorEnd.text) { const e = resolveAnchor(script, b.anchorEnd); if (e.ok && e.offset !== b.anchorEnd.offset) ops.push({ op: 'update', path: P.doc(w, 'blocks', b.id), data: { 'anchorEnd.offset': e.offset } }); }
  }
  await db.batch(ops);
}

// 図解（《タイミング》のページ）を作る。はじめは文章だけ（図や写真は、ツールバーの「足す」でカーソルの位置に入れる）
export async function createBlock(w, draftId, { cue, offset, anchorText }) {
  const id = newId();
  const itemId = newId(8);
  await db.batch([
    {
      op: 'set', path: P.doc(w, 'blocks', id), data: {
        draftId, cue: cue || '', anchor: { offset, text: anchorText || '' }, newRow: true, createdAt: now(),
        items: { [itemId]: { order: 1, kind: 'text', text: '● ' } },
      },
    },
    // テマ友がなくても図解がある稿だと分かるように（ライブラリーのページで、空の稿のボタンを押せなくするため）
    { op: 'update', path: P.doc(w, 'drafts', draftId), data: { figs: true } },
  ]);
  return { id, itemId };
}

// 写真の幅（ページの幅に対する %）。2.1.0 より前の「小・中・大」はそれぞれ 40・68・100
export function photoWidth(it) {
  const v = Number(it && it.w);
  if (v > 0) return Math.max(10, Math.min(100, v));
  return { s: 40, m: 68, l: 100 }[(it && it.size) || 'm'] || 68;
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
    // 「ぐっち：ビーヴァー奥さん」（名前：役）
    if (cols.length === 1 && /[：:]/.test(line)) cols = line.split(/[：:]/).map((x) => x.trim());
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

// ホームのカードに出す図（ライブラリーの works/{w}.thumb に入れる）。写真の図形は大きいので入れない
// n は舞台の上の人・図形の数。いつも n がいちばん多い図をカードにする
export function thumbOf(g) {
  const shapes = {};
  for (const [id, s] of Object.entries((g && g.shapes) || {})) if (s && s.t !== 'image') shapes[id] = s;
  return { g: g.id || null, shapes, roleVis: (g && g.roleVis) || {}, n: stageCount(shapes), at: Date.now() };
}
