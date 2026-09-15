/* login.js — 登录页：账号+密码（支持登录名/手机号） */
'use strict';
(function () {
  const selected = { uid: null };

  function renderUsers() {
    const box = document.getElementById('userList');
    box.innerHTML = '<div class="view-banner" style="margin:0 0 10px"><span data-icon="user"></span>点击下方任一账号快速填充</div>' +
      DB.users.map(u =>
        '<div class="login-user" data-uid="' + u.id + '">' +
        '<span class="nav-avatar">' + u.initial + '</span>' +
        '<div><b>' + App.escapeHtml(u.name) + '</b><i>' + App.escapeHtml(u.position) + (u.userName ? ' · ' + u.userName : '') + '</i></div>' +
        '</div>').join('');
    box.querySelectorAll('.login-user').forEach(el => {
      el.addEventListener('click', () => {
        const u = DB.users.find(x => x.id === el.dataset.uid);
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
    location.replace('index.html');
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (App.session()) { logout(); }
    renderUsers();
    /* 默认预填 admin */
    const u = DB.users[0];
    if (u) {
      selected.uid = u.id;
      document.getElementById('userInput').value = u.userName || '';
      document.getElementById('pwdInput').value = u.pwd || '';
      document.querySelector('.login-user').classList.add('active');
    }
    document.getElementById('loginBtn').addEventListener('click', doLogin);
    document.getElementById('pwdInput').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    document.getElementById('userInput').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  });
})();
