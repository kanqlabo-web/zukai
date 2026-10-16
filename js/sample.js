// 「見本の作品を作る」で使うデータ（いただいた図解PDFの2話トラ1・トラ2をもとにしています）
import { db, newId } from './db.js';
import { P } from './model.js';
import { LAYER } from './stage.js';

const CAST = `1 ぐっち（ビーヴァー奥さん）
2 まお（ルーシィ）
3 もえ
4 もありん（ユニコーン）
5 あいす
6 ぴのん（白い魔女）
7 りま（ナレ4話トラ5〜6）
8 ハルきのこさん（うさぎ）
9 そらり（キツネ）
10 みなみ（リス）
11 めめ
12 ゆうた
13 あんな
14 かれん
15 なっとう
16 ゆうり（ナレ2話トラ1〜3、3話トラ1〜3）
17 あんばー
18 りお（スーザン）
19 なな
20 りえ
21 いっちゃん
22 かよ
23 しゅーまい（エドマンド）
24 さちお（ビーヴァー）
25 くま
26 たっくん（ライオン）
27 きみお（白い魔女のドワーフ）
28 さくや（ピーター）
29 ジャス（木の精）
30 りゅう（ナレ4話トラ1〜4）
31 スノー（ナレ2話トラ4〜6）
32 あたご（タムナスさん）
33 おにぎり（教授）
34 しーし
35 けんと（ナレ3話トラ4〜5）
36 たいき（サンタクロース）
37 たつ（モーグリム）
38 かんQ
39 しゅう（ケンタウロス）
40 やっち
41 りょうと（アスラン）
CD ばにく`;

const TORA1 = `PETER: Lucy, I apologise for not believing you.
ピーター:ルーシィ、あの話、信じなかったこと、あやまるよ。
I'm sorry. Will you shake hands?
ごめんね、握手してくれる。

NARRATOR：For now there was no mistaking it, and all four children stood blinking in the daylight of a winter day, surrounded by snow- covered trees.
語り: ピーター, スーザン, エドマンド, ルーシィの4人のきょうだいは、いまはまぎれもなく雪の降り積もるナルニアの森のなかに立っていた。

SUSAN:Ugh! It's pretty cold.
スーザン: ううう 寒い。
What about putting on some of these coats?
このコートを借りない。
LUCY: We can pretend we are Arctic explorers.
ルーシィ:北極探検にいくみたい。
PETER: I feel like a king.
ピーター:なんだか王さまになったみたいな気分だ。
SUSAN:Now, where shall we go?
スーザン: それで,どっちへいく?
EDMUND: I say, oughtn't we to be bearing a bit more to the left, that is, if we are aiming for the lamp-post?
エドマンド: 街灯のところにいくんなら,もう少し左の方へいくといいと思うけど。
PETER : So you really were here,
ピーター: おまえはここにきたことがあるんだな。
that time Lu said she'd met you here -
あのとき, ルーはここでおまえに会ったといった
and you made out she was telling lies.
だのに,ルーがうそをついてるって、おまえは……。
SUSAN: Where are we going anyway?
スーザン: ところで,どっちにいったらいいのよ。
PETER : I think Lu ought to be the leader.
ピーター:ルーにリーダーになってもらおう。
Where will you take us, Lu?
どっちへいこうか, ルー?
LUCY: What about going to see Mr Tumnus?
ルーシィ: タムナスさんのところへいきましょうよ。

NARRATOR: Led by Lucy, they came to Mr Tumnus's cave.
語り:ルーシィを先頭にして, 4人はタムナスさんの家に着いた。
But the inside was utterly destroyed.
だが、部屋はめちゃめちゃにこわされていた。

LUCY : Oh, how horrible!
ルーシィ: まあ, ひどい!
EDMUND: This is a pretty good wash-out.
エドマンド: こりゃあ、めちゃめちゃだね。
PETER: What's this?
ピーター: なんだろう, これ。
SUSAN : Is there anything written on it?
スーザン : なにか書いてあるの。
PETER (MAUGRIM): The former occupant of these premises, the Faun Tumnus, is under arrest and awaiting his trial on a charge of High Treason against her Imperial Majesty Jadis, Queen of Narnia, Chatelaine of Cair Paravel, Empress of the Lone Islands, etc., also of comforting her said Majesty's enemies, harbouring spies and fraternising with Humans.
signed MAUGRIM,
Captain of the Secret Police,
LONG LIVE THE QUEEN!
ピーター(モーグリム): この家の主 フォーンのタムナスを, ナルニア国の女王にして ケア・パラヴェルの城主、数かずの島国 諸国の女帝にあらせられるジェイディス陛下への反逆罪, すなわち, 陛下の敵であるスパイを匿い, 人間どもとよしみを 通じた罪にて捕らえ, 裁判にかけるものである。
秘密警察司令官 モーグリム
女王陛下 万歳!
PETER: Who is this Queen, Lu?
ピーター: ルー, この女王ってだれのことだい。
LUCY: The White Witch.
ルーシィ: 白い魔女のことよ。
She isn't a real queen at all.
ほんとうの女王じゃないの。
She is a horrible witch and made it always winter here.
ここを冬のまんまにしている悪い魔女なのよ。
SUSAN：I wonder, oughtn't we to go back home?
スーザン : なんだか, お屋敷に戻ったほうがいいんじゃないかしら。
LUCY: Oh, but we can't, we can't.
ルーシィ: だめよだめだめ, ぜったいだめ。
It is all on my account that the poor Faun has got into this trouble.
わたしのせいでタムナスさんがこんなことになっちゃったのよ。
We should try to rescue him.
助けにいかなくちゃ。
PETER: That's true. We should rescue him.
ピーター: そうだね, 助けにいかなくちゃ。
SUSAN: All right.
スーザン: わかったわ。
PETER : But where...
ピーター:でも、 どこに……。`;

