// 全体の「元に戻す・やり直す」（画面のボタン・Ctrl+Z から使う）
import { h } from './vdom.js';
import { icon } from './icons.js';
import { history } from './db.js';
import { toast } from './state.js';
import { confirmBox } from './dialog.js';

const ask = () => confirmBox('この変更のあとに、ほかの人（または別の画面）が同じところを書き換えています。\n戻すと、その書き換えも消えます。', { ok: 'それでも戻す', danger: true });

export async function undoAll() {
  if (!history.canUndo()) return;
  try { if (await history.undo(ask)) toast('元に戻しました'); } catch (e) { toast('元に戻せませんでした: ' + (e.message || e), 'error'); }
}
export async function redoAll() {
  if (!history.canRedo()) return;
  try { if (await history.redo(ask)) toast('やり直しました'); } catch (e) { toast('やり直せませんでした: ' + (e.message || e), 'error'); }
}

export function UndoButtons(cls = 'icon-btn') {
  return [
    h('button', { class: cls, title: '元に戻す（Ctrl+Z）', 'aria-label': '元に戻す', disabled: !history.canUndo(), onclick: undoAll }, icon('undo')),
    h('button', { class: cls, title: 'やり直す（Ctrl+Shift+Z）', 'aria-label': 'やり直す', disabled: !history.canRedo(), onclick: redoAll }, icon('redo')),
  ];
}
