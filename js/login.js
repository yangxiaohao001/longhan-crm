/* login.js — 登录页：账号+密码（支持登录名/手机号） */
'use strict';
(function () {
  const selected = { uid: null };

  let _cloudUsers = null;   /* 云端拉到的最新账号列表 */
  async function renderUsers() {
    const box = document.getElementById('userList');
    /* 云模式：从云端拉账号列表（这样员工能选自己；本地模式走 DB） */
    if (App.dbMode && App.dbMode() === 'cloud' && App.dbList) {
      try {
        const list = await App.dbList('users');
        if (list && list.length) {
          _cloudUsers = list.map(u => ({
            id: u.id, name: u.name, userName: u.user_name || u.userName,
            position: u.position, pwd: u.pwd, initial: (u.name || '').slice(0, 1),
          }));
        }
      } catch (e) { /* 降级用本地 */ }
    }
    const users = _cloudUsers || DB.users;
    if (!users.length) {
      box.innerHTML = '<div class="view-banner" style="margin:0 0 10px"><span data-icon="user"></span>暂无账号</div>';
      return;
    }
    box.innerHTML = '<div class="view-banner" style="margin:0 0 10px"><span data-icon="user"></span>点击下方任一账号快速填充（' + (_cloudUsers ? '从云端同步' : '本地') + '）</div>' +
      users.map(u =>
        '<div class="login-user" data-uid="' + u.id + '">' +
        '<span class="nav-avatar">' + App.escapeHtml(u.initial || '?') + '</span>' +
        '<div><b>' + App.escapeHtml(u.name) + '</b><i>' + App.escapeHtml(u.position || '') + (u.userName ? ' · ' + u.userName : '') + '</i></div>' +
        '</div>').join('');
    box.querySelectorAll('.login-user').forEach(el => {
      el.addEventListener('click', () => {
        const u = users.find(x => x.id === el.dataset.uid);
        if (!u) return;
        selected.uid = u.id;
        document.getElementById('userInput').value = u.userName || u.phone || u.name;
        document.getElementById('pwdInput').value = u.pwd || '';
        box.querySelectorAll('.login-user').forEach(x => x.classList.toggle('active', x === el));
      });
    });
  }

  function fail(msg) {
    const err = document.getElementById('pwdErr');
    document.getElementById('userInput').classList.add('err');
    document.getElementById('pwdInput').classList.add('err');
    err.textContent = msg; err.classList.add('show');
  }
  function clearErr() {
    document.getElementById('userInput').classList.remove('err');
    document.getElementById('pwdInput').classList.remove('err');
    document.getElementById('pwdErr').classList.remove('show');
  }

  async function doLogin() {
    clearErr();
    const userVal = document.getElementById('userInput').value.trim();
    const pwd = document.getElementById('pwdInput').value.trim();
    if (!userVal) return fail('请填写账号');
    if (!pwd) return fail('请填写密码');
    App.btnLoading(document.getElementById('loginBtn'));
    const res = await login(userVal, pwd);
    App.btnDone(document.getElementById('loginBtn'));
    if (res.code !== 0) { fail(res.msg); return; }
    /* 落到第一个有权限的页面（没有 dashboard 权限就不落首页，避免空白被困） */
    let dest = 'index.html';
    try {
      const sess = JSON.parse(localStorage.getItem('lh-crm-session') || '{}');
      if (sess.position !== '总经理') {
        const order = [['dashboard', 'index.html'], ['customers', 'customers.html'], ['quotes', 'quotes.html'],
          ['orders', 'orders.html'], ['payments', 'payments.html'], ['finance', 'finance.html'],
          ['purchase', 'purchase.html'], ['reminders', 'reminders.html']];
        const hit = order.find(([k]) => (sess.scopes || []).includes(k));
        if (hit) dest = hit[1];
      }
    } catch (e) { /* ignore */ }
    location.replace(dest);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (App.session()) { logout(); }
    /* 等账号列表渲染完（云端拉取是异步的），否则 .login-user 不存在会崩掉按钮绑定 */
    await renderUsers();
    const users = _cloudUsers || DB.users;
    const u = users[0];
    if (u) {
      selected.uid = u.id;
      document.getElementById('userInput').value = u.userName || '';
      document.getElementById('pwdInput').value = u.pwd || '';
      const first = document.querySelector('.login-user');
      if (first) first.classList.add('active');
    }
    document.getElementById('loginBtn').addEventListener('click', doLogin);
    document.getElementById('pwdInput').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    document.getElementById('userInput').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  });
})();