const TORA2 = `NARRATOR: Just then, they saw something moving among the trees.
語り:そのとき, 木々のむこうでなにかが動く気配がした。

LUCY : What was that?
ルーシィ: なにかしら。
SUSAN: It's a kind of animal.
スーザン: 動物みたいね。
PETER : It's a beaver.
ピーター:ビーヴァーだ。
It is warning us not to make a noise, and it seems to want us to go to it.
ぼくたちに合図してるみたいだ。音をたてるな、こっちにこいって。
SUSAN: Isn't it a bit risky?
スーザン : 危なくない?
PETER : We ought to be a match for one beaver if it turns out to be an enemy.
ピーター: もし敵だとしてもぼくらは4人, なんとかなるさ。
MR BEAVER: Further in, come further in.
ビーヴァーさん: こっちへ, さあ、もっとこっちへ。
Right in here. We're not safe in the open!
こっちです。 見通しのいいところは危ないんです。
Are you the Sons of Adam and the Daughters of Eve?
あなたがたがアダムのむすこさん方とイヴのむすめさん方ですな。
PETER: We're some of them.
ピーター: まあ、そういってもいいでしょう。
MR BEAVER: S-s-s-sh!
ビーヴァーさん:しー!
Not so loud, please.
大きな声をださないで。
We're not safe even here.
ここだって安全じゃないんです。
There are trees that would betray us to the... ahem.
ときには,そこらの木が例の・・・ エヘン、のスパイをしていますから。
You know the ahem.
例の・・・ エヘン、ってわかりますね。
EDMUND: Of course, but then how do we know you're a friend?
エドマンド:わかるけど, あんたがぼくらの味方だってどうしていえるのさ。
MR BEAVER: Quite right, quite right.
ビーヴァーさん: ごもっとも、ごもっとも。
Here is my token.
では、これをご覧ください。
LUCY : It's my handkerchief -
ルーシィ: わたしのハンカチだわ。
the one I gave to poor Mr Tumnus.
あのときタムナスさんにあげた, わたしのハンカチよ。
MR BEAVER: Poor fellow, he handed this over to me before getting arrested.
ビーヴァーさん: タムナスさんは捕まる前にこれをあずけにきたのです。
He asked me to take care of you if anything happened to him.
もしものときは, あなたたちのことを頼むってね。
SUSAN : Mr Beaver, you really are on our side.
スーザン:ビーヴァーさんは,私たちの味方なんですね。
MR BEAVER: Now, come a little closer.
ビーヴァーさん: さあ、もっと近くに。
They say Aslan is on the move.
どうやらアスランが動きはじめたそうなんです。

NARRATOR： The moment the name was spoken,
語り：その名前を聞いたとたんに、
Peter felt brave,
ピーターは勇気にあふれ、
Susan felt a sense of delight,
スーザンは喜びにつつまれ、
Edmund felt a sense of horror,
エドマンドは恐ろしくなり,
and Lucy got that feeling that the summer holiday has just begun.
ルーシィは夏休みがはじまるときのうきうきした気持ちになった。

MR BEAVER : I must bring you where we can have a real talk and also dinner.
ビーヴァーさん:それでは, くわしくお話ができ, 晩ごはんをさしあげられる場所へご案内しましょう。
CHILDREN: Dinner!
子どもたち: やったぁ!`;

