// サイト内の入力・確認ダイアログ（ブラウザの prompt / confirm は使わない）
import { h } from './vdom.js';
import { rerender } from './state.js';

let cur = null;

// fields: [{ key, label, value, placeholder, type: 'text'|'textarea'|'select', options:[[v,label]] , hint }]
// choices: [[値, ボタンの文字], …]：OK のかわりに並べるボタン。押したボタンの値が結果の choice に入る
export function ask(opts) {
  return new Promise((resolve) => {
    const values = {};
    for (const f of opts.fields || []) values[f.key] = f.value ?? '';
    cur = { opts, values, resolve, error: '' };
    rerender();
  });
}

export async function confirmBox(message, { title = '確認', ok = 'OK', danger = false, detail = '' } = {}) {
  const r = await ask({ title, message, detail, ok, danger, fields: [] });
  return r !== null;
}

function close(result) {
  if (!cur) return;
  const r = cur.resolve;
  cur = null;
  rerender();
  r(result);
}

function submit(choice) {
  if (!cur) return;
  if (cur.opts.choices && choice === undefined) choice = cur.opts.choices[cur.opts.choices.length - 1][0];
  const { opts, values } = cur;
  for (const f of opts.fields || []) {
    if (f.required && !String(values[f.key] || '').trim()) { cur.error = `「${f.label}」を入力してください`; rerender(); return; }
  }
  if (opts.validate) {
    const err = opts.validate(values);
    if (err) { cur.error = err; rerender(); return; }
  }
  const out = {};
  for (const k in values) out[k] = typeof values[k] === 'string' ? values[k].trim() : values[k];
  if (choice !== undefined) out.choice = choice;
  close(out);
}

export function isDialogOpen() { return !!cur; }

export function DialogView() {
  if (!cur) return [];
  const { opts, values } = cur;
  const fields = opts.fields || [];
  return h('div', {
    class: 'overlay dialog-layer',
    onclick: (e) => { if (e.target.classList.contains('overlay')) close(null); },
    onkeydown: (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !e.isComposing) { e.preventDefault(); submit(); }
    },
  },
    h('form', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', onsubmit: (e) => { e.preventDefault(); submit(); } },
      opts.title ? h('h2', null, opts.title) : null,
      opts.message ? h('p', { class: 'dlg-msg' }, opts.message) : null,
      opts.detail ? h('p', { class: 'muted small' }, opts.detail) : null,
      fields.map((f, i) => f.type === 'checkbox'
        ? h('label', { key: f.key, class: 'check-field' },
          h('input', { type: 'checkbox', checked: !!values[f.key], onchange: (e) => { values[f.key] = e.target.checked; } }),
          h('span', null, f.label),
          f.hint ? h('small', { class: 'muted' }, f.hint) : null)
        : h('label', { key: f.key, class: 'field' },
        h('span', null, f.label),
        f.type === 'textarea'
          ? h('textarea', { rows: f.rows || 4, value: values[f.key], placeholder: f.placeholder || '', oninput: (e) => { values[f.key] = e.target.value; }, ref: i === 0 ? (el) => el.focus() : null })
          : f.type === 'select'
            ? h('select', { value: values[f.key], onchange: (e) => { values[f.key] = e.target.value; } }, f.options.map(([v, l]) => h('option', { value: v }, l)))
            : h('input', {
              value: values[f.key], placeholder: f.placeholder || '', autocomplete: 'off',
              oninput: (e) => { values[f.key] = e.target.value; if (cur.error) { cur.error = ''; rerender(); } },
              ref: i === 0 ? (el) => { el.focus(); el.select(); } : null,
            }),
        f.hint ? h('small', { class: 'muted' }, f.hint) : null)),
      cur.error ? h('div', { class: 'dlg-err' }, cur.error) : null,
      h('div', { class: 'actions end' },
        opts.cancel === false ? null : h('button', { type: 'button', class: 'btn ghost', onclick: () => close(null) }, opts.cancel || 'キャンセル'),
        opts.choices
          ? opts.choices.map(([v, label], i) => h('button', { key: 'c' + i, type: 'button', class: 'btn ' + (i === opts.choices.length - 1 ? 'primary' : ''), onclick: () => submit(v) }, label))
          : h('button', { type: 'submit', class: 'btn ' + (opts.danger ? 'danger-fill' : 'primary'), ref: fields.length ? null : (el) => el.focus() }, opts.ok || 'OK'))));
}
