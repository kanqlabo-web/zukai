/**
 * 舞台図解メーカー：Googleグループのメンバー一覧を同期するスクリプト
 *
 * 作品の共有画面で「〇〇@googlegroups.com」を入力したときに、
 * そのグループのメンバー全員をまとめて追加できるようにするためのものです。
 * 下の GROUPS に書いたグループのメンバー一覧を、1時間ごとにデータベースへ書き込みます。
 * （一覧を読めるのは、そのグループのメンバー本人だけです）
 *
 * 使い方は README.md の「手順6」を見てください。
 */

// ▼ ここを書き換えてください
const GROUPS = [
  'グループのアドレス@googlegroups.com',
  // '2つ目のグループ@googlegroups.com',
];
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
  if (code >= 300) {
    throw new Error('Firestore ' + method + ' ' + path + ' → ' + code + ': ' + res.getContentText().slice(0, 500));
  }
  const text = res.getContentText();
  return text ? JSON.parse(text) : {};
}

/** グループのメンバー一覧を同期する（1時間ごとに自動で実行されます） */
function syncGroups() {
  GROUPS.forEach(function (addr) {
    const groupEmail = String(addr).toLowerCase().trim();
    const group = GroupsApp.getGroupByEmail(groupEmail);
    const emails = group.getUsers().map(function (u) { return String(u.getEmail() || '').toLowerCase().trim(); })
      .filter(function (e) { return e; });
    request_('patch', '/groups/' + encodeURIComponent(groupEmail), {
      fields: {
        members: { arrayValue: { values: emails.map(function (e) { return { stringValue: e }; }) } },
        count: { integerValue: String(emails.length) },
        at: { integerValue: String(Date.now()) },
      },
    });
    Logger.log(groupEmail + '：' + emails.length + '人');
  });
}

/** 最初に1回だけ実行：今すぐ同期して、1時間ごとの自動実行を登録します */
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncGroups' || t.getHandlerFunction() === 'syncMembers') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncGroups').timeBased().everyHours(1).create();
  syncGroups();
  Logger.log('設定が終わりました。これから1時間ごとに自動で同期します。');
}