let zc = 0;
const z = (t) => (LAYER[t] || 0) * 1e13 + Date.now() + zc++;

function person(no, x, y, fill = 'white') { const id = newId(8); return [id, { id, t: 'person', no: String(no), x, y, fill, r: 20, z: z('person') }]; }
function text(str, x, y, size = 22) { const id = newId(8); return [id, { id, t: 'text', text: str, x, y, size, z: z('text') }]; }
function blob(pts) { const id = newId(8); return [id, { id, t: 'blob', pts, z: z('blob') }]; }
function ellipse(x, y, rx, ry, extra = {}) { const id = newId(8); return [id, { id, t: 'ellipse', x, y, rx, ry, rot: 0, z: z('ellipse'), ...extra }]; }
function rect(x, y, w, hh, extra = {}) { const id = newId(8); return [id, { id, t: 'rect', x, y, w, h: hh, rot: 0, round: true, z: z('rect'), ...extra }]; }
function arrow(x1, y1, x2, y2, style = 'line') { const id = newId(8); return [id, { id, t: 'arrow', style, head: 'end', x1, y1, x2, y2, z: z('arrow') }]; }

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function fill(nos, poly, gap = 50) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  for (let g = gap; g > 24; g -= 4) {
    const pts = [];
    for (let y = Math.min(...ys) + g / 2; y < Math.max(...ys); y += g * 0.9) {
      for (let x = Math.min(...xs) + g / 2; x < Math.max(...xs); x += g) if (inPoly(x, y, poly)) pts.push([Math.round(x), Math.round(y)]);
    }
    if (pts.length >= nos.length) {
      const step = pts.length / nos.length;
      return nos.map((n, i) => person(n, ...pts[Math.floor(i * step)]));
    }
  }
  return [];
}
const others = (exclude) => Array.from({ length: 41 }, (_, i) => i + 1).filter((n) => !exclude.includes(n));
const shapesOf = (list) => Object.fromEntries(list);

