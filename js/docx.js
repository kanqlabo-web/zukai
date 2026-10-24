// Word（.docx）で書き出す。PDFと同じ表の形（左にテーマ活動の友、右にタイミング・動き・図）で作る。
// Googleドキュメントで開いても同じように見えるよう、Arial（日本語は Noto Sans JP）・同じ文字の大きさにする。
import { h, render } from './vdom.js';
import { S, toast } from './state.js';
import { draftTitle } from './model.js';
import { castIndex, numberCast, roleText } from './cast.js';
import { buildRows, highlightRanges, lineSegments } from './script.js';
import { blockUpdates, showUpdates, DIAGRAM_FIXED } from './update.js';
import { attrsOf, runsOf, TEXT_COLORS, BG_COLORS } from './richtext.js';
import { StageSVG } from './stage.js';
import { loadPrint } from './print.js';
import { makeZip } from './zip.js';

const TW = (mm) => Math.round(mm * 56.6929); // ミリ → 1/20ポイント
const EMU = (mm) => Math.round(mm * 36000); // ミリ → 画像の単位
const PAGE_W = 210, PAGE_H = 297, MARGIN_X = 9.75, MARGIN_T = 10, MARGIN_B = 9;
const BODY_W = PAGE_W - MARGIN_X * 2;
const SCRIPT_W = BODY_W * 0.365, NOTES_W = BODY_W - SCRIPT_W;
const CELL_PAD = 2.4; // セルの内側の余白（ミリ）

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const byOrder = (a, b) => (a.order || 0) - (b.order || 0);

// ---------- 文字 ----------
function run(text, { size = 20, color, bold, shade } = {}) {
  if (!text) return '';
  const pr = [
    '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Noto Sans JP" w:cs="Arial"/>',
    bold ? '<w:b/><w:bCs/>' : '',
    color ? `<w:color w:val="${color}"/>` : '',
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`,
    shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : '',
  ].join('');
  return `<w:r><w:rPr>${pr}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}
function para(runs, { indent = 0, line = 276, keep = false, tabs = '', shade } = {}) {
  const ppr = [
    keep ? '<w:keepLines/>' : '',
    tabs,
    shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : '',
    `<w:spacing w:before="0" w:after="0" w:line="${line}" w:lineRule="auto"/>`,
    indent ? `<w:ind w:left="${TW(indent)}"/>` : '',
  ].join('');
  return `<w:p><w:pPr>${ppr}</w:pPr>${runs || ''}</w:p>`;
}
const emptyPara = (size = 20) => para(run(' ', { size }));

// ---------- 画像 ----------
let media = [];
function addMedia(bytes, ext) {
  const n = media.length + 1;
  media.push({ name: `image${n}.${ext}`, bytes, ext, rid: `rIdImg${n}` });
  return media[media.length - 1];
}
function imageXml(m, wmm, hmm, id) {
  const cx = EMU(wmm), cy = EMU(hmm);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="図${id}"/>`
    + '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>'
    + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${m.name}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${m.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`
    + '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
}

// 図（SVG）をPNG画像にする
function stagePng(g, idx) {
  return new Promise((resolve) => {
    const holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;left:-10000px;top:0;width:1000px';
    document.body.appendChild(holder);
    render(holder, StageSVG(g.shapes, { cls: 'stage', idx, roleVis: g.roleVis || {} }));
    const svg = holder.querySelector('svg');
    svg.setAttribute('width', 1000);
    svg.setAttribute('height', 470);
    const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    render(holder, []);
    holder.remove();
    const im = new Image();
    im.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = 2000; cv.height = 940;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(im, 0, 0, cv.width, cv.height);
      cv.toBlob(async (b) => resolve(b ? new Uint8Array(await b.arrayBuffer()) : null), 'image/png');
    };
    im.onerror = () => resolve(null);
    im.src = src;
  });
}
function dataUrlBytes(url) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/.exec(url || '');
  if (!m) return null;
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return { bytes: out, ext: /png/.test(m[1]) ? 'png' : 'jpeg' };
}
function imageSize(bytes, ext) {
  try {
    if (ext === 'png') return [(bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19], (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]];
    for (let i = 2; i < bytes.length;) {
      const marker = bytes[i + 1], len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker >= 0xc0 && marker <= 0xc3) return [(bytes[i + 7] << 8) | bytes[i + 8], (bytes[i + 5] << 8) | bytes[i + 6]];
      i += 2 + len;
    }
  } catch (e) { /* 大きさがわからないとき */ }
  return [4, 3];
}

