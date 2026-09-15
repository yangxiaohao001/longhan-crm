/* ============================================================
   reminders.js — 提醒中心（重写版）
   四类 tab：跟进 / 收款 / 报价到期 / 异常预警；去处理跳转 + 标记已处理
   ============================================================ */
'use strict';
(function () {
  const root = document.getElementById('pageRoot');
  const sess = App.session();
  const state = { type: '全部' };

  const TYPES = [
    { key: '全部', label: '全部' },
    { key: 'follow', label: '待跟进' },
    { key: 'payment', label: '该收款' },
    { key: 'quote', label: '报价到期' },
    { key: 'alert', label: '异常预警' },
  ];

  function jumpTarget(r) {
    if (r.type === 'quote') return 'quotes.html';
    if (r.type === 'payment') return 'orders.html?oid=' + r.refId;
    if (r.type === 'follow') return 'customers.html?cid=' + r.refId;
    return r.refId && r.refId[0] === 'o' ? 'orders.html?oid=' + r.refId : 'customers.html?cid=' + r.refId;
  }

  async function renderList() {
    root.innerHTML = '<div class="skeleton s-block"></div>';
    const filters = {};
    if (state.type !== '全部') filters.type = state.type;
    if (!App.seeAll()) filters.owner = sess.userId;
    const res = await fetchReminders(filters);
    if (res.code !== 0) { root.innerHTML = '<div class="empty"><p>' + App.escapeHtml(res.msg) + '</p></div>'; return; }
    const list = res.data;

    root.innerHTML =
      '<div class="card"><div class="card-head">' +
      '<div class="chip-row">' + TYPES.map(t =>
        '<button class="chip' + (state.type === t.key ? ' active' : '') + '" data-t="' + t.key + '">' + t.label + '</button>').join('') + '</div>' +
      '</div><div class="card-body">' +
      (list.length ? list.map(r => {
        const m = App.remindTypeMeta[r.type] || {};
        const overdue = r.dueInDays < 0 && r.status === 'pending';
        return '<div class="kcard" style="margin-bottom:12px;cursor:default">' +
          '<div style="display:flex;align-items:flex-start;gap:12px">' +
          '<span class="nav-avatar" style="width:34px;height:34px"><span data-icon="' + m.icon + '"></span></span>' +
          '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b style="font-size:13.5px">' + App.escapeHtml(r.title) + '</b>' +
          '<span class="badge ' + m.cls + '">' + m.label + '</span>' +
          (r.status === 'done' ? '<span class="badge badge-success">已处理</span>'
            : overdue ? '<span class="overdue-tag">' + App.relDays(r.dueInDays) + '</span>'
            : '<span class="sub-line">' + App.relDays(r.dueInDays) + '</span>') + '</div>' +
          '<div class="sub-line" style="margin-top:5px">' + App.escapeHtml(r.detail) + '</div>' +
          '<div class="sub-line">对象：' + App.escapeHtml(r.refName) + ' · 负责人：' + App.escapeHtml(r.ownerName) + ' · 到期 ' + r.dueDate + '</div>' +
          '</div>' +
          (r.status === 'pending'
            ? '<div class="row-actions"><button class="btn btn-sm btn-primary" data-go="' + r.id + '">去处理</button>' +
            '<button class="btn btn-sm" data-done="' + r.id + '">标记已处理</button></div>' : '') +
          '</div></div>';
      }).join('')
        : '<div class="empty"><span data-icon="check-circle"></span><p>太棒了，没有待处理提醒</p></div>') +
      '</div></div>';

    root.querySelectorAll('[data-t]').forEach(el => el.addEventListener('click', () => { state.type = el.dataset.t; renderList(); }));
    root.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => {
      const r = list.find(x => x.id === el.dataset.go);
      resolveReminder(r.id);
      location.href = jumpTarget(r);
    }));
    root.querySelectorAll('[data-done]').forEach(el => el.addEventListener('click', async () => {
      const r = await resolveReminder(el.dataset.done);
      if (r.code !== 0) return App.toast(r.msg, 'danger');
      App.toast('已标记处理'); renderList();
    }));
    App.mountIcons(root);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (!App.requireLogin()) return;
    /* 等待云端拉取（如果已配 Supabase） */
    if (App.bootstrapFromCloud) await App.bootstrapFromCloud();
    /* 等待 perm.js 挂载（最多 500ms） */
    await new Promise(r => {
      const t0 = Date.now();
      const w = () => (typeof App.canRoute === 'function') ? r() : (Date.now() - t0 < 3000 ? setTimeout(w, 30) : r());
      w();
    });
    await renderList();
  });
})();
