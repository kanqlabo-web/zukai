// 音声（トラックの音声ファイルを読み込み、閲覧モードで流しながら、タイミングに合わせて図を自動で送る）
// ベータ版の機能（beta.js）。オンにした端末だけに出す。
//
// データ：
//   tracks/{t}.audio = { id, name, type, size, dur（秒）, parts（分けた数。デモモードでは 0）, by, ts }
//   works/{w}/audio/{id}_{n} = { aid, n, data }（音声の中身を 700KB ずつ base64 にしたもの。Firestore の1件は 1MB まで）
//   blocks/{b}.sec = そのタイミングが始まる、音声の中の位置（秒）。稿を複製するとそのまま付いていく
// 一度読んだ音声は、この端末の IndexedDB（zukai-audio）に置き、次からはサーバーから読まない。
// 音声の読み込み・外す（中身とトラックの audio）は元に戻すの履歴に入れない（中身が大きく、戻すと中身のない音声が残るため）。sec は履歴に入る。
import { h } from './vdom.js';
import { db, newId, mode, DEL } from './db.js';
import { S, rerender, toast, pickFile } from './state.js';
import { P } from './model.js';
import { canEdit } from './access.js';
import { betaOn } from './beta.js';
import { openContextMenu, ContextMenu } from './menubar.js';
import { confirmBox } from './dialog.js';

const PART = 700 * 1024;
const MAX = 20 * 1024 * 1024;