// ---------- 表 ----------
const B = (sz, color = '000000') => (sz ? `w:val="single" w:sz="${sz}" w:space="0" w:color="${color}"` : 'w:val="nil"');
function cell(wmm, content, borders, { pad = CELL_PAD, vpad = 0 } = {}) {
  const bd = Object.entries(borders).map(([side, v]) => `<w:${side} ${v}/>`).join('');
  return `<w:tc><w:tcPr><w:tcW w:w="${TW(wmm)}" w:type="dxa"/><w:tcBorders>${bd}</w:tcBorders>`
    + `<w:tcMar><w:top w:w="${TW(vpad)}" w:type="dxa"/><w:left w:w="${TW(pad)}" w:type="dxa"/><w:bottom w:w="${TW(vpad)}" w:type="dxa"/><w:right w:w="${TW(pad)}" w:type="dxa"/></w:tcMar></w:tcPr>`
    + (content || emptyPara()) + '</w:tc>';
}
function table(widths, rows, extra = '') {
  return `<w:tbl><w:tblPr><w:tblW w:w="${TW(widths.reduce((a, b) => a + b, 0))}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${extra}`
    + '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>'
    + `<w:tblGrid>${widths.map((x) => `<w:gridCol w:w="${TW(x)}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`;
}

function castTable(cast) {
  const list = numberCast(cast);
  const rows = [];
  const cw = BODY_W / 4;
  for (let i = 0; i < Math.max(1, list.length); i += 4) {
    const cells = [0, 1, 2, 3].map((k) => {
      const c = list[i + k];
      const outer = { top: B(i === 0 ? 12 : 6), bottom: B(i + 4 >= list.length ? 12 : 6), left: B(k === 0 ? 12 : 6), right: B(k === 3 ? 12 : 6) };
      const txt = c ? para(run(c.no, { size: 20 }) + '<w:r><w:tab/></w:r>' + run(c.name + (roleText(c) ? `（${roleText(c)}）` : ''), { size: 20 }),
        { tabs: `<w:tabs><w:tab w:val="left" w:pos="${TW(7.8)}"/></w:tabs>` }) : emptyPara();
      return cell(cw, txt, outer, { pad: 1.9, vpad: 1.2 });
    });
    rows.push(`<w:tr><w:trPr><w:trHeight w:val="${TW(7.8)}"/></w:trPr>${cells.join('')}</w:tr>`);
  }
  return table([cw, cw, cw, cw], rows);
}

const HEX = (v) => (TEXT_COLORS[v] || '').replace('#', '').toUpperCase() || undefined; // gray はキャラ名と同じ D9D9D9
const HEXBG = (v) => (BG_COLORS[v] || '').replace('#', '').toUpperCase() || undefined;
function scriptParas(text, lines, hls, marks) {
  return lines.map((l) => {
    if (l.blank) return emptyPara(20);
    const runs = lineSegments(text, l, hls, marks).map((sg) => run(sg.text, {
      size: 20, color: sg.c ? HEX(sg.c) : sg.label ? 'D9D9D9' : undefined, bold: sg.hl || !!sg.b, shade: sg.bg ? HEXBG(sg.bg) : sg.hl ? 'C4C4C4' : undefined,
    })).join('');
    return para(runs, { indent: l.indent ? 3.5 : 0, keep: true });
  }).join('');
}

