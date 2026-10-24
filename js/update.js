// 稿を更新したときの「更新箇所は青字」
// 新しい稿を作るとき（copyDraft）、各図解に元の内容（orig）を控えておき、それと違うところを青字にする。
//   《タイミング》：新しい図解、または書き換えたタイミング
//   説明文：元の説明文になかった行
//   図：新しく足した図、または中身を変えた図には「【図解修正済み】」を付ける
export const BLUE = '#0000ff';

const stable = (o) => (o == null ? 'null' : typeof o !== 'object' ? JSON.stringify(o) : Array.isArray(o) ? '[' + o.map(stable).join(',') + ']' : '{' + Object.keys(o).sort().map((k) => k + ':' + stable(o[k])).join(',') + '}');
// 図の中身の目印（短い文字列）
export function shapesSig(shapes) {
  const s = stable(shapes || {});
  let h1 = 0x811c9dc5, h2 = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = (h2 * 31 + c) | 0; }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36);
}

// 新しい稿にする図解の控え
export function makeOrig(block, diagramsById) {
  const texts = {}, dias = {};
  for (const [k, it] of Object.entries(block.items || {})) {
    if (it.kind === 'text') texts[k] = it.text || '';
    if (it.kind === 'diagram' && it.refId && diagramsById[it.refId]) dias[k] = shapesSig(diagramsById[it.refId].shapes);
  }
  return { cue: block.cue || '', texts, dias };
}

// この稿で青字にするか
export const showUpdates = (draft) => !!(draft && draft.updMark && draft.updShow !== false);

// 図解ごとの判定
export function blockUpdates(draft, b, diagramsById) {
  if (!showUpdates(draft)) return null;
  const o = b.orig;
  // 元の説明文の行（図解の中のどの文章の欄にあってもよい。ページの中で文章を分けたり、つなげたりしても青字にならないように）
  let lineSet = null;
  const known = (ln) => {
    if (!lineSet) lineSet = new Set(Object.values((o && o.texts) || {}).flatMap((t) => String(t).split('\n').map((x) => x.trim())));
    return lineSet.has(String(ln).trim());
  };
  return {
    cue: !o || (o.cue || '') !== (b.cue || '') || !!b.cueBlue, // cueBlue：前の稿の青字をそのままにした
    line: (itemId, ln) => {
      if (!String(ln).trim()) return false;
      return !o || !known(ln);
    },
    text: (itemId, text) => String(text || '').split('\n').some((ln) => ln.trim() && (!o || !known(ln))),
    diagram: (itemId, refId) => {
      const g = diagramsById[refId];
      if (!g) return false;
      if (!o || !o.dias || o.dias[itemId] == null) return true;
      return o.dias[itemId] !== shapesSig(g.shapes);
    },
  };
}
export const DIAGRAM_FIXED = '【図解修正済み】';
