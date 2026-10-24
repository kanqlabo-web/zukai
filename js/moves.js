// 動きの変更（練習の場で、演者が閲覧モードの図で自分の位置を指で動かし、一言添えて図解部に送る）
// 図解部は、トラックのページの知らせと図の編集の「動きの変更」から、ボタン一つで図に反映するか見送る。
//
// データ：works/{w}/moves/{id} = {
//   draftId, trackId, blockId, cue（送ったときのタイミングの語句）, gid（図。図のないタイミングでは null）,
//   base（図のないタイミングで、前の図をもとに動かしたときの、その前の図。図解部はこれを写して、このタイミングの図を作る）,
//   moves: { [図形の id]: { x, y, fx, fy } }（fx・fy は送ったときの元の位置）, note（一言）,
//   me（送った人がメンバー一覧のだれか。cid）, by: { name, email }, ts,
//   state: 'open' | 'done'（反映した） | 'skip'（見送った）, doneBy, doneAt }
// 閲覧者も送れるように、firestore.rules で moves だけは参加者全員が作れる。元に戻すの履歴には入れない。
import { h } from './vdom.js';
import { db, newId } from './db.js';
import { S, rerender, toast, fmtTime, go, adminMsg } from './state.js';
import { P } from './model.js';
import { W, H, stageFrame, sortShapes, shapeNode, layoutLabels } from './stage.js';
import { workIndex, personCast, personNo, personRole, roleShort } from './cast.js';

export const movesOf = () => (S.d.moves || []).filter((m) => m && m.state === 'open');
const byTs = (a, b) => (b.ts || 0) - (a.ts || 0);
const meUser = () => ({ name: (S.user && S.user.name) || '', email: (S.user && S.user.email) || '' });

// ---------- 「自分」（この端末で、ライブラリーごとに覚えておく） ----------
const meKey = (w) => 'zukai.me.' + w;
export function meOf(w) { try { return localStorage.getItem(meKey(w)) || ''; } catch (e) { return ''; } }
function setMe(w, cid) { try { if (cid) localStorage.setItem(meKey(w), cid); else localStorage.removeItem(meKey(w)); } catch (e) { /* 使えない環境 */ } }

// 図の人の呼び方（③ 山田（王様）など）
export function personLabel(s, ix) {
  if (!s) return '（いない人）';
  const c = personCast(s, ix);
  const no = personNo(s, ix);
  const pr = personRole(s, ix);
  const role = pr ? roleShort(pr.role) : '';
  const name = c ? c.name : role || '';
  return [no, name].filter(Boolean).join(' ') || '番号のない人';
}
function senderLabel(m, ix) {
  const c = m.me && ix && ix.byId[m.me];
  const who = c ? `${c.no} ${c.name}` : '';
  const acct = (m.by && m.by.name) || '';
  return who && acct && !acct.includes(c.name) ? `${who}（${acct}）` : who || acct || '（名前なし）';
}

// ---------- 閲覧モード：演者が動かして送る ----------
const M = { on: false, key: '', temp: {}, note: '', drag: null, sending: false, pickMe: false };
export const moveEditing = () => M.on;
const stepKey = (t, s) => `${t.draft.id}:${s.b ? s.b.id : ''}:${s.fig ? s.fig.refId : ''}:${s.carried ? 1 : 0}`;
function startMove(t, s) { Object.assign(M, { on: true, key: stepKey(t, s), temp: {}, note: '', drag: null, sending: false }); rerender(); }
function stopMove() { Object.assign(M, { on: false, key: '', temp: {}, note: '', drag: null, sending: false }); rerender(); }

// 図を送ったら（別の図に移ったら）、動かしていた分は捨てる
function syncStep(t, s) { if (M.on && M.key !== stepKey(t, s)) stopMove(); }

function myShapeIds(shapes, ix, me) {
  if (!me) return [];
  return Object.values(shapes || {}).filter((s) => s && s.t === 'person' && (personCast(s, ix) || {}).id === me).map((s) => s.id);
}

// 図（閲覧モードの StageSVG と同じ描き方。人の上に、自分の印と動かした跡を重ねる。囲みの塗りに隠れないように）
// 最後の g は名前（閲覧モードのすべる動きが、名前を遅れて出すのに使う）
function stageWith(shapes, ix, roleVis, under, attrs = {}) {
  const list = sortShapes(shapes);
  return h('svg', { class: 'stage show-stage', viewBox: `0 0 ${W} ${H}`, xmlns: 'http://www.w3.org/2000/svg', preserveAspectRatio: 'xMidYMid meet', ...attrs },
    stageFrame(),
    h('g', null, list.map((s) => shapeNode(s, { idx: ix }))),
    h('g', { class: 'mv-marks', 'pointer-events': 'none' }, under),
    h('g', null, layoutLabels(list, ix, roleVis)));
}