// ---------- この端末の控え（IndexedDB） ----------
let dbp = null;
function idb() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('zukai-audio', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('a');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function cacheOp(mode, fn) {
  try {
    const d = await idb();
    return await new Promise((res) => {
      const q = fn(d.transaction('a', mode).objectStore('a'));
      q.onsuccess = () => res(q.result == null ? null : q.result);
      q.onerror = () => res(null);
    });
  } catch (e) { return null; }
}
const cacheGet = (id) => cacheOp('readonly', (st) => st.get(id));
const cachePut = (id, v) => cacheOp('readwrite', (st) => st.put(v, id));
const cacheDel = (id) => cacheOp('readwrite', (st) => st.delete(id));

// ---------- 読み書き ----------
const toB64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
function fromB64(s) {
  const bin = atob(s);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
const partPath = (w, id, n) => P.doc(w, 'audio', `${id}_${n}`);

// 再生できる形式か確かめ、長さ（秒）を返す
function probe(file) {
  return new Promise((res) => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    const done = (v) => { URL.revokeObjectURL(url); res(v); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(-1);
    a.src = url;
  });
}

async function importAudio(w, track) {
  const file = await pickFile('audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.webm,.flac');
  if (!file) return;
  if (file.size > MAX) {
    toast(`音声が大きすぎます（${(file.size / 1048576).toFixed(1)}MB）。20MB までにしてください。WAV は MP3 や M4A に変えると小さくなります。`, 'error', 7000);
    return;
  }
  const dur = await probe(file);
  if (dur < 0) { toast('この形式の音声は、このブラウザでは再生できません。MP3 か M4A にしてください。', 'error', 6000); return; }
  const id = newId();
  const old = track.audio;
  const local = mode !== 'firebase';
  const parts = local ? 0 : Math.ceil(file.size / PART);
  A.saving = { name: file.name, done: 0, of: parts };
  rerender();
  try {
    const buf = await file.arrayBuffer();
    await cachePut(id, { type: file.type, buf });
    for (let n = 0; n < parts; n++) {
      const data = await toB64(file.slice(n * PART, (n + 1) * PART));
      await db.setQuiet(partPath(w, id, n), { aid: id, n, data });
      A.saving.done = n + 1;
      rerender();
    }
    const meta = { id, name: file.name, type: file.type || '', size: file.size, dur, parts, by: (S.user && S.user.name) || '', ts: Date.now() };
    await db.updateQuiet(P.doc(w, 'tracks', track.id), { audio: meta });
    track.audio = meta;
    if (old) dropParts(w, old);
    toast(local ? '音声を読み込みました（デモモードでは、この端末だけに保存します）' : '音声を読み込みました');
  } catch (e) {
    console.error(e);
    toast('音声を保存できませんでした：' + (e.message || e), 'error', 6000);
    for (let n = 0; n < parts; n++) db.removeQuiet(partPath(w, id, n)).catch(() => {});
  } finally {
    A.saving = null;
    rerender();
  }
}

function dropParts(w, meta) {
  for (let n = 0; n < (meta.parts || 0); n++) db.removeQuiet(partPath(w, meta.id, n)).catch(() => {});
  cacheDel(meta.id);
}

async function removeAudio(w, track) {
  const meta = track.audio;
  if (!meta) return;
  if (!(await confirmBox(`このトラックの音声「${meta.name}」を外しますか？`, { title: '音声を外す', ok: '外す', danger: true, detail: 'タイミングに付けた時刻は残ります。同じ音声を読み込み直せば、そのまま使えます。' }))) return;
  await db.updateQuiet(P.doc(w, 'tracks', track.id), { audio: DEL });
  track.audio = null;
  if (A.aid === meta.id) unload();
  dropParts(w, meta);
  rerender();
}

// 音声の中身を Blob にする（控えになければサーバーから読む）
async function loadBlob(w, meta) {
  const c = await cacheGet(meta.id);
  if (c) return new Blob([c.buf], { type: c.type || meta.type });
  if (!meta.parts) throw new Error('この音声は、読み込んだ端末にしかありません（デモモード）');
  const docs = await Promise.all(Array.from({ length: meta.parts }, (_, n) => db.get(partPath(w, meta.id, n))));
  if (docs.some((d) => !d || !d.data)) throw new Error('音声の一部が見つかりません。読み込み直してください');
  const blob = new Blob(docs.map((d) => fromB64(d.data)), { type: meta.type || 'audio/mpeg' });
  cachePut(meta.id, { type: blob.type, buf: await blob.arrayBuffer() });
  return blob;
}

// ---------- 再生 ----------
// ti：閲覧モードのどのトラック（targets の番号）の音声か。lastAuto：最後に音声に合わせて出したタイミング
const A = { el: null, url: '', aid: '', ti: -1, loading: false, err: '', playing: false, sync: false, lastAuto: '', saving: null, raf: 0, show: null };

function audioEl() {
  if (A.el) return A.el;
  const el = new Audio();
  el.preload = 'auto';
  el.addEventListener('play', () => { A.playing = true; loop(); rerender(); });
  el.addEventListener('pause', () => { A.playing = false; rerender(); });
  el.addEventListener('ended', onEnded);
  A.el = el;
  return el;
}
function unload() {
  if (A.el) { A.el.pause(); A.el.removeAttribute('src'); A.el.load(); }
  if (A.url) URL.revokeObjectURL(A.url);
  Object.assign(A, { url: '', aid: '', ti: -1, err: '', playing: false, lastAuto: '' });
}

// そのトラックの音声を用意する（すでに用意してあれば何もしない）
async function ensure(w, ti, meta) {
  if (!meta) { if (A.aid) unload(); A.ti = ti; return false; }
  if (A.aid === meta.id) { A.ti = ti; return true; }
  unload();
  Object.assign(A, { aid: meta.id, ti, loading: true, err: '' });
  rerender();
  try {
    const blob = await loadBlob(w, meta);
    if (A.aid !== meta.id) return false;
    A.url = URL.createObjectURL(blob);
    const el = audioEl();
    el.src = A.url;
    await new Promise((res) => { el.onloadedmetadata = res; el.onerror = res; });
    return A.aid === meta.id;
  } catch (e) {
    if (A.aid === meta.id) A.err = e.message || String(e);
    return false;
  } finally {
    if (A.aid === meta.id) A.loading = false;
    rerender();
  }
}

const fmt = (t) => {
  if (t == null || !isFinite(t)) return '--:--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
};
const fmtShort = (t) => fmt(t).replace(/\.\d$/, '');

// 閲覧モードの並び（show.js）から、このトラックの、時刻のあるタイミングの最初の1枚
function timedSteps(ti) {
  const out = [];
  const seen = new Set();
  A.show.steps().forEach((s, i) => {
    if (s.ti !== ti || !s.b || seen.has(s.b.id)) return;
    seen.add(s.b.id);
    if (s.b.sec != null) out.push({ i, b: s.b, sec: s.b.sec });
  });
  return out.sort((a, b) => a.sec - b.sec);
}
function targetAt(ti, t) {
  let best = null;
  for (const x of timedSteps(ti)) if (x.sec <= t + 0.05) best = x;
  return best;
}

// 再生中：時刻の表示を動かし、タイミングが来たら図を送る（画面全体は描き直さない）
function loop() {
  cancelAnimationFrame(A.raf);
  const tick = () => {
    if (!A.el || !A.playing) return;
    if (S.route.name !== 'show') { A.el.pause(); return; }
    paintTime();
    if (!A.sync && A.show) {
      const x = targetAt(A.ti, A.el.currentTime);
      if (x && x.b.id !== A.lastAuto) {
        A.lastAuto = x.b.id;
        const cur = A.show.steps()[A.show.cur()];
        if (!cur || cur.b !== x.b) A.show.goTo(x.i, true);
      }
    }
    A.raf = requestAnimationFrame(tick);
  };
  A.raf = requestAnimationFrame(tick);
}
function paintTime() {
  const el = A.el;
  if (!el) return;
  const t = el.currentTime, d = el.duration;
  const tx = document.querySelector('.au-time');
  if (tx) tx.textContent = `${fmt(t)} / ${fmtShort(d)}`;
  const k = document.querySelector('.au-done');
  if (k && isFinite(d) && d > 0) k.style.width = (100 * t / d) + '%';
  const now = document.querySelector('.au-now');
  if (now) now.textContent = fmt(t);
}

// 音声が終わったら、次のトラックに音声があれば続けて流す（話の閲覧モード）
async function onEnded() {
  A.playing = false;
  const data = S.d.print;
  if (!data || A.sync || !A.show) { rerender(); return; }
  const ti = A.ti + 1;
  const t = data.targets[ti];
  if (!t || !(t.track && t.track.audio)) { rerender(); return; }
  const i = A.show.steps().findIndex((s) => s.ti === ti);
  if (i >= 0) A.show.goTo(i, true);
  if (await ensure(data.w, ti, t.track.audio)) { A.lastAuto = ''; A.el.currentTime = 0; A.el.play().catch(() => {}); }
}

async function togglePlay(data, t, s) {
  const el = audioEl();
  if (A.playing) { el.pause(); return; }
  if (!(await ensure(data.w, s.ti, t.track && t.track.audio))) return;
  // 止めていた位置がいまのタイミングより前・後ろなら、いまのタイミングから
  if (s.b && s.b.sec != null && !A.sync) {
    const x = targetAt(s.ti, el.currentTime);
    if (!x || x.b !== s.b) el.currentTime = s.b.sec;
  }
  A.lastAuto = (targetAt(s.ti, el.currentTime) || {}).b?.id || '';
  if (el.ended) el.currentTime = 0;
  el.play().catch((e) => { A.err = '再生できませんでした：' + (e.message || e); rerender(); });
}

// 閲覧モードで、手で別の図に移ったとき（show.js から呼ぶ）
export function audioOnNav(s) {
  if (!betaOn() || !A.el || !A.aid || !s) return;
  const data = S.d.print;
  if (!data) return;
  if (s.ti !== A.ti) {
    const was = A.playing;
    const meta = data.targets[s.ti] && data.targets[s.ti].track && data.targets[s.ti].track.audio;
    A.el.pause();
    ensure(data.w, s.ti, meta).then((ok) => {
      if (!ok) return;
      A.el.currentTime = s.b && s.b.sec != null ? s.b.sec : 0;
      A.lastAuto = s.b ? s.b.id : '';
      if (was) A.el.play().catch(() => {});
    });
    return;
  }
  // 時刻を合わせているときは、押し直せるように少し前から
  if (A.sync) { if (s.b && s.b.sec != null) { A.el.currentTime = Math.max(0, s.b.sec - 3); paintTime(); } return; }
  if (s.b && s.b.sec != null) { A.el.currentTime = s.b.sec; A.lastAuto = s.b.id; paintTime(); }
  else { const x = targetAt(A.ti, A.el.currentTime); A.lastAuto = x ? x.b.id : ''; }
}

// ---------- 時刻を合わせる ----------
async function setSec(data, b, sec) {
  const v = sec == null ? null : Math.max(0, Math.round(sec * 10) / 10);
  b.sec = v == null ? undefined : v;
  if (v == null) delete b.sec;
  rerender();
  try { await db.update(P.doc(data.w, 'blocks', b.id), { sec: v == null ? DEL : v }); } catch (e) { toast('時刻を保存できませんでした', 'error'); }
}
// いま表示しているタイミングを今の時刻にして、次のタイミングへ
function markNow(data, s) {
  if (!A.el || !s.b) return;
  setSec(data, s.b, A.el.currentTime);
  const list = A.show.steps();
  for (let i = A.show.cur() + 1; i < list.length; i++) {
    if (list[i].ti !== s.ti) break;
    if (list[i].b && list[i].b !== s.b) { A.show.goTo(i, true); return; }
  }
}
export const audioSyncing = () => betaOn() && A.sync;
export function audioKey(e) {
  if (!betaOn() || !A.aid || !A.show) return false;
  const data = S.d.print;
  const s = data && A.show.steps()[A.show.cur()];
  if (!s) return false;
  if (A.sync && e.key === 'Enter') { markNow(data, s); return true; }
  if (e.key === 'k' || e.key === 'K') { togglePlay(data, data.targets[s.ti], s); return true; }
  return false;
}

window.addEventListener('hashchange', () => { if (A.el && !/\/show\//.test(location.hash)) A.el.pause(); });

// ---------- 閲覧モードの欄 ----------
// show：{ steps(), cur(), goTo(i, auto) }（show.js の並びと移動）
const playIcon = (on) => h('svg', { class: 'ico', viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true', fill: 'currentColor' },
  h('path', { d: on ? 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z' : 'M8 5l11 7-11 7z' }));

export function ShowAudioBar(data, t, s, show) {
  if (!betaOn()) return null;
  A.show = show;
  const meta = t.track && t.track.audio;
  const editor = canEdit(data.work);
  if (A.saving) {
    return h('div', { class: 'show-audio' }, h('span', { class: 'au-msg' },
      A.saving.of ? `音声を保存しています… ${A.saving.done} / ${A.saving.of}` : '音声を保存しています…'));
  }
  if (!meta) {
    if (A.aid && A.ti === s.ti) unload();
    if (!editor || !t.track) return null;
    return h('div', { class: 'show-audio' },
      h('button', { class: 'btn', title: 'このトラックの音声（CD など）を読み込み、タイミングに合わせて図を自動で送ります', onclick: () => importAudio(data.w, t.track) }, playIcon(false), '音声を読み込む'),
      h('span', { class: 'au-msg muted' }, 'ベータ版'));
  }
  const ready = A.aid === meta.id && !A.loading && !A.err;
  const el = A.el;
  const dur = (ready && el && isFinite(el.duration) ? el.duration : meta.dur) || 0;
  const cur = ready && el ? el.currentTime : 0;
  const timed = timedSteps(s.ti);
  const seek = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const v = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur;
    ensure(data.w, s.ti, meta).then((ok) => {
      if (!ok) return;
      A.el.currentTime = v;
      const x = targetAt(s.ti, v);
      A.lastAuto = x ? x.b.id : '';
      if (x && !A.sync) show.goTo(x.i, true);
      paintTime();
    });
  };
  const menu = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    openContextMenu(r.left, r.bottom + 4, [
      { label: '時刻を合わせる', checked: A.sync, hint: '音声を流しながら、タイミングが来たところで押して時刻を付けます', onclick: () => { A.sync = !A.sync; rerender(); } },
      '-',
      { label: '音声を差し替える', onclick: () => importAudio(data.w, t.track) },
      { label: 'このトラックの音声を外す', onclick: () => removeAudio(data.w, t.track) },
    ], rerender);
  };
  const missing = timed.length === 0;
  return h('div', { class: 'show-audio' + (A.sync ? ' is-sync' : '') },
    h('div', { class: 'au-row' },
      h('button', { class: 'btn au-play', title: A.playing ? '止める（K）' : '流す（K）', disabled: A.loading, onclick: () => togglePlay(data, t, s) }, playIcon(A.playing)),
      h('span', { class: 'au-time' }, A.loading ? '読み込み中…' : `${fmt(cur)} / ${fmtShort(dur)}`),
      h('div', { class: 'au-bar', title: '押した位置から', onpointerdown: seek },
        h('div', { class: 'au-done', style: { width: dur ? (100 * cur / dur) + '%' : '0%' } }),
        timed.map((x) => h('span', { key: x.b.id, class: 'au-tick' + (s.b === x.b ? ' cur' : ''), style: { left: dur ? (100 * x.sec / dur) + '%' : '0%' }, title: `${fmt(x.sec)} ${x.b.cue || ''}` }))),
      editor ? h('button', { class: 'btn au-menu', title: '音声のメニュー', onclick: menu }, '音声') : null),
    A.err ? h('div', { class: 'au-msg err' }, A.err) : null,
    !A.sync && missing && !A.err ? h('div', { class: 'au-msg muted' }, editor
      ? 'タイミングに時刻がまだありません。「音声」から「時刻を合わせる」で付けると、流したときに図が自動で進みます。'
      : 'タイミングに時刻がまだ付いていません。流すことはできますが、図は自動では進みません。') : null,
    A.sync && editor ? SyncRow(data, s) : null,
    ContextMenu());
}

function SyncRow(data, s) {
  const b = s.b;
  return h('div', { class: 'au-sync' },
    h('div', { class: 'au-sync-what' },
      b ? h('span', null, '次に合わせる：', h('b', null, b.cue ? `《${b.cue}》` : '（語句なし）'),
        h('span', { class: 'muted' }, b.sec != null ? `　いまの時刻 ${fmt(b.sec)}` : '　時刻なし'))
        : h('span', { class: 'muted' }, 'タイミングがありません')),
    h('div', { class: 'au-sync-btns' },
      h('button', { class: 'btn primary au-mark', disabled: !b || !A.aid || A.loading, title: '流しながら、このタイミングが来たところで押します（Enter）', onclick: () => markNow(data, s) },
        'ここ ', h('span', { class: 'au-now' }, fmt(A.el ? A.el.currentTime : 0))),
      h('button', { class: 'btn', disabled: !b || b.sec == null, title: '0.5秒早く', onclick: () => setSec(data, b, b.sec - 0.5) }, '−0.5秒'),
      h('button', { class: 'btn', disabled: !b || b.sec == null, title: '0.5秒遅く', onclick: () => setSec(data, b, b.sec + 0.5) }, '＋0.5秒'),
      h('button', { class: 'btn', disabled: !b || b.sec == null, title: 'このタイミングの時刻を消す', onclick: () => setSec(data, b, null) }, '時刻を消す'),
      h('button', { class: 'btn', onclick: () => { A.sync = false; rerender(); } }, '終わる')),
    h('p', { class: 'au-hint muted' }, '音声を流し、上のタイミングの語句が聞こえたところで「ここ」（Enter）を押すと、時刻が付いて次のタイミングに進みます。ずれたら図を戻して押し直すか、±0.5秒で直してください。'));
}
