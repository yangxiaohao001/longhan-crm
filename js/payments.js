/* ============================================================
   payments.js — 回款与应收（重写版）
   KPI + 应收账款明细 + 回款流水 + 登记回款
   角色：财务/老板可登记回款；业务员查看自己客户的应收并催收
   ============================================================ */
'use strict';
(function () {
  const root = document.getElementById('pageRoot');
  const sess = App.session();
  const state = { kw: '', month: '' };

  async function renderList() {
    root.innerHTML = '<div class="skeleton s-block"></div>';
    const [recv, pays] = await Promise.all([fetchReceivables(), fetchPayments({})]);
    if (recv.code !== 0) { root.innerHTML = '<div class="empty"><p>' + App.escapeHtml(recv.msg) + '</p></div>'; return; }
    const k = recv.data.kpis;
    let rows = recv.data.rows;
    if (!App.seeAll()) rows = rows.filter(r => r.ownerId === sess.userId);
    const kw = state.kw.trim();
    rows = rows.filter(r => !kw || r.no.includes(kw) || r.customerName.includes(kw));
    let payList = pays.data;
    if (!App.seeAll()) payList = payList.filter(p => {
      const c = App.customerById(p.customerId);
      return c && c.owner === sess.userId;
    });
    if (state.month) payList = payList.filter(p => p.date.slice(0, 7) === state.month);
    const canPay = App.can('payment.edit');

    /* 月份下拉（近 6 个月） */
    const months = [...new Set(pays.data.map(p => p.date.slice(0, 7)))].sort().reverse();

    root.innerHTML =
      (canPay ? '' : '<div class="view-banner"><span data-icon="phone-call"></span>业务员视角：欠款明细用于催收跟进，回款登记由财务操作</div>') +

      '<div class="grid grid-kpi" style="margin-bottom:16px">' +
      '<div class="kpi"><div class="kpi-label"><span data-icon="circle-dollar-sign"></span>应收总额</div><div class="kpi-value warn" data-count="' + k.receivableTotal + '">—</div><div class="kpi-foot"><span class="kpi-delta">' + k.receivableCount + ' 笔未结</span></div></div>' +
      '<div class="kpi"><div class="kpi-label"><span data-icon="alert-triangle"></span>逾期金额</div><div class="kpi-value danger" data-count="' + k.overdueTotal + '">—</div><div class="kpi-foot"><span class="kpi-delta">' + k.overdueCount + ' 笔逾期</span></div></div>' +
      '<div class="kpi"><div class="kpi-label"><span data-icon="wallet"></span>本月回款</div><div class="kpi-value success" data-count="' + k.monthPayment + '">—</div></div>' +
      '<div class="kpi"><div class="kpi-label"><span data-icon="coins"></span>待收定金</div><div class="kpi-value warn" data-count="' + k.depositPending + '">—</div><div class="kpi-foot"><span class="kpi-delta">收定金后才能排产</span></div></div>' +
      '</div>' +

      '<div class="card" style="margin-bottom:16px"><div class="card-head"><div class="card-title">应收欠款明细</div>' +
      '<div class="card-tools"><div class="search-box"><span data-icon="search"></span>' +
      '<input class="input" id="kwInput" placeholder="搜订单 / 客户" style="width:200px" value="' + App.escapeHtml(state.kw) + '"></div></div></div>' +
      '<div class="card-body table-wrap"><table class="table">' +
      '<thead><tr><th>订单</th><th>客户</th>' + (App.seeAll() ? '<th>业务员</th>' : '') + '<th>订单金额</th><th>已收</th><th>欠款</th><th>约定付款日</th><th>状态</th><th></th></tr></thead><tbody>' +
      (rows.length ? rows.map(r =>
        '<tr><td><span class="row-link" data-oid="' + r.orderId + '">' + r.no + '</span></td>' +
        '<td>' + App.escapeHtml(r.customerName) + '</td>' +
        (App.seeAll() ? '<td>' + App.escapeHtml(r.ownerName) + '</td>' : '') +
        '<td class="money">' + App.fmtMoney(r.amount) + '</td>' +
        '<td class="money success">' + App.fmtMoney(r.paid) + '</td>' +
        '<td class="money ' + (r.balance > 0 ? 'balance' : 'success') + '">' + App.fmtMoney(r.balance) + '</td>' +
        '<td>' + (r.paymentDue || '—') + (r.overdueDays > 0 ? ' <span class="overdue-tag">逾期 ' + r.overdueDays + ' 天</span>' : '') + '</td>' +
        '<td>' + App.badge(r.status, App.orderStatusMeta[r.status]) + '</td>' +
        '<td>' + (canPay ? '<button class="btn btn-sm btn-primary" data-pay="' + r.orderId + '"><span data-icon="wallet"></span>登记回款</button>' : '') + '</td>' +
        '</tr>').join('')
        : '<tr><td colspan="9"><div class="empty"><span data-icon="check-circle"></span><p>没有未结订单，回款已全部收齐</p></div></td></tr>') +
      '</tbody></table></div></div>' +

      '<div class="card"><div class="card-head"><div class="card-title">回款流水</div>' +
      '<div class="card-tools"><select class="select" id="monthSel" style="width:130px"><option value="">全部月份</option>' +
      months.map(m => '<option' + (state.month === m ? ' selected' : '') + '>' + m + '</option>').join('') + '</select></div></div>' +
      '<div class="card-body table-wrap"><table class="table">' +
      '<thead><tr><th>日期</th><th>订单</th><th>客户</th><th>类型</th><th>金额</th><th>方式</th><th>记录人</th><th>备注</th></tr></thead><tbody>' +
      (payList.length ? payList.map(p =>
        '<tr><td>' + p.date + '</td><td><span class="row-link" data-oid2="' + p.orderId + '">' + p.orderNo + '</span></td>' +
        '<td>' + App.escapeHtml(p.customerName) + '</td>' +
        '<td>' + App.badge(p.type, App.payTypeMeta[p.type]) + '</td>' +
        '<td class="money success">' + App.fmtMoney(p.amount) + '</td>' +
        '<td>' + p.method + '</td><td>' + App.escapeHtml(p.recorderName) + '</td>' +
        '<td class="sub-line">' + App.escapeHtml(p.note || '') + '</td></tr>').join('')
        : '<tr><td colspan="8"><div class="empty"><span data-icon="inbox"></span><p>暂无回款记录</p></div></td></tr>') +
      '</tbody></table></div></div>';

    root.querySelectorAll('.kpi-value[data-count]').forEach(el => App.countUp(el, Number(el.dataset.count)));
    root.querySelectorAll('[data-oid], [data-oid2]').forEach(el =>
      el.addEventListener('click', () => location.href = 'orders.html?oid=' + (el.dataset.oid || el.dataset.oid2)));
    root.querySelectorAll('[data-pay]').forEach(el => el.addEventListener('click', () => payModal(el.dataset.pay)));
    const kwEl = root.querySelector('#kwInput');
    let t;
    kwEl.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.kw = kwEl.value; renderList(); }, 300); });
    root.querySelector('#monthSel').addEventListener('change', e => { state.month = e.target.value; renderList(); });
    App.mountIcons(root);
  }

  /* 登记回款（与 orders.js 同一交互，独立实现避免跨页依赖） */
  async function payModal(oid) {
    const res = await fetchOrderDetail(oid);
    if (res.code !== 0) return App.toast(res.msg, 'danger');
    const o = res.data;
    if (o.balance <= 0) return App.toast('该订单已结清', 'info');
    const opts = o.paid === 0 ? ['定金'] : ['尾款', '部分尾款'];
    App.openModal({
      title: '登记回款 · ' + o.no,
      html:
        '<div class="form-hint" style="margin-bottom:12px">应收余额 <b class="money warn">' + App.fmtMoney(o.balance) + '</b>，客户：' + App.escapeHtml(o.customerName) + '</div>' +
        '<div class="field"><label>回款类型</label><select class="select" id="pType">' + opts.map(t => '<option>' + t + '</option>').join('') + '</select></div>' +
        '<div class="form-grid">' +
        '<div class="form-item"><label>金额（元）<b>*</b></label><input class="input num" id="pAmt" type="number" min="1" step="0.01" value="' + o.balance + '"><p class="form-error"></p></div>' +
        '<div class="form-item"><label>到账日期</label><input class="input" id="pDate" type="date" value="' + App.today + '"></div>' +
        '<div class="form-item"><label>收款方式</label><select class="select" id="pMethod"><option>对公转账</option><option>银行承兑</option><option>微信转账</option></select></div>' +
        '<div class="form-item"><label>备注</label><input class="input" id="pNote" placeholder="选填"></div>' +
        '</div>',
      foot: '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">确认到账</button>',
      onMount(box) {
        box.querySelector('[data-act="cancel"]').addEventListener('click', () => App.closeModal());
        box.querySelector('[data-act="ok"]').addEventListener('click', async e => {
          const btn = e.currentTarget;
          const amtEl = box.querySelector('#pAmt');
          App.formClear(amtEl);
          const amt = Number(amtEl.value);
          if (!amt || amt <= 0) return App.formError(amtEl, '请填写正确的金额');
          if (amt > o.balance + 0.001) return App.formError(amtEl, '不能超过应收余额 ' + App.fmtMoney(o.balance));
          App.btnLoading(btn);
          const r = await savePayment({
            orderId: o.id, amount: amt, type: box.querySelector('#pType').value,
            date: box.querySelector('#pDate').value, method: box.querySelector('#pMethod').value,
            note: box.querySelector('#pNote').value, recorder: sess.userId,
          });
          App.btnDone(btn);
          if (r.code !== 0) return App.toast(r.msg, 'danger');
          App.closeModal();
          App.toast(r.data.settled ? '回款登记成功，尾款已结清并结案' : '回款登记成功');
          renderList();
        });
      },
    });
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
