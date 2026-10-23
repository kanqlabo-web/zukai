// サイトの中でPDFを作る（印刷機能を使わない）
// 画面に並べたA4のページを、ブラウザが配置したとおりの位置で画像に描き、1つのPDFにまとめる。
// どの端末でも同じ見た目になり、iPhoneのSafariでも保存できる。

const A4W = 595.28, A4H = 841.89; // PDFの単位（ポイント）
// 画像の細かさ。パソコンは約480dpi（拡大しても粗くなりにくい）。スマホ・タブレットはメモリが少ないので約290dpi
const MOBILE = /iPhone|iPad|iPod|Android/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const SCALE = MOBILE ? 3 : 5;

// ---------- 1ページを画像に描く ----------
function parseColor(c) {
  if (!c || c === 'transparent') return null;
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return c;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (p.length >= 4 && p[3] === 0) return null;
  return c;
}

function svgImage(svg, fit) {
  return new Promise((resolve) => {
    const c = svg.cloneNode(true);
    const r = svg.getBoundingClientRect();
    // 画面の大きさのまま画像にすると、PDFで拡大したときに粗くなる。PDFと同じ細かさで描く
    c.setAttribute('width', Math.round((r.width / fit) * SCALE));
    c.setAttribute('height', Math.round((r.height / fit) * SCALE));
    c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(c));
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

async function paintPage(page) {
  // 図（SVG）は先に画像にしておく（待っている間に画面がずれても大丈夫なように、位置はこのあとで測る）
  const svgs = new Map();
  const fit0 = page.getBoundingClientRect().width / page.offsetWidth || 1;
  await Promise.all([...page.querySelectorAll('svg')].map(async (s) => { svgs.set(s, await svgImage(s, fit0)); }));
  const pr = page.getBoundingClientRect();
  const fit = pr.width / page.offsetWidth || 1; // 画面で縮小表示しているぶん
  const W = page.offsetWidth, H = page.offsetHeight;
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * SCALE);
  cv.height = Math.round(H * SCALE);
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  const R = (r) => ({ x: (r.left - pr.left) / fit, y: (r.top - pr.top) / fit, w: r.width / fit, h: r.height / fit });


  const drawBorders = (el, cs, r) => {
    const sides = [
      ['Top', (w) => [r.x, r.y, r.w, w]], ['Bottom', (w) => [r.x, r.y + r.h - w, r.w, w]],
      ['Left', (w) => [r.x, r.y, w, r.h]], ['Right', (w) => [r.x + r.w - w, r.y, w, r.h]],
    ];
    for (const [side, rect] of sides) {
      const w = parseFloat(cs['border' + side + 'Width']) || 0;
      if (!w || cs['border' + side + 'Style'] === 'none' || cs['border' + side + 'Style'] === 'hidden') continue;
      const col = parseColor(cs['border' + side + 'Color']);
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(...rect(w)); // 線の太さは縮小表示の影響を受けない
    }
  };

  const drawText = (node, cs) => {
    const text = node.nodeValue;
    if (!text || !text.trim()) return;
    const col = parseColor(cs.color);
    if (!col) return;
    ctx.fillStyle = col;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText('Ag');
    const asc = m.fontBoundingBoxAscent != null ? m.fontBoundingBoxAscent : parseFloat(cs.fontSize) * 0.9;
    const desc = m.fontBoundingBoxDescent != null ? m.fontBoundingBoxDescent : parseFloat(cs.fontSize) * 0.22;
    const range = document.createRange();
    // 1文字ずつ、ブラウザが置いた位置に描く（改行位置・文字の位置が画面と同じになる）
    let i = 0;
    for (const ch of text) {
      const n = ch.length;
      if (ch.trim()) {
        range.setStart(node, i);
        range.setEnd(node, i + n);
        const rs = range.getClientRects();
        if (rs.length) {
          const r = R(rs[0]);
          // 文字の箱の中で、上下の余白を等分して基準線を決める
          const base = r.y + (r.h - (asc + desc)) / 2 + asc;
          ctx.fillText(ch, r.x, base);
        }
      }
      i += n;
    }
  };

  const walk = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const rects = el.getClientRects();
    const box = R(el.getBoundingClientRect());
    const tag = el.tagName.toLowerCase();
    // 背景（文字の強調など、行をまたぐものは行ごと）
    const bg = parseColor(cs.backgroundColor);
    if (bg) {
      ctx.fillStyle = bg;
      const round = parseFloat(cs.borderTopLeftRadius) || 0;
      for (const rr of rects) {
        const r = R(rr);
        if (round >= Math.min(r.w, r.h) / 2 - 0.5) {
          ctx.beginPath(); ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); ctx.fill();
        } else ctx.fillRect(r.x, r.y, r.w, r.h);
      }
    }
    if (tag === 'svg') {
      const im = svgs.get(el);
      if (im) ctx.drawImage(im, box.x, box.y, box.w, box.h);
      return;
    }
    if (tag === 'img') {
      if (el.complete && el.naturalWidth) ctx.drawImage(el, box.x, box.y, box.w, box.h);
      return;
    }
    drawBorders(el, cs, box);
    const clip = cs.overflow === 'hidden' || cs.overflowX === 'hidden';
    if (clip) { ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip(); }
    for (const ch of el.childNodes) {
      if (ch.nodeType === 3) drawText(ch, cs);
      else if (ch.nodeType === 1) walk(ch);
    }
    if (clip) ctx.restore();
  };
  walk(page);
  return cv;
}

