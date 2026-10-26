// 音声（トラックの音声ファイルを読み込み、閲覧モードで流しながら、タイミングに合わせて図を自動で送る）
// ベータ版の機能（beta.js）。オンにした端末だけに出す。
//
// データ：
//   tracks/{t}.audio = { id, name, type, size, dur（秒）, parts（分けた数。デモモードでは 0）, by, ts, shared（話のトラックで共有） }
//     1話まるごとの音源は、話のトラックすべてに同じ audio（同じ id）を付ける。時刻は話の音声の中の位置で、トラックをまたいで流れる
//   works/{w}/audio/{id}_heard = { langs, out }（自動で合わせるときに聞き取った文字。トラックごとに聞き取り直さないように）
//   聞き取りの途中の分は、この端末の IndexedDB の {id}_partial = { langs, upto, out } に30秒ごとに置き、止まっても続きから始める
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
import { openContextMenu } from './menubar.js';
import { confirmBox, ask } from './dialog.js';
import { sortBlocks, resolveAnchor } from './script.js';
import { langsOf, matchTimes, pausesOf, segmentsOf, toMono16k } from './autosync.js';

const PART = 700 * 1024;
const MAX = 80 * 1024 * 1024; // 1話まるごとの音源も入るように

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
    toast(`音声が大きすぎます（${(file.size / 1048576).toFixed(1)}MB）。80MB までにしてください。WAV は MP3 や M4A に、長い音源は 64kbps くらいの MP3 にすると小さくなります。`, 'error', 8000);
    return;
  }
  const dur = await probe(file);
  if (dur < 0) { toast('この形式の音声は、このブラウザでは再生できません。MP3 か M4A にしてください。', 'error', 6000); return; }
  // 同じ話のほかのトラックでも使うか（1話まるごとの音源）
  let tracks = [track];
  const sibs = track.episodeId ? (await db.list(P.col(w, 'tracks'), ['episodeId', track.episodeId])).filter((x) => x.id !== track.id) : [];
  if (sibs.length) {
    const one = ['one', 'このトラックだけ'], all = ['all', `この話のトラックすべて（${sibs.length + 1}トラック）`];
    const r = await ask({
      title: '音声を読み込む',
      message: `「${file.name}」（${fmtShort(dur)}）を、どのトラックで使いますか？`,
      detail: '1話まるごとの音源なら「この話のトラックすべて」を選びます。タイミングの時刻は話の音声の中の位置になり、話の閲覧モードではトラックをまたいで流れます。',
      fields: [],
      choices: dur > 12 * 60 ? [one, all] : [all, one], // 長い音声なら「すべて」をおすすめ（最後のボタンが主）
    });
    if (!r) return;
    if (r.choice === 'all') tracks = [track, ...sibs];
  }
  const id = newId();
  const olds = tracks.map((x) => x.audio).filter(Boolean);
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
    const meta = { id, name: file.name, type: file.type || '', size: file.size, dur, parts, by: (S.user && S.user.name) || '', ts: Date.now(), shared: tracks.length > 1 };
    for (const x of tracks) await db.updateQuiet(P.doc(w, 'tracks', x.id), { audio: meta });
    setLocalMeta(tracks.map((x) => x.id), meta);
    for (const o of olds) dropIfUnused(w, o);
    toast((tracks.length > 1 ? `${tracks.length}トラックで使う音声を読み込みました` : '音声を読み込みました') + (local ? '（デモモードでは、この端末だけに保存します）' : ''));
  } catch (e) {
    console.error(e);
    toast('音声を保存できませんでした：' + (e.message || e), 'error', 6000);
    for (let n = 0; n < parts; n++) db.removeQuiet(partPath(w, id, n)).catch(() => {});
  } finally {
    A.saving = null;
    rerender();
  }
}

