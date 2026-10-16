/**
 * 舞台図解メーカー：Googleグループのメンバー一覧を読み取るウェブアプリ
 *
 * 共有画面で「〇〇@googlegroups.com」を追加したときに、小さなウィンドウでこのページが開きます。
 * 開いた本人のGoogleアカウントの権限でグループのメンバー一覧を読み、サイトに戻して渡します。
 * （本人がメンバー一覧を見られるグループだけが読めます）
 *
 * デプロイ方法は README.md の「手順6」を見てください。
 */

// ▼ サイトのアドレス（https:// から .io まで。最後の / や /zukai は付けない）
const ALLOWED_ORIGIN = 'https://kanqlabo-web.github.io';
// ▲

function doGet(e) {
  const p = (e && e.parameter) || {};
  const back = String(p.r || '');
  const nonce = String(p.n || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
  // 決めたサイト以外には結果を渡さない
  if (back.indexOf(ALLOWED_ORIGIN + '/') !== 0) {
    return HtmlService.createHtmlOutput('<p>このページは舞台図解メーカーの共有画面から開いてください。</p>');
  }
  const groups = String(p.g || '').split(',')
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(function (s) { return /^[^@\s]+@googlegroups\.com$/.test(s); })
    .slice(0, 10);
  const result = {};
  groups.forEach(function (addr) {
    try {
      const users = GroupsApp.getGroupByEmail(addr).getUsers();
      result[addr] = {
        ok: true,
        members: users.map(function (u) { return String(u.getEmail() || '').toLowerCase().trim(); })
          .filter(function (x) { return x; }),
      };
    } catch (err) {
      result[addr] = { ok: false, error: String((err && err.message) || err).slice(0, 200) };
    }
  });
  const target = back + '#/gresult/' + encodeURIComponent(JSON.stringify({ n: nonce, groups: result }));
  const t = JSON.stringify(target).replace(/</g, '\\u003c');
  const html =
    '<!doctype html><meta charset="utf-8">' +
    '<body style="font-family:sans-serif;padding:24px;text-align:center;line-height:1.7">' +
    '<p>グループを確認しました。</p>' +
    '<p><a id="go" target="_top" style="display:inline-block;padding:10px 20px;background:#3d3577;color:#fff;border-radius:8px;text-decoration:none">サイトに戻る</a></p>' +
    '<script>var t=' + t + ';document.getElementById("go").href=t;try{window.top.location.href=t;}catch(e){}</script>';
  return HtmlService.createHtmlOutput(html).setTitle('グループの確認');
}
