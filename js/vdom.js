// 小さな仮想DOM。外部ライブラリなしで画面を差分更新する。
const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props, ...children) {
  props = props || {};
  return { tag, props, key: props.key, children: flatten(children) };
}

function flatten(list, out = []) {
  for (const c of list) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) flatten(c, out);
    else if (typeof c === 'object') out.push(c);
    else out.push({ tag: '#text', text: String(c) });
  }
  return out;
}

export function render(container, vnodes) {
  const news = flatten(Array.isArray(vnodes) ? vnodes : [vnodes]);
  patchChildren(container, container._vkids || [], news, container instanceof SVGElement);
  container._vkids = news;
}

function createEl(v, svg) {
  if (v.tag === '#text') { v.el = document.createTextNode(v.text); return v.el; }
  svg = svg || v.tag === 'svg';
  const el = svg ? document.createElementNS(SVG_NS, v.tag) : document.createElement(v.tag);
  v.el = el;
  setProps(el, {}, v.props, svg);
  const childSvg = svg && v.tag !== 'foreignObject';
  // manual：中身はその要素が自分で管理する（文字の直接編集など）
  if (!v.props.manual) for (const c of v.children) el.appendChild(createEl(c, childSvg));
  if (v.tag === 'select' && 'value' in v.props) el.value = v.props.value == null ? '' : String(v.props.value);
  if (typeof v.props.ref === 'function') queueMicrotask(() => v.props.ref(el));
  return el;
}

function patch(old, v, svg) {
  if (old.tag !== v.tag || old.key !== v.key) {
    const el = createEl(v, svg);
    old.el.parentNode && old.el.parentNode.replaceChild(el, old.el);
    return;
  }
  v.el = old.el;
  if (v.tag === '#text') {
    if (old.text !== v.text) v.el.data = v.text;
    return;
  }
  svg = svg || v.tag === 'svg';
  setProps(v.el, old.props, v.props, svg);
  if (!v.props.manual) patchChildren(v.el, old.children, v.children, svg && v.tag !== 'foreignObject');
  if (v.tag === 'select' && 'value' in v.props && document.activeElement !== v.el) v.el.value = v.props.value == null ? '' : String(v.props.value);
  if (typeof v.props.update === 'function') v.props.update(v.el);
}

function patchChildren(parent, olds, news, svg) {
  const keyed = new Map();
  const unkeyed = [];
  for (const o of olds) {
    if (o.key != null) keyed.set(o.key, o);
    else unkeyed.push(o);
  }
  let ui = 0;
  const used = new Set();
  news.forEach((v, i) => {
    let o = null;
    if (v.key != null) {
      o = keyed.get(v.key) || null;
      if (o && o.tag !== v.tag) o = null;
    } else {
      while (ui < unkeyed.length && used.has(unkeyed[ui])) ui++;
      if (ui < unkeyed.length && unkeyed[ui].tag === v.tag) { o = unkeyed[ui]; ui++; }
    }
    if (o && !used.has(o)) {
      used.add(o);
      patch(o, v, svg);
    } else {
      createEl(v, svg);
    }
    const at = parent.childNodes[i];
    if (at !== v.el) parent.insertBefore(v.el, at || null);
  });
  for (const o of olds) {
    if (!used.has(o) && o.el && o.el.parentNode === parent) parent.removeChild(o.el);
  }
  // 管理外のノードが残っていたら削除
  while (parent.childNodes.length > news.length) parent.removeChild(parent.lastChild);
}

const PROP_KEYS = new Set(['value', 'checked', 'selected', 'disabled', 'indeterminate']);

function setProps(el, oldP, newP, svg) {
  for (const k in oldP) {
    if (!(k in newP)) setProp(el, k, oldP[k], undefined, svg);
  }
  for (const k in newP) {
    if (oldP[k] !== newP[k] || k === 'value' || k === 'checked') setProp(el, k, oldP[k], newP[k], svg);
  }
}

function setProp(el, k, oldV, v, svg) {
  if (k === 'key' || k === 'ref' || k === 'update' || k === 'manual') return;
  if (k.startsWith('on')) {
    const name = k.slice(2).toLowerCase();
    el._h = el._h || {};
    if (!el._h[name]) el.addEventListener(name, (e) => el._h[name] && el._h[name](e), name === 'touchstart' || name === 'touchmove' ? { passive: false } : false);
    el._h[name] = v;
    return;
  }
  if (k === 'style') {
    if (typeof v === 'string') { el.style.cssText = v; return; }
    el.style.cssText = '';
    if (v) for (const s in v) {
      if (v[s] == null) continue;
      if (s.startsWith('--')) el.style.setProperty(s, v[s]);
      else el.style[s] = v[s];
    }
    return;
  }
  if (k === 'class' || k === 'className') {
    if (svg) el.setAttribute('class', v || '');
    else el.className = v || '';
    return;
  }
  if (!svg && PROP_KEYS.has(k)) {
    if (k === 'value') {
      // 入力中の欄は外部更新で上書きしない
      if (document.activeElement === el && el._typed) return;
      const s = v == null ? '' : String(v);
      if (el.value !== s) el.value = s;
      return;
    }
    el[k] = !!v;
    return;
  }
  if (v == null || v === false) el.removeAttribute(k);
  else el.setAttribute(k, v === true ? '' : v);
}

// 入力中フラグ（focus中に外部から値を変えないため）
document.addEventListener('input', (e) => { if (e.target) e.target._typed = true; }, true);
document.addEventListener('focusout', (e) => { if (e.target) e.target._typed = false; }, true);
