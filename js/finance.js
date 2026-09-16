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
  const state = { month: '', type: '全部', category: '全部' };

  const CATS = ['采购', '钢材', '辅料', '运费', '工资', '维修', '水电', '其他'];

  async function renderList() {
    root.innerHTML = '<div class="skeleton s-block"></div><div class="skeleton s-block"></div>';
    const [fin, led] = await Promise.all([fetchFinanceSummary(), fetchLedgers({})]);
    if (fin.code !== 0) { root.innerHTML = '<div class="empty"><p>' + App.escapeHtml(fin.msg) + '</p></div>'; return; }
    const f = fin.data;
    const months = [...new Set(led.data.map(l => l.date.slice(0, 7)))].sort().reverse();

    let rows = led.data;
    if (state.month) rows = rows.filter(l => l.date.slice(0, 7) === state.month);
    if (state.type !== '全部') rows = rows.filter(l => l.type === state.type);
    if (state.category !== '全部') rows = rows.filter(l => l.category === state.category);
    const canEdit = App.can('ledger.edit');

    /* 收支趋势双柱图 */
    const maxV = Math.max.apply(null, f.trend.map(t => Math.max(t.income, t.expense))) || 1;
    const bars = f.trend.map(t => {
      const hi = Math.round(t.income / maxV * 100), he = Math.round(t.expense / maxV * 100);
      return '<div class="prod-row"><div class="prod-top"><b>' + t.m.slice(5) + '月</b>' +
        '<span><i class="money" style="color:var(--chart-1);font-style:normal">收 ' + App.fmtWan(t.income) + '</i>' +
        ' · <i class="money" style="color:var(--chart-3);font-style:normal">支 ' + App.fmtWan(t.expense) + '</i></span></div>' +
        '<div style="display:flex;gap:4px"><div class="progress" style="flex:1"><i style="width:' + hi + '%"></i></div>' +
        '<div class="progress" style="flex:1"><i class="warn" style="width:' + he + '%"></i></div></div></div>';
    }).join('');

    root.innerHTML =
      '<div class="grid grid-kpi" style="margin-bottom:16px">' +
      '<div class="kpi"><div class="kpi-label"><span data-icon="trending-up"></span>本月收入（回款）</div><div class="kpi-value success" data-count="' + f.kpis.income + '">—</div></div>' +
      '<div class="kpi"><div class="kpi-label"><span data-icon="trending-down"></span>本月支出</div><div class="kpi-value danger" data-count="' + f.kpis.expense + '">—</div></div>' +
      '<div class="kpi"><div class="kpi-label"><span data-icon="coins"></span>本月净流入</div><div class="kpi-value ' + (f.kpis.net >= 0 ? 'success' : 'danger') + '" data-count="' + f.kpis.net + '">—</div></div>' +
      '<div class="kpi"><div class="kpi-label"><span data-icon="circle-dollar-sign"></span>应收欠款</div><div class="kpi-value warn" data-count="' + f.kpis.receivableTotal + '">—</div></div>' +
      '<div class="kpi"><div class="kpi-label"><span data-icon="truck"></span>应付采购款</div><div class="kpi-value warn" data-count="' + f.kpis.payableTotal + '">—</div><div class="kpi-foot"><span class="kpi-delta">' + f.payables.length + ' 笔待付</span></div></div>' +
      '</div>' +

      '<div class="grid grid-2" style="margin-bottom:16px">' +
      '<div class="card"><div class="card-head"><div class="card-title">收支趋势</div><div class="card-sub">近 6 个月 · 左收右支</div></div><div class="card-body">' + bars + '</div></div>' +
      '<div class="card"><div class="card-head"><div class="card-title">本月支出构成</div></div><div class="card-body">' +
      (f.expenseCats.length ? f.expenseCats.map(c => {
        const total = f.expenseCats.reduce((s, x) => s + x.value, 0) || 1;
        return '<div class="prod-row"><div class="prod-top"><b>' + c.name + '</b><span class="money">' + App.fmtMoney(c.value) + '</span></div>' +
          '<div class="progress"><i class="warn" style="width:' + Math.round(c.value / total * 100) + '%"></i></div></div>';
      }).join('') : '<div class="empty"><span data-icon="bar-chart"></span><p>本月暂无支出</p></div>') +
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
      '<select class="select" id="cSel" style="width:110px">' + ['全部'].concat(CATS).map(c => '<option' + (state.category === c ? ' selected' : '') + '>' + c + '</option>').join('') + '</select>' +
      (canEdit ? '<button class="btn btn-primary btn-sm" id="addLed"><span data-icon="plus"></span>记一笔支出</button>' : '') +
      '</div></div>' +
      '<div class="card-body table-wrap"><table class="table">' +
      '<thead><tr><th>日期</th><th>类型</th><th>科目</th><th>关联单号</th><th>客户 / 说明</th><th>金额</th><th>记录人</th><th></th></tr></thead><tbody>' +
      (rows.length ? rows.map(l =>
        '<tr><td>' + l.date + '</td>' +
        '<td>' + (l.type === '收入' ? '<span class="badge badge-success">收入</span>' : '<span class="badge badge-warn">支出</span>') + '</td>' +
        '<td>' + l.category + '</td>' +
        '<td class="row-link">' + (l.refNo || '—') + '</td>' +
        '<td>' + App.escapeHtml(l.customerName || '') + '<span class="sub-line">' + App.escapeHtml(l.note || '') + '</span></td>' +
        '<td class="money ' + (l.type === '收入' ? 'success' : 'danger') + '">' + (l.type === '收入' ? '+' : '−') + App.fmtMoney(l.amount) + '</td>' +
        '<td>' + App.escapeHtml((App.userById(l.recorder) || {}).name || '') + '</td>' +
        '<td>' + (canEdit && l.src === 'manual'
          ? '<div class="row-actions"><button class="btn btn-sm" data-ledit="' + l.id + '"><span data-icon="pencil"></span>编辑</button>' +
          '<button class="btn btn-sm btn-danger" data-ldel="' + l.id + '"><span data-icon="trash-2"></span>删除</button></div>'
          : '<span class="sub-line">' + (l.type === '收入' ? '回款' : '采购付款') + '自动生成</span>') + '</td></tr>').join('')
        : '<tr><td colspan="8"><div class="empty"><span data-icon="inbox"></span><p>暂无流水</p></div></td></tr>') +
      '</tbody></table></div></div>';

    root.querySelectorAll('.kpi-value[data-count]').forEach(el => App.countUp(el, Number(el.dataset.count)));
    root.querySelector('#mSel').addEventListener('change', e => { state.month = e.target.value; renderList(); });
    root.querySelector('#tSel').addEventListener('change', e => { state.type = e.target.value; renderList(); });
    root.querySelector('#cSel').addEventListener('change', e => { state.category = e.target.value; renderList(); });
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
        '<div class="form-item"><label>科目<b>*</b></label><select class="select" id="lCat">' + CATS.map(c => '<option' + (existing && existing.category === c ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></div>' +
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
          App.closeModal(); App.toast(isEdit ? '支出已更新' : '支出已入账'); renderList();
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