async function notesParas(t, row, idx, ids) {
  const out = [];
  const NOTE = { size: 21, color: '000000' };
  row.blocks.forEach(({ b }, bi) => { b._bi = bi; });
  const BLUE_NOTE = { ...NOTE, color: '0000FF' };
  for (const { b } of row.blocks) {
    const u = blockUpdates(t.draft, b, t.diagrams);
    if (b._bi > 0) out.push(emptyPara(21));
    if (b.cue) out.push(para(run('《', NOTE) + run(b.cue, { size: 21, bold: true, shade: 'C4C4C4', color: u && u.cue ? '0000FF' : undefined }) + run('》', NOTE)));
    const items = Object.entries(b.items || {}).map(([id, it]) => ({ id, ...it })).sort(byOrder);
    for (const it of items) {
      if (it.kind === 'text') {
        const lines = String(it.text || '').replace(/\s+$/, '').split('\n');
        const src = String(it.text || '');
        const at = attrsOf(src, it.marks);
        let pos = 0;
        for (const ln of lines) {
          const st = pos; pos += ln.length + 1;
          if (!ln.trim()) { out.push(emptyPara(21)); continue; }
          const base = u && u.line(it.id, ln) ? BLUE_NOTE : NOTE;
          out.push(para(runsOf(st, st + ln.length, at).map((r) => run(src.slice(r.s, r.e), { ...base, color: r.c ? HEX(r.c) : base.color, shade: r.bg ? HEXBG(r.bg) : undefined, bold: !!r.b })).join(''), { line: 276 }));
        }
      } else if (it.kind === 'diagram') {
        const g = t.diagrams[it.refId];
        if (it.caption) out.push(para(run(it.caption, NOTE)));
        if (u && u.diagram(it.id, it.refId)) out.push(para(run(DIAGRAM_FIXED, BLUE_NOTE)));
        if (g) {
          const png = await stagePng(g, idx);
          if (png) {
            const m = addMedia(png, 'png');
            const wmm = NOTES_W - CELL_PAD * 2;
            out.push(para(imageXml(m, wmm, wmm * 0.47, ++ids.n)));
          }
        }
      } else if (it.kind === 'image') {
        const im = t.images[it.refId];
        if (it.caption) out.push(para(run(it.caption, NOTE)));
        const d = im && dataUrlBytes(im.data);
        if (d) {
          const m = addMedia(d.bytes, d.ext);
          const [iw, ih] = imageSize(d.bytes, d.ext);
          const wmm = (NOTES_W - CELL_PAD * 2) * ({ s: 0.4, m: 0.68, l: 1 }[it.size || 'm'] || 0.68);
          out.push(para(imageXml(m, wmm, wmm * (ih / iw || 0.75), ++ids.n)));
        }
      }
    }
  }
  return out.join('');
}

async function sheetXml(data, t, idx, ids) {
  const text = t.draft.script || '';
  const rows = buildRows(text, t.blocks, t.draft.spkFix);
  const hls = highlightRanges(text, t.blocks);
  const parts = [];
  parts.push(para(run('図解っ子：' + (t.draft.zukaikko || ''), { size: 20 })));
  parts.push(para(run('表現したいこと（場面●）：' + (t.draft.theme || ''), { size: 20 })));
  if (showUpdates(t.draft)) parts.push(para(run('更新：青', { size: 20, color: '0000FF' })));
  parts.push(castTable(data.work.cast));
  parts.push(emptyPara(10));
  parts.push(para(run('《》タイミング　●動き　☆意味　＊ポイント', { size: 20, bold: true, shade: 'CFCFCF' })));
  const S1 = 15, N1 = 6; // 線の太さ（テーマ活動の友の列は太く、図解の列は細く）
  const trs = [];
  const list = text || (t.blocks || []).length ? rows : [{ lines: [], blocks: [] }];
  for (let k = 0; k < list.length; k++) {
    const row = list[k];
    const first = k === 0, last = k === list.length - 1;
    const sc = text ? scriptParas(text, row.lines, hls, t.draft.scriptMarks || []) : para(run('（テマ友なし）', { size: 20 }));
    const nc = await notesParas(t, row, idx, ids);
    const vpadTop = first ? 2 : 0;
    trs.push('<w:tr>'
      + cell(SCRIPT_W, sc, { top: first ? B(S1) : B(0), bottom: last ? B(S1) : B(0), left: B(S1), right: B(S1) }, { vpad: 0 })
      + cell(NOTES_W, nc, { top: first ? B(N1, '444444') : B(0), bottom: last ? B(N1, '444444') : B(0), left: B(0), right: B(N1, '444444') }, { vpad: 0 })
      + '</w:tr>');
    if (first && vpadTop) { /* 先頭の余白は段落の前の空きで代用しない（ドキュメントと同じく詰める） */ }
  }
  parts.push(table([SCRIPT_W, NOTES_W], trs));
  return parts.join('');
}