// 閲覧モードが持っているトラックにも反映する
function setLocalMeta(ids, meta) {
  const data = S.d.print;
  if (data) for (const t of data.targets) if (t.track && ids.includes(t.track.id)) t.track.audio = meta;
}
// どのトラックも使わなくなった音声の中身を消す
async function dropIfUnused(w, meta) {
  const all = await db.list(P.col(w, 'tracks'));
  if (all.some((x) => x.audio && x.audio.id === meta.id)) return;
  dropParts(w, meta);
}

function dropParts(w, meta) {
  for (let n = 0; n < (meta.parts || 0); n++) db.removeQuiet(partPath(w, meta.id, n)).catch(() => {});
  db.removeQuiet(P.doc(w, 'audio', meta.id + '_heard')).catch(() => {});
  cacheDel(meta.id);
  cacheDel(meta.id + '_heard');
  cacheDel(meta.id + '_partial');
}

async function removeAudio(w, track) {
  const meta = track.audio;
  if (!meta) return;
  const users = (await db.list(P.col(w, 'tracks'))).filter((x) => x.audio && x.audio.id === meta.id);
  const detail = 'タイミングに付けた時刻は残ります。同じ音声を読み込み直せば、そのまま使えます。';
  let tracks = [track];
  if (users.length > 1) {
    const r = await ask({ title: '音声を外す', message: `音声「${meta.name}」は ${users.length}トラックで使っています。`, detail, fields: [],
      choices: [['one', 'このトラックだけ外す'], ['all', `${users.length}トラックすべてから外す`]] });
    if (!r) return;
    if (r.choice === 'all') tracks = users;
  } else if (!(await confirmBox(`このトラックの音声「${meta.name}」を外しますか？`, { title: '音声を外す', ok: '外す', danger: true, detail }))) return;
  for (const x of tracks) await db.updateQuiet(P.doc(w, 'tracks', x.id), { audio: DEL });
  setLocalMeta(tracks.map((x) => x.id), null);
  if (A.aid === meta.id && tracks.length === users.length) unload();
  dropIfUnused(w, meta);
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
const A = { el: null, url: '', aid: '', ti: -1, loading: false, err: '', playing: false, sync: false, lastAuto: '', saving: null, raf: 0, show: null, auto: null };

function audioEl() {
  if (A.el) return A.el;
  const el = new Audio();
  el.preload = 'auto';
  el.addEventListener('play', () => { A.playing = true; loop(); rerender(); });
  el.addEventListener('pause', () => { A.playing = false; clearLyric(); rerender(); });
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
    loadHeard(w, meta);
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

// そのトラックの音声の id（1話まるごとの音源なら、話のトラックで同じ）
function aidOf(ti) {
  const t = S.d.print && S.d.print.targets[ti];
  return t && t.track && t.track.audio ? t.track.audio.id : '';
}
// 閲覧モードの並び（show.js）から、同じ音声を使うトラックの、時刻のあるタイミングの最初の1枚
function timedSteps(ti) {
  const out = [];
  const seen = new Set();
  const aid = aidOf(ti);
  A.show.steps().forEach((s, i) => {
    if (!s.b || seen.has(s.b.id) || (s.ti !== ti && (!aid || aidOf(s.ti) !== aid))) return;
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
    if (!A.sync) paintLyric(A.el.currentTime);
    if (!A.sync && A.show) {
      const x = targetAt(A.ti, A.el.currentTime);
      if (x && x.b.id !== A.lastAuto) {
        A.lastAuto = x.b.id;
        A.ti = A.show.steps()[x.i].ti; // 1話まるごとの音源では、次のトラックに移る
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
  let ti = A.ti + 1;
  while (data.targets[ti] && aidOf(ti) === A.aid) ti++; // 同じ音声のトラックはもう流れた
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
  if (s.ti !== A.ti && aidOf(s.ti) === A.aid) A.ti = s.ti;
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

// ---------- 歌詞のように流れるテマ友 ----------
// 流している間、テマ友のいまの行を目立たせ、画面の上から3分の1あたりに来るように流す。
// 行の時刻は、聞き取った文字があればそれと照らし合わせて、なければタイミングの時刻のあいだを文字数で割り振って決める。
const heardMem = {}; // 音声の id → 聞き取った文字（なければ null）
// 聞き取りの形の版。2：単語ごとの時刻（2.42.0〜）。古い版（文ごとの時刻）は自動で合わせるときに聞き取り直す（テマ友の流れには使う）
const HEARD_V = 2;
// 聞き取りのしかた（2.47.0〜）。英日のテマ友は、Whisper tiny で声のまとまりごとに英語か日本語かだけを判定する（速い）。
// 1つの言語だけのテマ友は、Whisper base で文字にする。記録にはどのしかたかを残し、違うしかたの分は自動で合わせるときに聞き直す
const ASR_MODEL = 'Xenova/whisper-base', LID_MODEL = 'Xenova/whisper-tiny';
const useLid = (langs) => langs.length > 1;
const asrModel = (langs) => {
  const cfg = window.ZUKAI_ASR || {};
  return useLid(langs) ? 'lid:' + (cfg.lidModel || LID_MODEL) : cfg.model || ASR_MODEL;
};
const heardOk = (r, langs) => r && r.langs === langs.join(',') && r.v === HEARD_V && (r.model || 'Xenova/whisper-base') === asrModel(langs);
async function loadHeard(w, meta) {
  if (heardMem[meta.id] !== undefined) return;
  heardMem[meta.id] = null;
  const c = await cacheGet(meta.id + '_heard');
  if (c) { heardMem[meta.id] = c.out; return; }
  if (!meta.parts) return;
  const d = await db.getQuiet(P.doc(w, 'audio', meta.id + '_heard'));
  if (d && d.out) { heardMem[meta.id] = d.out; cachePut(meta.id + '_heard', d); }
}

let lyricCache = { key: '', times: [] };
function lineTimes(t, starts) {
  const text = t.draft.script || '';
  const blocks = (t.blocks || []).filter((b) => b.sec != null);
  const heard = heardMem[t.track.audio.id];
  const key = [t.draft.id, text.length, starts.join(','), blocks.map((b) => b.id + b.sec).join(','), heard ? 'h' : ''].join('|');
  if (lyricCache.key === key) return lyricCache.times;
  // タイミングの時刻（手で直したものを含む）を決まった点にし、そのあいだの行を割り振る。
  // 聞き取った文字があれば、行の時刻の「間隔」をそれで決める（なければ文字数で）
  const pts = blocks.map((b) => ({ off: resolveAnchor(text, b.anchor).offset, t: b.sec })).sort((a, b) => a.off - b.off);
  const est = heard ? matchTimes(text, heard, [...starts, ...pts.map((p) => p.off)]).secs : null;
  const hOf = (k) => (est ? est[k] : null); // starts[k] の聞き取りの時刻
  pts.forEach((p, i) => { p.h = est ? est[starts.length + i] : null; });
  const rate = pts.length > 1 ? (pts[pts.length - 1].t - pts[0].t) / Math.max(1, pts[pts.length - 1].off - pts[0].off) : 0.12;
  const times = starts.map((o, k) => {
    const h0 = hOf(k);
    if (!pts.length) return h0;
    let j = 0;
    while (j < pts.length && pts[j].off <= o) j++;
    const p0 = pts[j - 1], p1 = pts[j];
    if (h0 != null) {
      if (p0 && p1 && p0.h != null && p1.h != null && p1.h > p0.h) return p0.t + (p1.t - p0.t) * Math.min(1, Math.max(0, (h0 - p0.h) / (p1.h - p0.h)));
      if (p0 && !p1 && p0.h != null) return p0.t + Math.max(0, h0 - p0.h);
      if (!p0 && p1 && p1.h != null) return Math.max(0, p1.t - Math.max(0, p1.h - h0));
    }
    if (!p0) return null; // 最初のタイミングより前は分からない
    if (!p1) return p0.t + (o - p0.off) * rate;
    return p0.t + (p1.t - p0.t) * (o - p0.off) / (p1.off - p0.off);
  });
  lyricCache = { key, times };
  return times;
}

let userScroll = 0;
for (const ev of ['wheel', 'touchstart']) document.addEventListener(ev, (e) => { if (e.target.closest && e.target.closest('.show-script')) userScroll = Date.now(); }, { passive: true });

// いま表示しているトラックの行（.sline の data-ls）と時刻
function shownLines() {
  const data = S.d.print;
  const s = A.show && data && A.show.steps()[A.show.cur()];
  const pane = document.querySelector('.show-script');
  if (!s || !pane || aidOf(s.ti) !== A.aid) return null;
  const els = [...pane.querySelectorAll('.sline[data-ls]')].filter((el) => !el.classList.contains('blank'));
  const t = data.targets[s.ti];
  return { pane, els, ti: s.ti, times: lineTimes(t, els.map((el) => +el.dataset.ls)) };
}
function paintLyric(now) {
  const L = shownLines();
  if (!L) return;
  let cur = -1;
  L.times.forEach((x, i) => { if (x != null && x <= now + 0.15) cur = i; });
  L.pane.classList.add('is-lyric');
  L.els.forEach((el, i) => {
    el.classList.toggle('sing', i === cur);
    el.classList.toggle('sung', cur >= 0 && i < cur);
  });
  const el = L.els[cur];
  if (el && A.lyricEl !== el) {
    A.lyricEl = el;
    if (Date.now() - userScroll > 5000) {
      const top = L.pane.scrollTop + el.getBoundingClientRect().top - L.pane.getBoundingClientRect().top - L.pane.clientHeight * 0.33;
      L.pane.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }
}
function clearLyric() {
  A.lyricEl = null;
  const pane = document.querySelector('.show-script.is-lyric');
  if (!pane) return;
  pane.classList.remove('is-lyric');
  pane.querySelectorAll('.sline.sing, .sline.sung').forEach((el) => el.classList.remove('sing', 'sung'));
}
// 流している間は、閲覧モードがテマ友を段の先頭へ動かさない（show.js の afterShow）
export const audioLyricOn = () => betaOn() && A.playing && !A.sync;
// テマ友の行を押したとき：音声があれば、その行の時刻から（show.js から呼ぶ。合わせたら true）
export function audioSeekLine(ti, ls) {
  if (!betaOn() || !A.el || !A.aid || A.sync || A.loading || aidOf(ti) !== A.aid) return false;
  const L = shownLines();
  if (!L || L.ti !== ti) return false;
  const i = L.els.findIndex((el) => +el.dataset.ls === ls);
  const t = L.times[i];
  if (i < 0 || t == null) return false;
  A.el.currentTime = Math.max(0, t - 0.3);
  const x = targetAt(ti, A.el.currentTime);
  A.lastAuto = x ? x.b.id : '';
  if (x) { A.ti = A.show.steps()[x.i].ti; A.show.goTo(x.i, true); }
  A.lyricEl = null;
  paintTime();
  if (A.playing) paintLyric(A.el.currentTime);
  return true;
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
    if (list[i].ti !== s.ti && aidOf(list[i].ti) !== A.aid) break;
    if (list[i].b && list[i].b !== s.b) { A.show.goTo(i, true); A.ti = list[i].ti; return; }
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
  if (A.auto) return h('div', { class: 'show-audio' }, AutoRow());
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
      { label: '時刻を自動で合わせる（ためし）', hint: '音声を聞き取って、テマ友と照らし合わせて時刻を付けます', onclick: () => autoSync(data, s.ti) },
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
    A.sync && editor ? SyncRow(data, s) : null);
}

// ---------- 時刻を自動で合わせる（asr-worker.js で聞き取り、autosync.js で照らし合わせる） ----------
async function autoSync(data, ti) {
  const meta = aidOf(ti) && data.targets[ti].track.audio;
  // 1話まるごとの音源なら、閲覧モードにある同じ音声のトラックをまとめて
  const group = data.targets.map((t, k) => ({ t, k })).filter(({ k }) => aidOf(k) === (meta && meta.id))
    .map(({ t }) => ({ t, text: t.draft.script || '', sorted: sortBlocks(t.draft.script || '', t.blocks || []) }))
    .filter((g) => g.text && g.sorted.length);
  if (!meta || !group.length) { toast('テマ友・タイミング・音声がそろっているときに使えます', 'error'); return; }
  const all = group.reduce((a, g) => a + g.sorted.length, 0);
  const has = group.reduce((a, g) => a + g.sorted.filter(({ b }) => b.sec != null).length, 0);
  const langs = langsOf(group.map((g) => g.text).join('\n'));
  const hkey = meta.id + '_heard';
  let heard = null;
  const c = await cacheGet(hkey);
  if (heardOk(c, langs)) heard = c.out;
  if (!heard && meta.parts) {
    const d = await db.getQuiet(P.doc(data.w, 'audio', hkey));
    if (heardOk(d, langs)) { heard = d.out; cachePut(hkey, d); }
  }
  const pkey = meta.id + '_partial';
  const p0 = heard ? null : await cacheGet(pkey);
  const partial = heardOk(p0, langs) ? p0 : null;
  const r = await ask({
    title: '時刻を自動で合わせる（ためし）',
    message: (useLid(langs) ? '音声をこの端末で聞き、テマ友と照らし合わせて、タイミングに時刻を付けます。' : '音声をこの端末で聞き取って文字にし、テマ友と照らし合わせて、タイミングに時刻を付けます。') + (group.length > 1 ? `（${group.length}トラック）` : ''),
    detail: heard ? 'この音声はもう聞き取ってあるので、すぐに終わります。付けたあと、ずれているところは「時刻を合わせる」で直してください。'
      : partial ? `前回の聞き取りの続き（${fmtShort(partial.at != null ? partial.at : partial.upto * 30)} まで済み）から始めます。この端末のこのページを開いたままにしてください（閉じても、次はまた続きから始めます）。`
      : useLid(langs) ? '声のまとまりごとに英語か日本語かを判定し、テマ友の英語の行・日本語の行と順番に対応させます。初めてのときは判定のしくみ（約40MB）を読み込みます（次からはいりません）。判定には、音声の長さの半分くらいかかることがあります。パソコンでの利用をおすすめします。判定した結果は保存するので、同じ音声のほかのトラックはすぐに終わります。付けたあと、ずれているところは「時刻を合わせる」で直してください。'
      : '初めてのときは聞き取りのしくみ（約80MB）を読み込みます（次からはいりません）。聞き取りには、音声の長さと同じくらいかそれ以上かかることがあります（1話まるごとの音源なら1時間以上）。パソコンでの利用をおすすめします。聞き取った文字は保存するので、同じ音声のほかのトラックはすぐに終わります。付けたあと、ずれているところは「時刻を合わせる」で直してください。',
    fields: [],
    choices: has ? [['missing', `時刻のないタイミングだけ（${all - has}件）`], ['all', `すべて付け直す（${all}件）`]] : [['all', '始める']],
  });
  if (!r) return;
  const only = r.choice === 'missing';
  if (A.playing) A.el.pause();
  A.auto = { phase: 'prep', p: 0, done: 0, of: 0, workers: [] };
  rerender();
  try {
    if (!heard) {
      const audio = await toMono16k(await loadBlob(data.w, meta), meta.name);
      if (!A.auto) return;
      // 声の間（聞き取りに渡すと audio が使えなくなるので先に）
      const pauses = pausesOf(audio), on = pauses.map((x) => x[1]);
      const segs = useLid(langs) ? segmentsOf(pauses, audio.length / 16000) : null;
      heard = await listen(audio, langs, segs, partial, (upto, out, at) => cachePut(pkey, { v: HEARD_V, model: asrModel(langs), langs: langs.join(','), upto, at, out }));
      heard = { ...heard, on };
      const rec = { v: HEARD_V, model: asrModel(langs), langs: langs.join(','), out: heard };
      cachePut(hkey, rec);
      cacheDel(pkey);
      if (meta.parts && JSON.stringify(rec).length < 900000) db.setQuiet(P.doc(data.w, 'audio', hkey), rec).catch(() => {});
    }
    A.auto.phase = 'match'; rerender();
    window.__zukaiHeard = heard; // 調べるとき用（コンソールで見られる）
    heardMem[meta.id] = heard;
    const ops = [];
    let found = 0;
    for (const g of group) {
      const m = matchTimes(g.text, heard, g.sorted.map(({ r: x }) => x.offset));
      found += m.found;
      g.sorted.forEach(({ b }, k) => {
        if (m.secs[k] == null || (only && b.sec != null)) return;
        b.sec = Math.max(0, Math.round(m.secs[k] * 10) / 10);
        ops.push({ op: 'update', path: P.doc(data.w, 'blocks', b.id), data: { sec: b.sec } });
      });
    }
    if (!ops.length) { toast('聞き取った文字がテマ友と合わず、時刻を付けられませんでした', 'error', 6000); return; }
    await db.batch(ops);
    toast(`${ops.length}件のタイミングに時刻を付けました（${found}件は${heard.lid ? "英日の切り替わり" : "テマ友の文字"}で見つけ、残りは前後から見積もりました）。流してずれていたら「時刻を合わせる」で直してください。`, 'info', 9000);
  } catch (e) {
    if (e && e.message !== 'cancel') { console.error(e); toast('自動で合わせられませんでした：' + (e.message || e), 'error', 7000); }
  } finally {
    A.auto = null;
    rerender();
  }
}
// asr-worker.js で聞き取る
// segs：言語を判定する区切り（英日のとき。なければ文字にする）。partial：前回の途中までの分。onWin(upto, out, at)：ときどき途中までの分を保存する（at：済んだところの秒）
function listen(audio, langs, segs, partial, onWin) {
  return segs ? listenLid(audio, segs, partial, onWin) : listenText(audio, langs, partial, onWin);
}
function asrWorker(rej) {
  const wk = new Worker(new URL('./asr-worker.js', import.meta.url), { type: 'module' });
  A.auto.workers = (A.auto.workers || []).concat(wk);
  A.auto.reject = rej;
  wk.onerror = (e) => { stopWorkers(); rej(new Error(e.message || '聞き取りを始められませんでした')); };
  return wk;
}
function stopWorkers() { if (A.auto) for (const w of A.auto.workers || []) w.terminate(); }
function asrOpts(langs) {
  const cfg = window.ZUKAI_ASR || {};
  return { model: asrModel(langs).replace(/^lid:/, ''), tjs: cfg.tjs, local: useLid(langs) ? cfg.lidLocal || cfg.local : cfg.local };
}
// 英日の判定：Worker をいくつか（端末のコア数に合わせて最大4つ）並べ、区切りを5つずつ配る
function listenLid(audio, segs, partial, onWin) {
  return new Promise((res, rej) => {
    const out = partial && partial.out && partial.out.lid ? partial.out.lid.slice() : [];
    let next = out.length, busy = 0, saved = out.length;
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    A.auto.phase = 'load';
    const step = () => {
      let k = 0; while (out[k]) k++;
      if (A.auto.phase !== 'listen') { A.auto.t0 = Date.now(); A.auto.d0 = k; }
      A.auto.phase = 'listen'; A.auto.done = k; A.auto.of = segs.length; rerender();
      if (k - saved >= 10 || (k === segs.length && k > saved)) { saved = k; onWin(k, { lid: out.slice(0, k) }, segs[k - 1].e); }
      return k;
    };
    const give = (wk) => {
      if (!A.auto) return;
      if (next >= segs.length) { if (!busy) { stopWorkers(); res({ lid: out }); } return; }
      const from = next;
      const batch = segs.slice(from, from + 5).map((g) => ({ ...g, pcm: audio.slice(Math.floor(g.s * 16000), Math.floor(g.e * 16000)) }));
      next += batch.length; busy++;
      wk.from = from;
      wk.postMessage({ batch, langs: ['en', 'ja'], ...asrOpts(['en', 'ja']) }, batch.map((g) => g.pcm.buffer));
    };
    // 1つめの Worker でモデルを読み終えてから（ブラウザに控えができてから）残りを始める
    let more = n - 1;
    const spawn = () => {
      const wk = asrWorker(rej);
      wk.onmessage = (e) => {
        const m = e.data;
        if (!A.auto) return;
        if (m.type === 'load') { if (A.auto.phase === 'load') { A.auto.p = m.p; rerender(); } }
        else if (m.type === 'lid') {
          m.out.forEach((x, j) => { out[wk.from + j] = x; });
          busy--; step(); give(wk);
          for (; more > 0 && next < segs.length; more--) spawn();
        }
        else if (m.type === 'error') { stopWorkers(); rej(new Error(m.msg)); }
      };
      give(wk);
    };
    spawn();
  });
}
function listenText(audio, langs, partial, onWin) {
  return new Promise((res, rej) => {
    const wk = asrWorker(rej);
    wk.onmessage = (e) => {
      const m = e.data;
      if (!A.auto) return;
      if (m.type === 'load') { A.auto.phase = 'load'; A.auto.p = m.p; rerender(); }
      else if (m.type === 'step') { if (A.auto.phase !== 'listen') { A.auto.t0 = Date.now(); A.auto.d0 = m.done; } A.auto.phase = 'listen'; A.auto.done = m.done; A.auto.of = m.of; rerender(); }
      else if (m.type === 'win') onWin(m.upto, m.out, m.upto * 30);
      else if (m.type === 'done') { stopWorkers(); res(m.out); }
      else if (m.type === 'error') { stopWorkers(); rej(new Error(m.msg)); }
    };
    wk.postMessage({ audio, langs, ...asrOpts(langs), from: partial ? partial.upto : 0, prev: partial ? partial.out : null }, [audio.buffer]);
  });
}
function cancelAuto() {
  if (!A.auto) return;
  stopWorkers();
  const rej = A.auto.reject;
  A.auto = null;
  if (rej) rej(new Error('cancel'));
  rerender();
}
function AutoRow() {
  const a = A.auto;
  const left = a.phase === 'listen' && a.of && a.done > a.d0 ? Math.round((Date.now() - a.t0) / (a.done - a.d0) * (a.of - a.done) / 60000) : null;
  const msg = a.phase === 'prep' ? '音声を準備しています…'
    : a.phase === 'load' ? `聞き取りのしくみを読み込んでいます… ${Math.round(a.p * 100)}%`
      : a.phase === 'listen' ? `聞き取っています… ${a.done} / ${a.of}` + (left != null ? `（あと${left < 1 ? '1分以内' : `約${left}分`}）` : '')
        : 'テマ友と照らし合わせています…';
  const p = a.phase === 'load' ? a.p : a.phase === 'listen' && a.of ? a.done / a.of : a.phase === 'match' ? 1 : 0;
  return h('div', { class: 'au-row' },
    h('span', { class: 'au-msg' }, msg),
    h('div', { class: 'au-bar' }, h('div', { class: 'au-done', style: { width: (p * 100) + '%' } })),
    h('button', { class: 'btn', onclick: cancelAuto }, 'やめる'));
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
