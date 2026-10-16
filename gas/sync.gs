/**
 * 舞台図解メーカー：Googleグループのメンバーを「ログインできる人」に自動で反映するスクリプト
 *
 * ・グループにいる人 → ログインできる人に追加（役割は「編集者」）
 * ・グループから抜けた人 → このスクリプトが追加した人だけ削除
 * ・管理者と、アカウント管理画面で手動追加した人は変更しません
 *
 * 使い方は README.md の「手順6」を見てください。
 */

// ▼ ここを書き換えてください
const GROUP_EMAIL = 'グループのアドレス@googlegroups.com';
const PROJECT_ID = 'FirebaseのプロジェクトID';
// ▲ ここまで

const BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents';

function request_(method, path, body) {
  const res = UrlFetchApp.fetch(BASE + path, {
    method: method,
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'x-goog-user-project': PROJECT_ID,
    },
    payload: body ? JSON.stringify(body) : undefined,
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code >= 300 && !(method === 'delete' && code === 404)) {
    throw new Error('Firestore ' + method + ' ' + path + ' → ' + code + ': ' + res.getContentText().slice(0, 500));
  }
  const text = res.getContentText();
  return text ? JSON.parse(text) : {};
}

function str_(v) { return { stringValue: String(v) }; }
function int_(v) { return { integerValue: String(Math.round(v)) }; }

function listMembers_() {
  const out = {};
  let token = '';
  do {
    const r = request_('get', '/members?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    (r.documents || []).forEach(function (d) {
      const id = decodeURIComponent(d.name.split('/').pop());
      const f = d.fields || {};
      out[id] = {
        role: f.role ? f.role.stringValue : 'member',
        source: f.source ? f.source.stringValue : 'manual',
      };
    });
    token = r.nextPageToken || '';
  } while (token);
  return out;
}

/** メンバーを同期する（1時間ごとに自動で実行されます） */
function syncMembers() {
  try { request_('get', '/meta/setup'); } catch (e) {
    throw new Error('先にサイトを開いてログインし、「このアカウントを管理者にする」を押してください（README 手順5）。詳細: ' + e.message);
  }
  const group = GroupsApp.getGroupByEmail(GROUP_EMAIL);
  const emails = {};
  group.getUsers().forEach(function (u) {
    const e = String(u.getEmail() || '').toLowerCase().trim();
    if (e) emails[e] = true;
  });
  const current = listMembers_();
  const now = Date.now();
  let added = 0, removed = 0;

  // まだ登録されていない人を追加
  Object.keys(emails).forEach(function (e) {
    if (current[e]) return;
    request_('patch', '/members/' + encodeURIComponent(e), {
      fields: { role: str_('member'), source: str_('group'), name: str_(''), addedAt: int_(now), addedBy: str_('Googleグループ同期') },
    });
    added++;
  });

  // グループから抜けた人を削除（このスクリプトが追加した編集者だけ）
  Object.keys(current).forEach(function (e) {
    const m = current[e];
    if (emails[e] || m.source !== 'group' || m.role === 'admin') return;
    request_('delete', '/members/' + encodeURIComponent(e));
    removed++;
  });

  // 同期の記録（アカウント管理画面に表示されます）
  request_('patch', '/meta/groupSync', {
    fields: { at: int_(now), group: str_(GROUP_EMAIL), count: int_(Object.keys(emails).length), added: int_(added), removed: int_(removed) },
  });
  Logger.log('グループ ' + Object.keys(emails).length + '人 / 追加 ' + added + '人 / 削除 ' + removed + '人');
}

/** 最初に1回だけ実行：今すぐ同期して、1時間ごとの自動実行を登録します */
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncMembers') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncMembers').timeBased().everyHours(1).create();
  syncMembers();
  Logger.log('設定が終わりました。これから1時間ごとに自動で同期します。');
}
