// 「サンプルを作る」：いただいた図解PDF（4話 最終稿のうち OP とトラ1）をもとにしたライブラリーを作る
// 中身は sample/narnia.json（テマ友・タイミング・説明・図）。
// それぞれのトラックに第1稿と第2稿を作り、第2稿では前の稿から変えたところ（PDFで青字だったところ）が青字になる。
import { db, newId } from './db.js';
import { P, LIB_COLS, exportWork } from './model.js';
import { LAYER } from './stage.js';
import { shapesSig } from './update.js';

let zc = 0;
const z = (t) => (LAYER[t] || 0) * 1e13 + Date.now() + zc++;

// sample/library.json（「サンプル用に書き出す」で作ったファイル）があれば、それをそのまま複製する
const sampleTitle = (t) => { const s = String(t || '').trim(); return /（サンプル）$/.test(s) ? s : s + '（サンプル）'; };
async function cloneLibrary(L, user) {
  const w = newId();
  const now = Date.now();
  const ops = [];
  ops.push({ op: 'set', path: P.work(w), data: {
    ...L.work, title: sampleTitle(L.work.title), participants: [user.email], owners: [user.email], viewers: [], linkRole: 'off', linkKey: newId(20),
    createdAt: now, updatedAt: now, createdBy: user.name,
  } });
  const map = {};
  const nid = (old) => (old ? (map[old] || (map[old] = newId())) : old);
  const C = L.cols || {};
  for (const c of LIB_COLS) for (const d of C[c] || []) nid(d.id);
  const re = (v) => (v && map[v]) || v;
  for (const c of LIB_COLS) {
    for (const d of C[c] || []) {
      const { id, ...data } = d;
      if (c === 'drafts') { delete data.updatedAt; delete data.updatedBy; } // 作ったばかりのサンプルには更新日時・更新者を出さない
      for (const k of ['episodeId', 'trackId', 'draftId', 'copiedFrom']) if (data[k]) data[k] = re(data[k]);
      if (data.items) {
        const items = {};
        for (const [k, it] of Object.entries(data.items)) items[k] = it && it.refId ? { ...it, refId: re(it.refId) } : it;
        data.items = items;
      }
      ops.push({ op: 'set', path: P.doc(w, c, map[id]), data });
    }
  }
  await db.batchUntracked(ops);
  return w;
}

// 全員共通のサンプル（settings.js の SAMPLE_LINK のライブラリー）を、自分のライブラリーとして複製する。
// 元のライブラリーを読むために、いったん閲覧者として参加し、読み終わったら共有から抜ける。
export async function buildSampleFrom(t, user) {
  const me = user.email;
  let src = await db.getQuiet(P.work(t.w));
  const wasMember = !!(src && (src.participants || []).includes(me));
  if (!wasMember) {
    if (!t.key) throw new Error('サンプルのリンクが正しくありません');
    await db.joinWork(t.w, t.key, me);
  }
  try {
    const L = await exportWork(t.w);
    return await cloneLibrary(L, user);
  } finally {
    if (!wasMember) {
      try {
        src = await db.get(P.work(t.w));
        await db.update(P.work(t.w), {
          participants: (src.participants || []).filter((e) => e !== me),
          viewers: (src.viewers || []).filter((e) => e !== me),
        });
      } catch (e) { /* 抜けられなくても、複製はできている */ }
    }
  }
}

