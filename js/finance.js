/* ============================================================
   finance.js — 财务记账（新模块）
   月度收支汇总 / 收支趋势 / 应付明细 / 流水（收入=回款自动派生，
   支出=采购付款+手工账）/ 手工记账
   角色：老板 + 财务；业务员不可见
   ============================================================ */
'use strict';
(function () {
  const root = document.getElementById('pageRoot');
  const sess = App.session();
  const _nowQ = Math.floor(new Date().getMonth() / 3) + 1;
  const state = { month: '', type: '全部', category: '全部', catMonth: '', monthFin: '', quarterFin: _nowQ };

  const CATS = ['采购', '钢材', '辅料', '运费', '工资', '维修', '水电', '其他'];
  /* 动态科目：历史手工账里出现过的自定义科目自动进入候选（下次直接选用） */
  const allCats = () => CATS.concat([...new Set((DB.manualLedgers || []).map(l => (l.category || '').trim()).filter(c => c && !CATS.includes(c)))]);

  async function renderList() {
    root.innerHTML = '<div class="skeleton s-block"></div><div class="skeleton s-block"></div>';
    const [fin, led] = await Promise.all([fetchFinanceSummary(state.monthFin ? { month: state.monthFin, quarter: state.quarterFin || undefined } : { quarter: state.quarterFin || undefined }), fetchLedgers({})]);
    if (fin.code !== 0) { root.innerHTML = '<div class="empty"><p>' + App.escapeHtml(fin.msg) + '</p></div>'; return; }
    const f = fin.data;
    const months = [...new Set(led.data.map(l => l.date.slice(0, 7)))].sort().reverse();

    let rows = led.data;
    if (state.month) rows = rows.filter(l => l.date.slice(0, 7) === state.month);
    if (state.type !== '全部') rows = rows.filter(l => l.type === state.type);
    if (state.category !== '全部') rows = rows.filter(l => l.category === state.category);
    const canEdit = App.can('ledger.edit');

    /* 收支趋势：簇状柱形图（12 个月，收入/支出双柱，带同比标签与生长动画） */
    const maxV = Math.max.apply(null, f.trend.map(t => Math.max(t.income, t.expense))) || 1;
    const barH = v => Math.max(v > 0 ? 6 : 2, Math.round(v / maxV * 150));
    const fmtK = v => v >= 10000 ? (v / 10000).toFixed(1).replace(/\.0$/, '') + '万' : String(Math.round(v));
    const fmtV = v => v > 0 ? fmtK(v) : '<span class="tc-zero">·</span>';   /* 零值淡显，不再满屏 0 */
    let colIdx = 0;
    const bars = f.trend.map(t => {
      const delay = (colIdx++ * 40) + 'ms';
      /* 同比只在去年同期有数据时显示，格式 ▲+x% / ▼-x% */
      const yoyTag = t.yoyIncome == null ? '<div class="tc-yoy">&nbsp;</div>' :
        '<div class="tc-yoy" style="color:' + (t.yoyIncome >= 0 ? '#22c55e' : '#e5484d') + '">' + (t.yoyIncome >= 0 ? '▲+' : '▼-') + Math.abs(t.yoyIncome) + '%</div>';
      const hot = t.income > 0 || t.expense > 0;
      return '<div class="tc-col' + (hot ? ' tc-hot' : '') + '" style="animation-delay:' + delay + '">' +
        '<div class="tc-vals"><i style="color:var(--chart-1)">' + fmtV(t.income) + '</i><i style="color:var(--chart-3)">' + fmtV(t.expense) + '</i></div>' +
        '<div class="tc-bars" title="' + t.m + '  收入 ' + App.fmtMoney(t.income) + ' / 支出 ' + App.fmtMoney(t.expense) + (t.yoyIncome == null ? '' : ' / 收入同比 ' + (t.yoyIncome >= 0 ? '+' : '') + t.yoyIncome + '%') + '">' +
        '<div class="tc-bar tc-in" style="height:' + barH(t.income) + 'px;animation-delay:' + delay + '"></div>' +
        '<div class="tc-bar tc-exp" style="height:' + barH(t.expense) + 'px;animation-delay:' + delay + '"></div></div>' +
        '<div class="tc-m">' + t.m.slice(5) + '月</div>' + yoyTag + '</div>';
    }).join('');

    if (!state.catMonth) state.catMonth = f.month;
    const catRows = Object.keys(f.catByMonth[state.catMonth] || {}).map(k => ({ name: k, value: f.catByMonth[state.catMonth][k] })).sort((x, y) => y.value - x.value);

    const curM = f.month;
    const isCur = curM === (DB.today || curM).slice(0, 7);
    const mL = isCur ? '本月' : f.month;
    const yoyFoot = (v, goodUp) => {
      if (v == null) return '<div class="kpi-foot"><span class="kpi-delta">去年同期无数据</span></div>';
      const up = v >= 0;
      const good = goodUp ? up : !up;
      return '<div class="kpi-foot"><span class="kpi-delta" style="color:' + (good ? '#22c55e' : '#e5484d') + '">同比 ' + (up ? '+' : '') + v + '%</span></div>';
    };
    root.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">' +
      '<span class="sub-line">统计月份</span>' +
      '<select class="select" id="finMSel" style="width:130px">' + f.catMonths.map(m => '<option value="' + m + '"' + (m === curM ? ' selected' : '') + '>' + (isCur && m === curM ? '本月 ' + m.slice(5) : m) + '</option>').join('') + '</select>' +
      '<span class="sub-line" style="margin-left:auto">切换月份后，本页所有数据随之更新</span>' +
      '</div>' +
      '<div class="grid grid-kpi" style="margin-bottom:12px">' +
      '<div class="kpi"><div class="kpi-label"><span data-icon="trending-up"></span>' + mL + '收入（回款）</div><div class="kpi-value success" data-count="' + f.kpis.income + '">—</div>' + yoyFoot(f.kpis.yoyIncome, true) + '</div>' +
      '<div class="kpi"><div class="kpi-label"><span data-icon="trending-down"></span>' + mL + '支出</div><div class="kpi-value danger" data-count="' + f.kpis.expense + '">—</div>' +
      (f.salaryPending > 0 ? '<div class="kpi-foot"><span class="kpi-delta" style="color:#eab308">应发放工资：¥' + App.fmtMoney(f.salaryPending) + '（未计入）</span></div>' : '') +
      (f.salaryPaid > 0 ? '<div class="kpi-foot"><span class="kpi-delta" style="color:#22c55e">已发放工资：¥' + App.fmtMoney(f.salaryPaid) + '（已计入）</span></div>' : '') +
      yoyFoot(f.kpis.yoyExpense, false) +
      '</div>' +
      '<div class="kpi"><div class="kpi-label"><span data-icon="coins"></span>' + mL + '净流入</div><div class="kpi-value ' + (f.kpis.net >= 0 ? 'success' : 'danger') + '" data-count="' + f.kpis.net + '">—</div></div>' +
      '<div class="kpi"><div class="kpi-label"><span data-icon="circle-dollar-sign"></span>应收欠款</div><div class="kpi-value warn" data-count="' + f.kpis.receivableTotal + '">—</div></div>' +
      '<div class="kpi"><div class="kpi-label"><span data-icon="truck"></span>应付采购款</div><div class="kpi-value warn" data-count="' + f.kpis.payableTotal + '">—</div><div class="kpi-foot"><span class="kpi-delta">' + f.payables.length + ' 笔待付</span></div></div>' +
      '</div>' +
      '<div class="grid grid-2" style="margin-bottom:16px">' +
      '<div class="kpi"><div class="kpi-label"><span data-icon="calendar"></span>季度收支' +
      '<select class="select" id="finQSel" style="margin-left:auto;width:96px;padding:2px 6px;font-size:12px">' +
      [1, 2, 3, 4].map(q => '<option value="' + q + '"' + (Number(q) === Number(f.quarter.q) ? ' selected' : '') + '>第 ' + q + ' 季度</option>').join('') + '</select></div>' +
      '<div style="display:flex;align-items:baseline;gap:18px;margin-top:2px">' +
      '<div><span class="sub-line">收</span> <b class="kpi-value success" style="font-size:22px" data-count="' + f.quarter.income + '">—</b></div>' +
      '<div><span class="sub-line">支</span> <b class="kpi-value danger" style="font-size:22px" data-count="' + f.quarter.expense + '">—</b></div></div>' +
      '<div class="kpi-foot"><span class="kpi-delta">' + f.yearSummary.year + ' 年第 ' + f.quarter.q + ' 季度（' + f.quarter.months[0] + ' ~ ' + f.quarter.months[2] + '）</span></div></div>' +
      '<div class="kpi"><div class="kpi-label"><span data-icon="award"></span>年度收支</div>' +
      '<div style="display:flex;align-items:baseline;gap:18px;margin-top:2px">' +
      '<div><span class="sub-line">收</span> <b class="kpi-value success" style="font-size:22px" data-count="' + f.yearSummary.income + '">—</b></div>' +
      '<div><span class="sub-line">支</span> <b class="kpi-value danger" style="font-size:22px" data-count="' + f.yearSummary.expense + '">—</b></div></div>' +
      '<div class="kpi-foot"><span class="kpi-delta">' + f.yearSummary.year + ' 年全年</span></div></div>' +
      '</div>' +

      '<div class="grid grid-2" style="margin-bottom:16px">' +
      '<div class="card"><div class="card-head"><div class="card-title">收支趋势</div><div class="card-sub">近 12 个月 · 悬停看精确金额 · 柱下 ▲▼ 为收入较去年同月</div></div><div class="card-body">' +
      '<div class="tc-legend"><span><i style="background:var(--chart-1)"></i>收入（回款）</span><span><i style="background:var(--chart-3)"></i>支出</span></div>' +
      '<div class="tc-chart">' + bars + '</div></div></div>' +
      '<div class="card"><div class="card-head"><div class="card-title">支出构成</div>' +
      '<div class="card-tools"><select class="select" id="catMSel" style="width:120px">' +
      f.catMonths.map(m => '<option value="' + m + '"' + (m === state.catMonth ? ' selected' : '') + '>' + (m === f.month ? '本月 ' + m.slice(5) : m) + '</option>').join('') +
      '</select></div></div><div class="card-body">' +
      (catRows.length ? catRows.map(c => {
        const total = catRows.reduce((s, x) => s + x.value, 0) || 1;
        return '<div class="prod-row"><div class="prod-top"><b>' + App.escapeHtml(c.name) + '</b><span class="money">' + App.fmtMoney(c.value) + '</span></div>' +
          '<div class="progress"><i class="warn" style="width:' + Math.round(c.value / total * 100) + '%"></i></div></div>';
      }).join('') : '<div class="empty"><span data-icon="bar-chart"></span><p>' + (state.catMonth === f.month ? '本月' : state.catMonth) + '暂无支出</p></div>') +
      '</div></div>' +
      '</div>' +

      (f.payables.length ? '<div class="card" style="margin-bottom:16px"><div class="card-head"><div class="card-title">应付采购款</div><span class="card-sub">去采购页处理</span>' +
        '<div class="card-tools"><a class="btn btn-sm" href="purchase.html">采购管理</a></div></div>' +
        '<div class="card-body table-wrap"><table class="table"><thead><tr><th>采购单</th><th>标题</th><th>供应商</th><th>金额</th><th>状态</th></tr></thead><tbody>' +
        f.payables.map(p => '<tr><td class="row-link">' + p.no + '</td><td>' + App.escapeHtml(p.title) + '</td>' +
        '<td>' + App.escapeHtml(p.supplierName) + '</td><td class="money">' + App.fmtMoney(p.amount) + '</td>' +
        '<td>' + App.badge(p.status, App.purchaseStatusMeta[p.status]) + '</td></tr>').join('') +
        '</tbody></table></div></div>' : '') +

      '<div class="card"><div class="card-head"><div class="card-title">收支流水</div>' +
      '<div class="card-tools">' +
      '<select class="select" id="mSel" style="width:120px"><option value="">全部月份</option>' + months.map(m => '<option' + (state.month === m ? ' selected' : '') + '>' + m + '</option>').join('') + '</select>' +
      '<select class="select" id="tSel" style="width:100px">' + ['全部', '收入', '支出'].map(t => '<option' + (state.type === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>' +
      '<select class="select" id="cSel" style="width:110px">' + ['全部'].concat(allCats()).map(c => '<option' + (state.category === c ? ' selected' : '') + '>' + App.escapeHtml(c) + '</option>').join('') + '</select>' +
      (canEdit ? '<button class="btn btn-primary btn-sm" id="addLed"><span data-icon="plus"></span>记一笔支出</button>' : '') +
      '</div></div>' +
      '<div class="card-body table-wrap"><table class="table">' +
      '<thead><tr><th>日期</th><th>类型</th><th>科目</th><th>关联单号</th><th>客户 / 说明</th><th>金额</th><th>记录人</th><th></th></tr></thead><tbody>' +
      (rows.length ? rows.map(l =>
        '<tr><td>' + l.date + '</td>' +
        '<td>' + (l.type === '收入' ? '<span class="badge badge-success">收入</span>' : '<span class="badge badge-warn">支出</span>') + '</td>' +
        '<td>' + l.category + '</td>' +
        '<td class="row-link" data-ref="' + App.escapeHtml(l.refNo || '') + '">' + (l.refNo || '—') + '</td>' +
        '<td>' + App.escapeHtml(l.customerName || '') + '<span class="sub-line">' + App.escapeHtml(l.note || '') + '</span></td>' +
        '<td class="money ' + (l.type === '收入' ? 'success' : 'danger') + '">' + (l.type === '收入' ? '+' : '−') + App.fmtMoney(l.amount) + '</td>' +
        '<td>' + App.escapeHtml((App.userById(l.recorder) || {}).name || '') + '</td>' +
        '<td>' + (canEdit && l.src === 'manual'
          ? '<div class="row-actions"><button class="btn btn-sm" data-ledit="' + l.id + '"><span data-icon="pencil"></span>编辑</button>' +
          '<button class="btn btn-sm btn-danger" data-ldel="' + l.id + '"><span data-icon="trash-2"></span>删除</button></div>'
          : '<span class="sub-line">' + (l.type === '收入' ? '回款' : (l.src === 'payroll' ? '工资发放' : '采购付款')) + '自动生成</span>') + '</td></tr>').join('')
        : '<tr><td colspan="8"><div class="empty"><span data-icon="inbox"></span><p>暂无流水</p></div></td></tr>') +
      '</tbody></table></div></div>';

    /* 关联单号点击跳转：SO→订单详情 / PO→采购单详情 / PAY→工资核算 */
    root.querySelectorAll('td[data-ref]').forEach(td => td.addEventListener('click', () => {
      const ref = td.dataset.ref;
      if (!ref) return;
      const o = (DB.orders || []).find(x => x.no === ref);
      if (o) { location.href = 'orders.html?oid=' + o.id; return; }
      const p = (DB.purchases || []).find(x => x.no === ref);
      if (p) { location.href = 'purchase.html?pid=' + p.id; return; }
      if (ref.indexOf('PAY-') === 0) { location.href = 'payroll.html'; return; }
      App.toast('未找到与「' + ref + '」关联的单据', 'warn');
    }));
    root.querySelectorAll('.kpi-value[data-count]').forEach(el => App.countUp(el, Number(el.dataset.count)));
    root.querySelector('#mSel').addEventListener('change', e => { state.month = e.target.value; renderList(); });
    root.querySelector('#tSel').addEventListener('change', e => { state.type = e.target.value; renderList(); });
    root.querySelector('#cSel').addEventListener('change', e => { state.category = e.target.value; renderList(); });
    const catMSel = root.querySelector('#catMSel');
    if (catMSel) catMSel.addEventListener('change', e => { state.catMonth = e.target.value; renderList(); });
    const finMSel = root.querySelector('#finMSel');
    if (finMSel) finMSel.addEventListener('change', e => { state.monthFin = e.target.value; state.catMonth = e.target.value; state.quarterFin = Math.floor((Number(e.target.value.slice(5, 7)) - 1) / 3) + 1; renderList(); });
    const finQSel = root.querySelector('#finQSel');
    if (finQSel) finQSel.addEventListener('change', e => { state.quarterFin = Number(e.target.value); renderList(); });
    const add = root.querySelector('#addLed');
    if (add) add.addEventListener('click', () => addLedModal(null));
    root.querySelectorAll('[data-ledit]').forEach(b => b.addEventListener('click', () => {
      const l = rows.find(x => x.id === b.dataset.ledit);
      if (l) addLedModal(l);
    }));
    root.querySelectorAll('[data-ldel]').forEach(b => b.addEventListener('click', () => App.confirm({
      title: '删除这笔支出？', html: '删除后不可恢复。回款与采购付款生成的流水不受影响。', okText: '确认删除', danger: true,
      onOk: async () => {
        const r = await deleteManualLedger(b.dataset.ldel);
        if (r.code !== 0) return App.toast(r.msg, 'danger');
        App.toast('已删除'); renderList();
      },
    })));
    App.mountIcons(root);
  }

  /* 手工记账（编辑模式传入已有账目） */
  function addLedModal(existing) {
    const isEdit = !!existing;
    App.openModal({
      title: isEdit ? '编辑支出' : '记一笔支出',
      html:
        '<div class="form-grid">' +
        '<div class="form-item"><label>日期<b>*</b></label><input class="input" id="lDate" type="date" value="' + (existing ? existing.date : App.today) + '"><p class="form-error"></p></div>' +
        '<div class="form-item"><label>科目<b>*</b>（可输入新科目，保存后自动复用）</label><input class="input" id="lCat" list="lCatList" placeholder="下拉选择或直接输入，如 广告费" autocomplete="off"><datalist id="lCatList">' + allCats().map(c => '<option value="' + App.escapeHtml(c) + '">').join('') + '</datalist></div>' +
        '<div class="form-item"><label>金额（元）<b>*</b></label><input class="input num" id="lAmt" type="number" min="1" step="0.01" value="' + (existing ? existing.amount : '') + '" placeholder="如 6800"><p class="form-error"></p></div>' +
        '<div class="form-item"><label>关联单号</label><input class="input num" id="lRef" value="' + App.escapeHtml(existing ? (existing.refNo || '') : '') + '" placeholder="选填，如 PO2026-001"></div>' +
        '<div class="form-item" style="grid-column:1/-1"><label>用途说明</label><input class="input" id="lNote" value="' + App.escapeHtml(existing ? (existing.note || '') : '') + '" placeholder="选填"></div>' +
        '</div>',
      foot: '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">' + (isEdit ? '保存修改' : '保存') + '</button>',
      onMount(box) {
        box.querySelector('[data-act="cancel"]').addEventListener('click', () => App.closeModal());
        box.querySelector('[data-act="ok"]').addEventListener('click', async e => {
          const btn = e.currentTarget;
          const amtEl = box.querySelector('#lAmt'), dEl = box.querySelector('#lDate');
          [amtEl, dEl].forEach(App.formClear);
          const amt = Number(amtEl.value);
          if (!dEl.value) return App.formError(dEl, '请选择日期');
          if (!amt || amt <= 0) return App.formError(amtEl, '请填写正确的金额');
          const payload = {
            date: dEl.value, category: box.querySelector('#lCat').value,
            amount: amt, note: box.querySelector('#lNote').value, recorder: sess.userId,
            refNo: box.querySelector('#lRef').value.trim(),
          };
          App.btnLoading(btn);
          const res = isEdit ? await updateManualLedger(existing.id, payload) : await saveManualLedger(payload);
          App.btnDone(btn);
          if (res.code !== 0) return App.toast(res.msg, 'danger');
          App.closeModal();
          App.toast(res.data && res.data.converted ? (res.msg + '，支出已计入') : (isEdit ? '支出已更新' : '支出已入账'));
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
