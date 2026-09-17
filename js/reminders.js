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
  if (App.isBoss()) TYPES.splice(1, 0, { key: 'boss', label: '总经理待办' });

  /* 总经理待办：动态聚合（不落库，处理完自动消失）——待审批报价 / 待审批采购 / 待发放工资 */
  function bossItems() {
    if (!App.isBoss()) return [];
    const out = [];
    const uname = id => ((DB.users || []).find(u => u.id === id) || {}).name || '';
    (DB.quotes || []).filter(q => q.status === '待审批').forEach(q => {
      const c = (DB.customers || []).find(x => x.id === (q.customerId || q.customer_id));
      out.push({
        id: 'sys-quote-' + q.id, type: 'boss', _sys: true, _jump: 'quotes.html',
        title: '报价待审批：' + (q.no || ''), status: 'pending', isRead: true,
        detail: '客户：' + (c ? c.name : '—') + ' · 业务员：' + uname(q.owner || q.owner_id),
        refName: '', ownerName: '', dueDate: '', dueInDays: 0,
      });
    });
    (DB.purchases || []).filter(x => x.status === '待审批').forEach(x => {
      out.push({
        id: 'sys-pur-' + x.id, type: 'boss', _sys: true, _jump: 'purchase.html',
        title: '采购待审批：' + (x.title || x.no || ''), status: 'pending', isRead: true,
        detail: '申请人：' + uname(x.requester || x.requester_id) + ' · 金额：¥' + ((x.items || []).reduce((s2, i2) => s2 + (Number(i2.qty) || 0) * (Number(i2.price) || 0), 0)).toFixed(2),
        refName: '', ownerName: '', dueDate: '', dueInDays: 0,
      });
    });
    const drafts = (DB.payrolls || []).filter(x => x.status === '草稿');
    if (drafts.length) {
      out.push({
        id: 'sys-payroll', type: 'boss', _sys: true, _jump: 'payroll.html',
        title: '工资待发放', status: 'pending', isRead: true,
        detail: '有 ' + drafts.length + ' 条工资记录未标记发放（含 ' + [...new Set(drafts.map(x2 => x2.month))].join('、') + '）',
        refName: '', ownerName: '', dueDate: '', dueInDays: 0,
      });
    }
    return out;
  }

  function jumpTarget(r) {
    if (r.type === 'boss') return r._jump || 'index.html';
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
    const list = res.data.concat((state.type === 'boss' || state.type === '全部') ? bossItems() : []);

    root.innerHTML =
      '<div class="card"><div class="card-head">' +
      '<div class="chip-row">' + TYPES.map(t =>
        '<button class="chip' + (state.type === t.key ? ' active' : '') + '" data-t="' + t.key + '">' + t.label + '</button>').join('') + '</div>' +
      '</div><div class="card-body">' +
      (list.length ? list.map(r => {
        const m = App.remindTypeMeta[r.type] || {};
        const overdue = r.dueInDays < 0 && r.status === 'pending';
        const unread = r.isRead !== true;
        return '<div class="kcard' + (unread ? ' rem-unread' : '') + '" style="margin-bottom:12px;cursor:default">' +
          '<div style="display:flex;align-items:flex-start;gap:12px">' +
          '<span class="nav-avatar" style="width:34px;height:34px"><span data-icon="' + m.icon + '"></span></span>' +
          '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          (unread ? '<span class="unread-dot" title="未读"></span>' : '') +
          '<b style="font-size:13.5px">' + App.escapeHtml(r.title) + '</b>' +
          '<span class="badge ' + m.cls + '">' + m.label + '</span>' +
          (unread ? '<span class="badge badge-danger">未读</span>' : '<span class="badge">已读</span>') +
          (r.status === 'done' ? '<span class="badge badge-success">已处理</span>'
            : overdue ? '<span class="overdue-tag">' + App.relDays(r.dueInDays) + '</span>'
            : '<span class="sub-line">' + App.relDays(r.dueInDays) + '</span>') + '</div>' +
          '<div class="sub-line" style="margin-top:5px">' + App.escapeHtml(r.detail) + '</div>' +
          '<div class="sub-line">对象：' + App.escapeHtml(r.refName) + ' · 负责人：' + App.escapeHtml(r.ownerName) + ' · 到期 ' + r.dueDate + '</div>' +
          '</div>' +
          '<div class="row-actions">' +
          (r.status === 'pending' ? '<button class="btn btn-sm btn-primary" data-go="' + r.id + '">去处理</button>' +
          (!r._sys ? '<button class="btn btn-sm" data-done="' + r.id + '">标记已处理</button>' : '') : '') +
          (!r._sys ? '<button class="btn btn-sm" data-read="' + r.id + '" data-to="' + (unread ? '1' : '0') + '">' + (unread ? '标记已读' : '标为未读') + '</button>' : '') +
          '</div>' +
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
    root.querySelectorAll('[data-read]').forEach(el => el.addEventListener('click', async () => {
      const r = await markReminderRead(el.dataset.read, el.dataset.to === '1');
      if (r.code !== 0) return App.toast(r.msg, 'danger');
      renderList();
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