export async function buildSample(user) {
  try {
    const r = await fetch('sample/library.json', { cache: 'no-cache' });
    if (r.ok) {
      const L = await r.json();
      if (L && L.format === 'zukai-library') return await cloneLibrary(L, user);
    }
  } catch (e) { /* なければ下の作り方で */ }
  const res = await fetch('sample/narnia.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('サンプルのデータを読み込めませんでした');
  const S = await res.json();
  const w = newId();
  const now = Date.now();
  const cids = {};
  const cast = S.cast.map((c) => {
    const id = newId(8);
    cids[c.no] = id;
    return { id, name: c.name, roles: c.role ? [{ name: c.role, label: c.label || '' }] : [], tag: /^[0-9]+$/.test(c.no) ? '' : c.no };
  });
  const ops = [];
  const set = (path, data) => ops.push({ op: 'set', path, data });
  set(P.work(w), {
    title: sampleTitle(S.title), prefix: S.prefix, participants: [user.email], owners: [user.email], viewers: [], linkRole: 'off', linkKey: newId(20),
    cast, labelRules: S.labelRules, createdAt: now, updatedAt: now, createdBy: user.name,
  });

  // 図形を保存する形に（同じトラックの中では、同じ番号の人は同じ id にして「あとの図にも反映」が効くようにする）
  const toShapes = (list, pid) => {
    const out = {};
    for (const s of list) {
      let id;
      if (s.t === 'person') {
        const key = 'p' + s.no;
        id = pid[key] || (pid[key] = newId(8));
        if (out[id]) id = newId(8); // 同じ図に同じ番号がもう1人
        const { no, ...rest } = s;
        out[id] = { ...rest, id, cid: cids[no] || undefined, z: z('person') };
        if (!out[id].ring) delete out[id].ring;
        if (!out[id].cid) { delete out[id].cid; out[id].no = no; }
      } else {
        id = newId(8);
        out[id] = { ...s, id, z: z(s.t) };
      }
    }
    return out;
  };

  S.episodes.forEach((ep, ei) => {
    const epId = newId();
    set(P.doc(w, 'episodes', epId), { title: ep.title, order: ei + 1, createdAt: now });
    ep.tracks.forEach((t, ti) => {
      const tid = newId();
      set(P.doc(w, 'tracks', tid), { episodeId: epId, title: t.title, order: ti + 1, createdAt: now });
      const d1 = newId(), d2 = newId();
      const base = { trackId: tid, zukaikko: t.zukaikko || '', theme: t.theme || '', script: t.script };
      set(P.doc(w, 'drafts', d1), { ...base, no: 1, createdAt: now - 1000 });
      set(P.doc(w, 'drafts', d2), { ...base, no: 2, createdAt: now, copiedFrom: d1, updMark: true, updShow: true });
      const pid1 = {}, pid2 = {};
      t.blocks.forEach((b, bi) => {
        const items1 = {}, items2 = {};
        const orig = { cue: b.cue || '', texts: {}, dias: {} };
        b.items.forEach((it, ii) => {
          const k = 'i' + (ii + 1);
          if (it.kind === 'text') {
            const lines = it.text.split('\n');
            const old = lines.filter((_, i) => !(it.newLines || []).includes(i));
            items2[k] = { order: ii + 1, kind: 'text', text: it.text };
            orig.texts[k] = old.join('\n');
            if (old.some((x) => x.trim())) items1[k] = { order: ii + 1, kind: 'text', text: old.join('\n') };
          } else if (it.kind === 'diagram') {
            const g1 = newId(), g2 = newId();
            const sh1 = toShapes(it.shapes, pid1), sh2 = toShapes(it.shapes, pid2);
            // 役名（ルー・アスなど）は、元の図に書いてあった人だけ出す
            const roleVis = {};
            for (const c of S.cast) if (c.label && cids[c.no]) roleVis[cids[c.no] + '_0'] = (it.showRoles || []).includes(c.no);
            set(P.doc(w, 'diagrams', g1), { draftId: d1, shapes: sh1, roleVis, createdAt: now + bi });
            set(P.doc(w, 'diagrams', g2), { draftId: d2, shapes: sh2, roleVis, createdAt: now + bi });
            items1[k] = { order: ii + 1, kind: 'diagram', refId: g1, caption: '' };
            items2[k] = { order: ii + 1, kind: 'diagram', refId: g2, caption: '' };
            // 「図解修正済み」だった図は、前の稿から変えた図にする
            orig.dias[k] = it.changed ? 'changed' : shapesSig(sh2);
          }
        });
        const common = { cue: b.cue || '', anchor: b.anchor, newRow: b.newRow !== false, createdAt: now + b.anchor.offset + bi / 1000 };
        // 第1稿：新しく足したタイミングはまだない
        if (!b.cueNew) set(P.doc(w, 'blocks', newId()), { ...common, draftId: d1, items: items1 });
        set(P.doc(w, 'blocks', newId()), { ...common, draftId: d2, items: items2, ...(b.cueNew ? {} : { orig }) });
      });
    });
  });

  await db.batchUntracked(ops);
  return w;
}