function svgPoint(e) {
  const svg = e.currentTarget.ownerSVGElement || e.currentTarget;
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return [p.x, p.y];
}
function nearestPerson(shapes, x, y, range) {
  let best = null, bd = range;
  for (const s of Object.values(shapes)) {
    if (!s || s.t !== 'person') continue;
    const d = Math.hypot(s.x - x, s.y - y) - (s.r || 20);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 閲覧モードの図。動かしている間は、人を指（マウス）でつまんで動かせる
export function ShowFigure(data, t, s, ix) {
  const g = s.fig && t.diagrams[s.fig.refId];
  syncStep(t, s);
  if (!g) return null;
  const me = meOf(data.w);
  const editing = M.on;
  const shapes = { ...(g.shapes || {}) };
  if (editing) for (const id in M.temp) if (shapes[id]) shapes[id] = { ...shapes[id], ...M.temp[id] };
  const under = [];
  for (const id of myShapeIds(shapes, ix, me)) {
    const p = shapes[id];
    under.push(h('circle', { key: 'me-' + id, cx: p.x, cy: p.y, r: (p.r || 20) + 9, class: 'mv-me' }));
  }
  if (editing) {
    for (const id in M.temp) {
      const o = g.shapes[id], p = shapes[id];
      if (!o || !p) continue;
      under.push(h('line', { key: 'l-' + id, x1: o.x, y1: o.y, x2: p.x, y2: p.y, class: 'mv-line' }));
      under.push(h('circle', { key: 'o-' + id, cx: o.x, cy: o.y, r: o.r || 20, class: 'mv-from' }));
      under.push(h('circle', { key: 'n-' + id, cx: p.x, cy: p.y, r: (p.r || 20) + 6, class: 'mv-moved' }));
    }
  }
  if (!editing) return stageWith(shapes, ix, g.roleVis || {}, under);
  const down = (e) => {
    const [x, y] = svgPoint(e);
    const hit = nearestPerson(shapes, x, y, 30);
    if (!hit) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
    M.drag = { id: hit.id, dx: hit.x - x, dy: hit.y - y };
    rerender();
  };
  const move = (e) => {
    if (!M.drag) return;
    const [x, y] = svgPoint(e);
    M.temp[M.drag.id] = { x: Math.round(clamp(x + M.drag.dx, 0, W)), y: Math.round(clamp(y + M.drag.dy, 0, H)) };
    rerender();
  };
  const up = () => {
    if (!M.drag) return;
    const id = M.drag.id;
    M.drag = null;
    const o = g.shapes[id], p = M.temp[id];
    if (o && p && Math.hypot(o.x - p.x, o.y - p.y) < 3) delete M.temp[id]; // ほとんど動いていなければ、動かさなかったことに
    rerender();
  };
  return stageWith(shapes, ix, g.roleVis || {}, under, {
    class: 'stage show-stage mv-editing', onpointerdown: down, onpointermove: move, onpointerup: up, onpointercancel: up,
    onclick: (e) => e.stopPropagation(),
  });
}

// 閲覧モードの上のボタン
export function ShowMoveButton(data, t, s) {
  if (!s.b) return null;
  if (M.on) return null;
  return h('button', { class: 'btn mv-start', title: '練習で動きが変わったら、自分の位置を動かして図解部に送ります', onclick: () => startMove(t, s) },
    h('svg', { class: 'ico', viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' },
      h('circle', { cx: 6, cy: 16, r: 3, 'stroke-dasharray': '2 2' }), h('circle', { cx: 18, cy: 8, r: 3 }), h('path', { d: 'M8.5 14l6.5-4.5M15 9.5l-3.2.2M15 9.5l-1 3' })),
    '動きが変わった');
}

// 図の下（または上）に出す、送るための欄
export function MoveSheet(data, t, s, ix) {
  const fid = s.fig ? s.fig.refId : null;
  const mine = movesOf().filter((m) => m.by && S.user && m.by.email === S.user.email && s.b && m.blockId === s.b.id
    && (s.carried ? m.base === fid : m.gid === fid));
  const sentNote = !M.on && mine.length
    ? h('div', { class: 'mv-sent' }, `この図について送った変更が ${mine.length}件、図解部の確認待ちです。`) : null;
  if (!M.on) return sentNote;
  const g = s.fig && t.diagrams[s.fig.refId];
  const me = meOf(data.w);
  const moved = Object.keys(M.temp).filter((id) => g && g.shapes && g.shapes[id]);
  const noFig = !g;
  return h('div', { class: 'mv-sheet', role: 'dialog', 'aria-label': '動きの変更を図解部に送る' },
    h('div', { class: 'mv-sheet-head' },
      h('strong', null, '動きの変更を図解部に送る'),
      h('span', { class: 'muted small' }, s.b && s.b.cue ? `《${s.b.cue}》` : '')),
    noFig
      ? h('p', { class: 'small mv-hint' }, 'このタイミングには図がないので、一言だけ送れます。')
      : h('p', { class: 'small mv-hint' }, '動いた人を指でつまんで、新しい位置に動かしてください。何人でも動かせます。',
        s.carried ? '（このタイミングには図がないので、前の図をもとにします。図解部がこのタイミングの図を作ります）' : ''),
    h('label', { class: 'mv-me-row small' }, h('span', null, 'あなた'),
      h('select', { value: me, onchange: (e) => { setMe(data.w, e.target.value); rerender(); } },
        h('option', { value: '' }, '（選ぶと図で自分に印が付きます）'),
        workIndex(data.work).list.filter((c) => c.id).map((c) => h('option', { key: c.id, value: c.id }, `${c.no} ${c.name}`)))),
    moved.length ? h('ul', { class: 'mv-list small' }, moved.map((id) => h('li', { key: id },
      h('span', null, personLabel(g.shapes[id], ix), ' を動かしました'),
      h('button', { class: 'linklike', onclick: () => { delete M.temp[id]; rerender(); } }, '戻す')))) : null,
    h('textarea', {
      class: 'mv-note', rows: 2, value: M.note, placeholder: '一言（例：セリフの「〜」で上手へ。向きは客席）',
      oninput: (e) => { M.note = e.target.value; },
    }),
    h('div', { class: 'mv-actions' },
      h('button', { class: 'btn', onclick: stopMove }, 'やめる'),
      h('button', { class: 'btn primary', disabled: M.sending, onclick: () => sendMove(data, t, s) }, M.sending ? '送っています…' : '図解部に送る')));
}

async function sendMove(data, t, s) {
  const g = s.fig ? t.diagrams[s.fig.refId] : null;
  const moves = {};
  if (g) for (const id in M.temp) {
    const o = g.shapes && g.shapes[id], p = M.temp[id];
    if (o && p && Math.hypot(o.x - p.x, o.y - p.y) >= 3) moves[id] = { x: p.x, y: p.y, fx: o.x, fy: o.y };
  }
  const note = M.note.trim();
  if (!Object.keys(moves).length && !note) { toast('動いた人を動かすか、一言を書いてください', 'error'); return; }
  M.sending = true; rerender();
  const doc = {
    draftId: t.draft.id, trackId: (t.track && t.track.id) || t.draft.trackId || null, blockId: s.b ? s.b.id : null, cue: (s.b && s.b.cue) || '',
    gid: g && !s.carried ? s.fig.refId : null, base: g && s.carried ? s.fig.refId : null, moves, note, me: meOf(data.w) || null, by: meUser(), ts: Date.now(), state: 'open',
  };
  try {
    await db.setQuiet(P.doc(data.w, 'moves', newId()), doc);
    stopMove();
    toast('図解部に送りました。反映されると、次に開いたときの図が変わります');
  } catch (e) {
    M.sending = false; rerender();
    toast(e && e.code === 'permission-denied' ? adminMsg('送れませんでした', 'E501') : '送れませんでした。通信を確かめてください', 'error', 8000);
  }
}

// ---------- 図解部：知らせ・反映 ----------
async function closeMove(w, m, state) {
  try { await db.updateQuiet(P.doc(w, 'moves', m.id), { state, doneBy: meUser(), doneAt: Date.now() }); } catch (e) { toast('保存できませんでした。通信を確かめてください', 'error', 6000); }
}

// ライブラリーのページのトラックの行に出す数
export function TrackMoveChip(w, trackId, latestDraftId) {
  const draftIds = new Set((S.d.drafts || []).filter((d) => d.trackId === trackId).map((d) => d.id));
  const n = movesOf().filter((m) => m.trackId === trackId || draftIds.has(m.draftId)).length;
  if (!n) return null;
  return h('button', {
    class: 'mv-chip', title: '練習で送られてきた動きの変更', 'aria-label': `動きの変更 ${n}件`,
    onclick: (e) => { e.stopPropagation(); if (latestDraftId) go(`#/w/${w}/d/${latestDraftId}`); },
  }, `動きの変更 ${n}`);
}

// トラックのページの上に出す知らせ（同じトラックのどの稿に送られたものも）
export function DraftMovesBar(w, d, draft, openFig, makeFig) {
  const list = movesOf().filter((m) => m.draftId === d || (draft && m.trackId === draft.trackId)).sort(byTs);
  if (!list.length) return null;
  const ix = workIndex(S.d.work);
  const diagrams = S.d.diagrams || [];
  return h('details', { class: 'mv-bar', open: true },
    h('summary', null, h('strong', null, `練習で送られてきた動きの変更 ${list.length}件`),
      h('span', { class: 'muted small' }, '　「図で見る」から、図の編集でそのまま反映できます')),
    h('ul', { class: 'mv-items' }, list.map((m) => {
      const here = m.draftId === d;
      const g = here && m.gid ? diagrams.find((x) => x.id === m.gid) : null;
      const base = here && !m.gid && m.base ? diagrams.find((x) => x.id === m.base) : null;
      const ref = g || base;
      const names = Object.keys(m.moves || {}).map((id) => personLabel(ref && ref.shapes && ref.shapes[id], ix));
      const noteOnly = here && !g && !(base && names.length);
      return h('li', { key: m.id },
        h('div', { class: 'mv-item-main' },
          h('div', { class: 'small muted' }, `${fmtTime(m.ts)}　${senderLabel(m, ix)}`, m.cue ? `　《${m.cue}》` : ''),
          names.length ? h('div', null, names.join('・'), ' の位置') : null,
          m.base && !m.gid ? h('div', { class: 'small muted' }, 'このタイミングには図がなく、前の図をもとに動かしています') : null,
        m.note ? h('div', { class: 'mv-quote' }, m.note) : null),
        h('div', { class: 'mv-item-btns' },
          !here ? h('button', { class: 'btn small', onclick: () => go(`#/w/${w}/d/${m.draftId}`) }, '送られた稿を開く')
            : g ? h('button', { class: 'btn small primary', onclick: () => openFig(m.gid) }, '図で見る')
              : base && names.length ? h('button', { class: 'btn small primary', title: '前の図を写して、動いた人を新しい位置にした図を、このタイミングに足します', onclick: async () => { if (await makeFig(m, base)) closeMove(w, m, 'done'); } }, 'このタイミングに図を作る') : null,
          h('button', { class: 'btn small', onclick: () => closeMove(w, m, noteOnly ? 'done' : 'skip') }, noteOnly ? '済みにする' : '見送る')));
    })));
}

// 図の編集：この図への変更の候補（右の欄のいちばん上）
export function EditorMovesSection(w, gid, shapes, ix, apply) {
  const list = movesOf().filter((m) => m.gid === gid).sort(byTs);
  if (!list.length) return null;
  return h('section', { class: 'mv-ed' },
    h('h3', null, `動きの変更 ${list.length}件`),
    h('p', { class: 'small muted' }, 'オレンジの円が、送られてきた新しい位置です。「あとの図にも反映」をオンにすると、あとの図も同じように動きます。'),
    list.map((m) => {
      const ids = Object.keys(m.moves || {});
      const gone = ids.filter((id) => !shapes[id]);
      return h('div', { key: m.id, class: 'mv-ed-item' },
        h('div', { class: 'small muted' }, `${fmtTime(m.ts)}　${senderLabel(m, ix)}`),
        ids.length ? h('div', null, ids.map((id) => personLabel(shapes[id], ix)).join('・'), ' の位置') : null,
        m.note ? h('div', { class: 'mv-quote' }, m.note) : null,
        gone.length ? h('div', { class: 'small mv-warn' }, `${gone.length}人は、この図からもう消えています`) : null,
        h('div', { class: 'mv-actions' },
          ids.length > gone.length ? h('button', { class: 'btn small primary', onclick: () => { if (apply(m.moves)) closeMove(w, m, 'done'); } }, '反映する') : null,
          h('button', { class: 'btn small', onclick: () => closeMove(w, m, ids.length ? 'skip' : 'done') }, ids.length ? '見送る' : '済みにする')));
    }));
}

// 図の編集：送られてきた新しい位置（オレンジの円と点線）
export function EditorMovesLayer(gid, shapes, upx) {
  const out = [];
  for (const m of movesOf()) {
    if (m.gid !== gid) continue;
    for (const [id, p] of Object.entries(m.moves || {})) {
      const s = shapes[id];
      if (!s) continue;
      if (Math.hypot(s.x - p.x, s.y - p.y) < 3) continue;
      out.push(h('line', { key: m.id + id + 'l', x1: s.x, y1: s.y, x2: p.x, y2: p.y, class: 'mv-line', 'stroke-width': 2.5 / upx, 'stroke-dasharray': `${7 / upx} ${5 / upx}` }));
      out.push(h('circle', { key: m.id + id + 'c', cx: p.x, cy: p.y, r: s.r || 20, class: 'mv-target', 'stroke-width': 2.5 / upx }));
    }
  }
  return h('g', { class: 'mv-layer', 'pointer-events': 'none' }, out);
}