// ---------- PDFファイルを組み立てる（JPEG画像を1ページに1枚） ----------
function makePdf(images) {
  const enc = new TextEncoder();
  const parts = [];
  let size = 0;
  const offsets = [];
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); size += b.length; };
  const obj = (n, body) => { offsets[n] = size; push(`${n} 0 obj\n`); for (const b of body) push(b); push('\nendobj\n'); };
  const n = images.length;
  // 1:カタログ 2:ページ一覧 その後 ページごとに [ページ, 中身, 画像]
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const kids = images.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  obj(2, [`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`]);
  images.forEach((im, i) => {
    const p = 3 + i * 3;
    const draw = `q ${A4W} 0 0 ${A4H} 0 0 cm /Im0 Do Q`;
    obj(p, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4W} ${A4H}] /Resources << /XObject << /Im0 ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`]);
    obj(p + 1, [`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`]);
    obj(p + 2, [`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`, im.bytes, '\nendstream']);
  });
  const xref = size;
  const count = 3 + n * 3;
  let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let k = 1; k < count; k++) x += String(offsets[k]).padStart(10, '0') + ' 00000 n \n';
  push(x);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: 'application/pdf' });
}

function canvasJpeg(cv) {
  return new Promise((resolve) => {
    cv.toBlob(async (b) => resolve({ bytes: new Uint8Array(await b.arrayBuffer()), w: cv.width, h: cv.height }), 'image/jpeg', 0.95);
  });
}

// 全ページをPDFにする。onProgress(済んだページ数, 全ページ数)
export async function buildPdf(pages, onProgress) {
  if (document.fonts) await document.fonts.ready;
  const images = [];
  for (let i = 0; i < pages.length; i++) {
    const cv = await paintPage(pages[i]);
    images.push(await canvasJpeg(cv));
    cv.width = cv.height = 0; // スマホのメモリを空ける
    if (onProgress) onProgress(i + 1, pages.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return makePdf(images);
}

// できたPDFを保存する（iPhone・iPad は共有シートから「ファイルに保存」できる）
export async function deliverPdf(blob, fileName) {
  const name = fileName.replace(/[\\/:*?"<>|]/g, '_') + '.pdf';
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && navigator.canShare) {
    try {
      const file = new File([blob], name, { type: 'application/pdf' });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return 'shared'; }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancel';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'downloaded';
}
