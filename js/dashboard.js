/* ============================================================
   dashboard.js — 角色化驾驶舱
   老板：全公司经营看板；财务：回款/应收看板；业务员：我的业绩 + 快捷入口
   数据一律经 api.js：fetchDashboardSummary / fetchReceivables / fetchQuotes
   ============================================================ */
'use strict';
(function () {
  const root = document.getElementById('pageRoot');
  const sess = App.session();

  const kpiCard = (label, icon, value, opts) =>
    '<div class="kpi"><div class="kpi-label"><span data-icon="' + icon + '"></span>' + label + '</div>' +
    '<div class="kpi-value ' + ((opts && opts.cls) || '') + '" data-count="' + value + '"' + ((opts && opts.plain) ? ' data-int="1"' : '') + '>—</div>' +
    '<div class="kpi-foot"><span class="kpi-delta">' + ((opts && opts.delta) || '') + '</span>' +
    ((opts && opts.spark) ? App.sparkline(opts.spark) : '') + '</div></div>';

  /* 收支/成交双序列柱状图（纯 SVG，零依赖） */
  function barChart(labels, s1, s2, name1, name2) {
    const w = 560, h = 180, pad = 26;
    const max = Math.max.apply(null, s1.concat(s2)) || 1;
    const bw = (w - pad * 2) / labels.length * 0.32;
    const x0 = i => pad + (w - pad * 2) / labels.length * (i + 0.5);
    const y = v => h - pad - v / max * (h - pad * 1.6);
    const bar = (i, v, off, cls) =>
      '<rect x="' + (x0(i) + off).toFixed(1) + '" y="' + y(v).toFixed(1) + '" width="' + bw.toFixed(1) +
      '" height="' + (h - pad - y(v)).toFixed(1) + '" rx="3" class="' + cls + '"/>';
    let svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:auto">';
    for (let g = 0; g <= 3; g++) {
      const gy = pad + (h - pad * 1.6) * g / 3;
      svg += '<line x1="' + pad + '" x2="' + (w - 8) + '" y1="' + gy + '" y2="' + gy + '" stroke="rgba(120,150,190,.12)"/>';
      svg += '<text x="2" y="' + (gy + 4) + '" fill="#5f7189" font-size="9" font-family="var(--font-mono)">' + App.fmtWan(max * (3 - g) / 3) + '</text>';
    }
    labels.forEach((lb, i) => {
      svg += bar(i, s1[i], -bw - 1, 'cbar-1');
      svg += bar(i, s2[i], 1, 'cbar-2');
      svg += '<text x="' + x0(i) + '" y="' + (h - 8) + '" fill="#5f7189" font-size="10" text-anchor="middle">' + lb + '</text>';
    });
    svg += '</svg><div class="chart-legend" style="margin-top:8px">' +
      '<span><i style="background:var(--chart-1)"></i>' + name1 + '</span>' +
      '<span><i style="background:var(--chart-3)"></i>' + name2 + '</span></div>';
    return svg;
  }

  function renderBoss(d) {
    const k = d.kpis;
    root.innerHTML =
      '<div class="grid grid-kpi" style="margin-bottom:16px">' +
      kpiCard('本月成交额', 'trending-up', k.monthDealAmount, { cls: 'success', spark: d.spark.deal, delta: (k.monthDealDeltaPct >= 0 ? '▲ ' : '▼ ') + Math.abs(k.monthDealDeltaPct) + '% 环比' }) +
      kpiCard('本月回款', 'wallet', k.monthPayment, { cls: '', spark: d.spark.payment }) +
      kpiCard('应收欠款', 'circle-dollar-sign', k.receivableTotal, { cls: 'warn', spark: d.spark.receivable, delta: k.receivableCount + ' 笔未结' }) +
      kpiCard('逾期金额', 'alert-triangle', k.overdueTotal, { cls: 'danger', delta: k.overdueCount + ' 笔逾期' }) +
      kpiCard('本月新签订单', 'clipboard-list', k.monthOrderCount, { spark: d.spark.orders, plain: true }) +
      kpiCard('本月新增客户', 'user-plus', k.newCustomerCount, { spark: d.spark.newCust, plain: true }) +
      '</div>' +

      '<div class="grid grid-2" style="margin-bottom:16px">' +
      '<div class="card"><div class="card-head"><div><div class="card-title">成交 · 回款趋势</div><div class="card-sub">近 6 个月</div></div></div>' +
      '<div class="card-body">' + barChart(d.trend.labels, d.trend.deal, d.trend.payment, '成交额', '回款额') + '</div></div>' +
      '<div class="card"><div class="card-head"><div class="card-title">业务员业绩排名</div><div class="card-sub">本月下单口径</div></div>' +
      '<div class="card-body">' +
      d.ranking.map((r, i) => {
        const maxAmt = d.ranking[0].amount || 1;
        return '<div class="rank-row"><span class="rank-no">' + (i + 1) + '</span>' +
          '<span class="rank-name">' + App.escapeHtml(r.name) + '</span>' +
          '<div class="rank-bar"><i style="width:' + Math.round(r.amount / maxAmt * 100) + '%"></i></div>' +
          '<span class="rank-amt money">' + (r.amount ? App.fmtWan(r.amount) : '—') + '</span></div>';
      }).join('') +
      '</div></div>' +
      '</div>' +

      '<div class="grid grid-3">' +
      '<div class="card"><div class="card-head"><div class="card-title">订单阶段分布</div></div><div class="card-body">' +
      d.stageDist.map(s => {
        const total = d.stageDist.reduce((a, x) => a + x.count, 0) || 1;
        return '<div class="prod-row"><div class="prod-top"><b>' + s.stage + '</b><span>' + s.count + ' 单</span></div>' +
          '<div class="progress"><i style="width:' + Math.round(s.count / total * 100) + '%"></i></div></div>';
      }).join('') + '</div></div>' +

      '<div class="card"><div class="card-head"><div class="card-title">待跟进客户</div><div class="card-sub">7 天内</div></div><div class="card-body">' +
      (d.dueFollows.length ? d.dueFollows.map(f =>
        '<div class="rank-row" style="cursor:pointer" data-cid="' + f.customerId + '">' +
        '<div style="flex:1;min-width:0"><b style="font-size:13px">' + App.escapeHtml(f.name) + '</b>' +
        '<div class="sub-line">' + App.escapeHtml(f.ownerName) + ' · ' + App.relDays(f.inDays) + '</div></div>' +
        (f.overdue ? '<span class="overdue-tag still">断联</span>' : App.badge(f.stage, App.stageMeta[f.stage])) + '</div>').join('')
        : '<div class="empty"><span data-icon="check-circle"></span><p>暂无待跟进</p></div>') +
      '</div></div>' +

      '<div class="card"><div class="card-head"><div class="card-title">超期未跟进预警</div><div class="card-sub">超过 14 天</div></div><div class="card-body">' +
      (d.overdueFollows.length ? d.overdueFollows.slice(0, 6).map(f =>
        '<div class="rank-row"><div style="flex:1;min-width:0"><b style="font-size:13px">' + App.escapeHtml(f.name) + '</b>' +
        '<div class="sub-line">' + App.escapeHtml(f.ownerName) + ' · 上次 ' + f.lastFollow + '</div></div>' +
        '<span class="overdue-tag still">' + f.daysSinceLast + ' 天</span></div>').join('')
        : '<div class="empty"><span data-icon="check-circle"></span><p>无超期跟进</p></div>') +
      '</div></div>' +
      '</div>';

    /* 待审批入口（老板） */
    if (App.can('quote.approve')) {
      fetchQuotes({ status: '待审批' }).then(res => {
        if (res.code !== 0 || !res.data.length) return;
        const banner = App.el('<div class="view-banner" style="cursor:pointer"><span data-icon="alert-circle"></span>' +
          res.data.length + ' 份调价报价等你审批' + '</div>');
        banner.addEventListener('click', () => location.href = 'quotes.html');
        root.prepend(banner); App.mountIcons(root);
      });
    }
  }

  function renderFinance() {
    root.innerHTML = '<div class="skeleton s-block"></div><div class="skeleton s-block"></div>';
    Promise.all([fetchReceivables(), fetchFinanceSummary()]).then(([recv, fin]) => {
      const k = recv.data.kpis, f = fin.data.kpis;
      root.innerHTML =
        '<div class="grid grid-kpi" style="margin-bottom:16px">' +
        kpiCard('应收总额', 'circle-dollar-sign', k.receivableTotal, { cls: 'warn', delta: k.receivableCount + ' 笔未结' }) +
        kpiCard('逾期金额', 'alert-triangle', k.overdueTotal, { cls: 'danger', delta: k.overdueCount + ' 笔逾期' }) +
        kpiCard('本月回款', 'wallet', k.monthPayment) +
        kpiCard('待收定金', 'coins', k.depositPending, { cls: 'warn' }) +
        kpiCard('本月收入', 'trending-up', f.income, { cls: 'success' }) +
        kpiCard('本月支出', 'trending-down', f.expense, { cls: 'danger' }) +
        '</div>' +
        '<div class="card"><div class="card-head"><div class="card-title">应收欠款明细</div>' +
        '<div class="card-tools"><a class="btn btn-sm" href="payments.html">全部回款</a><a class="btn btn-sm" href="finance.html">财务记账</a></div></div>' +
        '<div class="card-body table-wrap"><table class="table"><thead><tr><th>订单</th><th>客户</th><th>业务员</th><th>欠款</th><th>约定付款日</th><th>状态</th></tr></thead><tbody>' +
        recv.data.rows.slice(0, 8).map(r =>
          '<tr><td><span class="row-link" data-oid="' + r.orderId + '">' + r.no + '</span></td>' +
          '<td>' + App.escapeHtml(r.customerName) + '</td><td>' + App.escapeHtml(r.ownerName) + '</td>' +
          '<td class="money balance">' + App.fmtMoney(r.balance) + '</td>' +
          '<td>' + (r.paymentDue || '—') + (r.overdueDays > 0 ? ' <span class="overdue-tag still">逾期 ' + r.overdueDays + ' 天</span>' : '') + '</td>' +
          '<td>' + App.badge(r.status, App.orderStatusMeta[r.status]) + '</td></tr>').join('') +
        '</tbody></table></div></div>';
      bindCountUp();
      root.querySelectorAll('[data-oid]').forEach(el => el.addEventListener('click', () => location.href = 'orders.html?oid=' + el.dataset.oid));
      App.mountIcons(root);
    });
  }

  function renderSales(d) {
    const st = d.ownerStats[sess.userId] || {};
    const myFollows = d.dueFollows.filter(f => f.ownerId === sess.userId);
    const myRecv = d.receivables.filter(r => r.ownerId === sess.userId);
    root.innerHTML =
      '<div class="view-banner"><span data-icon="target"></span>你好，' + App.escapeHtml(sess.name) +
      '！今天有 ' + myFollows.length + ' 个客户待跟进' + (myRecv.length ? '、' + myRecv.length + ' 笔款待收' : '') + '</div>' +

      '<div class="grid grid-kpi" style="margin-bottom:16px">' +
      kpiCard('本月我的成交', 'trending-up', st.monthDealAmount || 0, { cls: 'success' }) +
      kpiCard('本月订单数', 'clipboard-list', st.monthOrderCount || 0, { plain: true }) +
      kpiCard('本月新增客户', 'user-plus', st.newCustomerCount || 0, { plain: true }) +
      kpiCard('我的应收', 'circle-dollar-sign', st.receivableTotal || 0, { cls: 'warn', delta: (st.receivableCount || 0) + ' 笔未结' }) +
      '</div>' +

      '<div class="card" style="margin-bottom:16px"><div class="card-head"><div class="card-title">快捷操作</div></div><div class="card-body quick-grid">' +
      '<a class="quick-btn" href="customers.html"><span data-icon="phone-call"></span><b>记一笔跟进</b><i>客户页 · 一键记录</i></a>' +
      '<a class="quick-btn" href="quotes.html"><span data-icon="file-text"></span><b>写报价</b><i>产品明细自动算价</i></a>' +
      '<a class="quick-btn" href="payments.html"><span data-icon="wallet"></span><b>查我的回款</b><i>应收一目了然</i></a>' +
      '<a class="quick-btn" href="reminders.html"><span data-icon="bell"></span><b>我的提醒</b><i>该跟进 / 该收款</i></a>' +
      '</div></div>' +

      '<div class="grid grid-2">' +
      '<div class="card"><div class="card-head"><div class="card-title">我待跟进</div></div><div class="card-body">' +
      (myFollows.length ? myFollows.map(f =>
        '<div class="rank-row"><div style="flex:1;min-width:0"><b style="font-size:13px">' + App.escapeHtml(f.name) + '</b>' +
        '<div class="sub-line">' + App.relDays(f.inDays) + '</div></div>' +
        App.badge(f.stage, App.stageMeta[f.stage]) + '</div>').join('')
        : '<div class="empty"><span data-icon="check-circle"></span><p>暂无待跟进</p></div>') +
      '</div></div>' +
      '<div class="card"><div class="card-head"><div class="card-title">我该收的款</div></div><div class="card-body">' +
      (myRecv.length ? myRecv.map(r =>
        '<div class="rank-row"><div style="flex:1;min-width:0"><b style="font-size:13px">' + App.escapeHtml(r.name) + ' · ' + r.no + '</b>' +
        '<div class="sub-line">约定 ' + (r.paymentDue || '—') + '</div></div>' +
        '<span class="money ' + (r.overdueDays > 0 ? 'danger' : 'warn') + '">' + App.fmtMoney(r.balance) + '</span></div>').join('')
        : '<div class="empty"><span data-icon="check-circle"></span><p>暂无待收款</p></div>') +
      '</div></div>' +
      '</div>';
  }

  function bindCountUp() {
    root.querySelectorAll('.kpi-value[data-count]').forEach(el => {
      const v = Number(el.dataset.count);
      if (el.hasAttribute('data-int')) App.countUp(el, v, x => String(Math.round(x)));
      else App.countUp(el, v);
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
    if (sess.role === 'finance') { renderFinance(); return; }
    const res = await fetchDashboardSummary();
    if (res.code !== 0) { root.innerHTML = '<div class="empty"><p>加载失败，请刷新</p></div>'; return; }
    if (sess.role === 'boss') renderBoss(res.data); else renderSales(res.data);
    bindCountUp();
    root.querySelectorAll('[data-cid]').forEach(el =>
      el.addEventListener('click', () => location.href = 'customers.html?cid=' + el.dataset.cid));
    App.mountIcons(root);
  });
})();