function sectPr(hid) {
  return `<w:sectPr><w:headerReference w:type="default" r:id="${hid}"/>`
    + `<w:pgSz w:w="${TW(PAGE_W)}" w:h="${TW(PAGE_H)}"/>`
    + `<w:pgMar w:top="${TW(MARGIN_T + 8)}" w:right="${TW(MARGIN_X)}" w:bottom="${TW(MARGIN_B)}" w:left="${TW(MARGIN_X)}" w:header="${TW(MARGIN_T)}" w:footer="0" w:gutter="0"/></w:sectPr>`;
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

export async function buildDocx(data) {
  media = [];
  const ids = { n: 0 };
  const idx = castIndex(data.work.cast);
  const headers = [];
  const bodies = [];
  for (let i = 0; i < data.targets.length; i++) {
    const t = data.targets[i];
    const title = draftTitle(data.work, t.ep, t.track, t.draft);
    headers.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}>${para(run(title, { size: 20 }))}</w:hdr>`);
    let body = await sheetXml(data, t, idx, ids);
    // 話をまとめて書き出すときは、トラックごとに区切る（各トラックの上にそのタイトル）
    if (i < data.targets.length - 1) body += `<w:p><w:pPr>${sectPr('rIdH' + (i + 1))}</w:pPr></w:p>`;
    bodies.push(body);
  }
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${bodies.join('')}${sectPr('rIdH' + data.targets.length)}</w:body></w:document>`;
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults>'
    + '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Noto Sans JP" w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-US" w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault>'
    + '<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
    + '</w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + headers.map((_, i) => `<Relationship Id="rIdH${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header${i + 1}.xml"/>`).join('')
    + media.map((m) => `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join('')
    + '</Relationships>';
  const types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + headers.map((_, i) => `<Override PartName="/word/header${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`).join('')
    + '</Types>';
  const root = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const files = [
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: root },
    { name: 'word/document.xml', data: doc },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/_rels/document.xml.rels', data: rels },
    ...headers.map((x, i) => ({ name: `word/header${i + 1}.xml`, data: x })),
    ...media.map((m) => ({ name: 'word/media/' + m.name, data: m.bytes })),
  ];
  return makeZip(files, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

// 保存（iPhone・iPad は共有シート、それ以外はダウンロード）
export async function deliverFile(blob, name) {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && navigator.canShare) {
    try {
      const file = new File([blob], name, { type: blob.type });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// 稿（kind 'd'）または話（kind 'e'）をWordで書き出す
export async function exportDocx(w, id, kind = 'd') {
  toast('Wordのファイルを作っています…');
  try {
    const data = await loadPrint({ w, kind, id });
    const blob = await buildDocx(data);
    await deliverFile(blob, data.fileName.replace(/[\\/:*?"<>|]/g, '_') + '.docx');
  } catch (e) {
    toast('Wordのファイルを作れませんでした: ' + (e.message || e), 'error', 8000);
  }
}