export async function buildSample(user) {
  const w = newId();
  const now = Date.now();
  const cast = CAST.split('\n').map((l) => {
    const m = l.match(/^(\S+)\s+(.*?)(?:（(.*)）)?$/);
    return { no: m[1], name: m[2], role: m[3] || '' };
  });
  const ops = [];
  const set = (path, data) => ops.push({ op: 'set', path, data });
  set(P.work(w), { title: 'ナルニア国物語（見本）', prefix: '【表現活動】', cast, createdAt: now, updatedAt: now, createdBy: user.name });
  const ep = newId();
  set(P.doc(w, 'episodes', ep), { title: '2話', order: 1, createdAt: now });

  const mkBlock = (draftId, script, anchorText, cue, newRow, items) => {
    const offset = script.indexOf(anchorText);
    const it = {};
    items.forEach((x, i) => { it[newId(8)] = { order: i + 1, ...x }; });
    set(P.doc(w, 'blocks', newId()), { draftId, cue, anchor: { offset: Math.max(0, offset), text: anchorText }, newRow, items: it, createdAt: now + offset });
  };
  const mkDia = (draftId, list) => { const id = newId(); set(P.doc(w, 'diagrams', id), { draftId, shapes: shapesOf(list), createdAt: now }); return id; };

  // ---- トラ1 ----
  const t1 = newId(), d1 = newId();
  set(P.doc(w, 'tracks', t1), { episodeId: ep, title: 'トラ1', order: 1, createdAt: now });
  set(P.doc(w, 'drafts', d1), { trackId: t1, no: 1, zukaikko: 'C、B', theme: '', script: TORA1, createdAt: now, updatedAt: now, updatedBy: user.name });
  const kids1 = [person(2, 520, 205), person(23, 525, 285), person(28, 590, 300), person(18, 610, 220), text('ルー', 525, 165, 18), text('エド', 470, 300, 18), text('ピ', 620, 335, 18), text('ス', 640, 190, 18)];
  const band = [[130, 60], [960, 40], [900, 120], [640, 150], [560, 180], [470, 210], [420, 300], [600, 360], [720, 420], [840, 440], [880, 400], [700, 300], [640, 240], [230, 450], [120, 380], [120, 80]];
  const g1 = mkDia(d1, [...fill(others([2, 23, 28, 18, 16]), band, 54), ...kids1, person(16, 121, 428), arrow(640, 330, 870, 270)]);
  mkBlock(d1, TORA1, 'PETER: Lucy', '', true, [
    { kind: 'text', text: '● 4人（ピーター、エドマンド、スーザン、ルーシィ）の周りは木々\nその後、4人は上手側の矢印の方向にはける→タムナスハウスへ' },
    { kind: 'diagram', refId: g1, caption: '' },
  ]);
  mkBlock(d1, TORA1, 'NARRATOR: Led by Lucy', '', true, [{ kind: 'text', text: '● 4人は真ん中の扉からタムナスハウスに入る' }]);
  const g2 = mkDia(d1, [
    rect(200, 120, 150, 210, { round: false }), text('暖炉', 200, 140, 18),
    ...[[7, 160, 70], [14, 160, 125], [19, 160, 180], [15, 160, 240], [10, 240, 70], [8, 240, 125], [9, 240, 180], [25, 240, 240]].map((a) => person(...a)),
    rect(390, 90, 150, 70), text('棚', 390, 95, 18), ...[[33, 340, 55], [34, 390, 55], [3, 440, 55], [17, 360, 115], [21, 420, 115]].map((a) => person(...a)),
    rect(620, 90, 190, 60), text('扉', 735, 95, 18), ...[[27, 545, 90], [30, 595, 90], [31, 645, 90], [29, 695, 90]].map((a) => person(...a)),
    rect(620, 280, 130, 140, { round: false }), text('テーブル', 620, 290, 18), ...[[25, 590, 205], [38, 650, 205], [12, 560, 270], [6, 660, 270], [11, 590, 330], [13, 650, 330]].map((a) => person(...a)),
    ellipse(840, 235, 60, 110), text('ソファ', 840, 235, 18), ...[[37, 830, 140], [5, 780, 180], [36, 880, 180], [3, 780, 240], [20, 885, 245], [4, 790, 300], [1, 840, 340], [22, 880, 300]].map((a) => person(...a)),
    person(2, 540, 40), person(23, 600, 40), person(28, 650, 40), person(18, 700, 40),
    person(16, 121, 428),
  ]);
  mkBlock(d1, TORA1, 'だが、部屋はめちゃめちゃ', 'だが、部屋はめちゃめちゃ', false, [
    { kind: 'text', text: '周りの家具が壊れていく\n→テーブル（真ん中）から周りへと順に壊れていく\n→壊れ方はタイムラプスのように' },
    { kind: 'diagram', refId: g2, caption: '' },
  ]);
  mkBlock(d1, TORA1, 'PETER (MAUGRIM)', '', true, [{ kind: 'text', text: '● 4人は、モーグリムの張り紙が読まれているときは柱の前に移動' }]);
  mkBlock(d1, TORA1, 'the Faun Tumnus', 'the Faun Tumnus', false, [{ kind: 'text', text: '● タムナスを何者かが襲って行く様子を、大きな物体を出し影絵のように表す。' }]);

  // ---- トラ2 ----
  const t2 = newId(), d2 = newId();
  set(P.doc(w, 'tracks', t2), { episodeId: ep, title: 'トラ2', order: 2, createdAt: now });
  set(P.doc(w, 'drafts', d2), { trackId: t2, no: 1, zukaikko: 'F', theme: '', script: TORA2, createdAt: now, updatedAt: now, updatedBy: user.name });
  const forest = [[300, 85], [600, 75], [850, 95], [905, 200], [840, 230], [760, 240], [730, 320], [750, 400], [660, 390], [630, 300], [560, 230], [420, 225], [300, 190], [275, 120]];
  const kids2 = [person(23, 310, 345), person(2, 380, 345), person(18, 260, 380), person(28, 385, 395), person(24, 880, 345),
    text('エド', 300, 305, 18), text('ルー', 385, 305, 18), text('ス', 225, 370, 18), text('ピ', 385, 432, 18), text('ビー', 880, 385, 18)];
  const g3 = mkDia(d2, [blob(forest), ...fill(others([2, 23, 28, 18, 24, 16]), forest, 50), text('森', 680, 130, 26), ...kids2, person(16, 121, 428)]);
  mkBlock(d2, TORA2, 'Just then,', 'Just then,', true, [
    { kind: 'text', text: '● 兄弟4人は下手前方、4人の周りを避けるようにして半円の森、森の奥である上手側からビーバーさんが登場\n\n＊木は針葉樹を意識して下に手を伸ばす' },
    { kind: 'diagram', refId: g3, caption: '' },
  ]);
  const forest2 = [[140, 130], [300, 70], [700, 70], [900, 110], [900, 220], [820, 290], [740, 300], [650, 230], [500, 200], [300, 230], [150, 230]];
  const g4 = mkDia(d2, [blob(forest2), ...fill(others([2, 23, 28, 18, 24, 16]), forest2, 50), text('森', 680, 120, 26),
    person(18, 520, 410), person(23, 560, 385), person(2, 600, 360), person(28, 640, 335), person(24, 720, 365),
    text('ス', 480, 420, 18), text('エド', 540, 350, 18), text('ルー', 580, 325, 18), text('ピ', 640, 298, 18), text('ビー', 760, 360, 18), person(16, 121, 428)]);
  mkBlock(d2, TORA2, 'Further in,', 'Further in', true, [
    { kind: 'text', text: '● 4人は中央に向かって歩き、森が全体に広がっていって、４人とビーバーさんが横並びになる。' },
    { kind: 'diagram', refId: g4, caption: '' },
  ]);
  mkBlock(d2, TORA2, 'The moment', 'The moment', true, [
    { kind: 'text', text: '● 上手後方に太陽、後ろの方全体に森\n→森の木は風が吹き明るく、エドマンドの周りは変化しない\n☆太陽はアスランの象徴、エドマンド以外は明るく前向きな雰囲気' },
  ]);
  const forest3 = [[160, 120], [300, 60], [700, 60], [830, 100], [830, 190], [700, 220], [500, 230], [300, 250], [150, 210]];
  const g5 = mkDia(d2, [blob(forest3), ellipse(870, 110, 85, 70), text('太陽', 930, 200, 20),
    ...fill([27, 40, 41, 26, 15, 30, 35, 19, 9, 8, 10, 7, 33, 21, 29, 25, 5, 6, 20, 13, 22, 3, 4, 1], forest3, 52),
    ...[[39, 830, 70], [36, 900, 70], [31, 820, 120], [32, 880, 120], [38, 920, 120]].map((a) => person(...a)),
    text('森', 610, 130, 26),
    person(11, 520, 325), person(12, 560, 320), person(14, 505, 365), person(17, 575, 365), person(23, 540, 370, 'gray'),
    person(2, 340, 395), person(18, 690, 395), person(28, 790, 410), person(24, 850, 410),
    text('ルー', 290, 380, 18), text('エド', 540, 420, 18), text('スー', 690, 355, 18), text('ピ', 795, 370, 18), text('ビー', 850, 450, 18),
    person(16, 121, 428)]);
  mkBlock(d2, TORA2, 'Edmund felt', 'Edmund felt', false, [
    { kind: 'text', text: '● エドマンドの周りの木はエドマンドをつかむ\n☆エドマンドの後ろめたさを表現' },
    { kind: 'diagram', refId: g5, caption: '' },
  ]);

  await db.batch(ops);
  return w;
}
