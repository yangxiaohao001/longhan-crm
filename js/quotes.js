/* ============================================================
   quotes.js — 报价管理（重写版）
   列表（状态筛选/倒计时/老板快捷批复）→ 报价抽屉（版本对比/明细/
   审批/成交/作废/调价）→ 新建报价（产品行编辑、合计自动计算）
   角色范围：业务员只看自己的（跟单权限放开）；财务只读；老板全量+审批
   ============================================================ */
'use strict';
(function () {
  const root = document.getElementById('pageRoot');
  const sess = App.session();
  const state = { kw: '', status: '' };
  const QT_STATUSES = ['草稿', '待审批', '已发送', '已成交', '已过期', '已驳回', '已作废'];
  const UNIT_OPTS = ['吨', '根', '件', '米', '套', '个', '平方'];
  const unitOptions = cur => (cur && !UNIT_OPTS.includes(cur)) ? UNIT_OPTS.concat([cur]) : UNIT_OPTS;

  async function renderList() {
    root.innerHTML = '<div class="skeleton s-block"></div>';
    const filters = {};
    if (state.status) filters.status = state.status;
    if (!App.seeAll()) filters.owner = sess.userId;
    const res = await fetchQuotes(filters);
    if (res.code !== 0) { root.innerHTML = '<div class="empty"><p>' + App.escapeHtml(res.msg) + '</p></div>'; return; }
    const kw = state.kw.trim();
    const list = res.data.filter(q => !kw || q.no.includes(kw) || q.customerName.includes(kw));
    const readOnly = sess.position === '财务';

    const pending = res.data.filter(q => q.hasApproval);
    root.innerHTML =
      (readOnly ? '<div class="view-banner"><span data-icon="shield-check"></span>财务视角：报价只读</div>' : '') +

      (App.can('quote.approve') && pending.length ?
        '<div class="card" style="margin-bottom:16px"><div class="card-head"><div class="card-title">待你审批</div><span class="card-sub">' + pending.length + ' 份</span></div>' +
        '<div class="card-body table-wrap"><table class="table"><thead><tr><th>报价单</th><th>客户</th><th>业务员</th><th>版本</th><th>金额</th><th>操作</th></tr></thead><tbody>' +
        pending.map(q => '<tr><td><span class="row-link" data-qid="' + q.id + '">' + q.no + '</span></td>' +
        '<td>' + App.escapeHtml(q.customerName) + '</td><td>' + App.escapeHtml(q.ownerName) + '</td>' +
        '<td>v' + q.version + '</td><td class="money">' + App.fmtMoney(q.total) + '</td>' +
        '<td><div class="row-actions">' +
        '<button class="btn btn-sm btn-primary" data-ap="' + q.id + '">通过并发送</button>' +
        '<button class="btn btn-sm btn-danger" data-rj="' + q.id + '">驳回</button></div></td></tr>').join('') +
        '</tbody></table></div></div>' : '') +

      '<div class="card"><div class="card-head">' +
      '<div class="chip-row">' + [''].concat(QT_STATUSES).map(s =>
        '<button class="chip' + (state.status === s ? ' active' : '') + '" data-st="' + s + '">' + (s || '全部') + '</button>').join('') + '</div>' +
      '<div class="card-tools"><div class="search-box"><span data-icon="search"></span>' +
      '<input class="input" id="kwInput" placeholder="搜索单号 / 客户" style="width:180px" value="' + App.escapeHtml(state.kw) + '"><button class="btn btn-sm" id="kwBtn">搜索</button></div>' +
      (!readOnly ? '<button class="btn btn-primary btn-sm" id="addBtn"><span data-icon="plus"></span>新建报价</button>' : '') +
      '</div></div>' +
      '<div class="card-body table-wrap"><table class="table">' +
      '<thead><tr><th>报价单</th><th>客户</th><th>版本</th><th>金额</th><th>状态</th><th>有效期</th>' + (App.seeAll() ? '<th>业务员</th>' : '') + '<th></th></tr></thead><tbody>' +
      (list.length ? list.map(q => {
        const expiring = q.status === '已发送' && q.validInDays != null && q.validInDays <= 3;
        return '<tr>' +
          '<td><span class="row-link" data-qid="' + q.id + '">' + q.no + '</span></td>' +
          '<td>' + App.escapeHtml(q.customerName) + '</td>' +
          '<td>v' + q.version + '</td>' +
          '<td class="money">' + App.fmtMoney(q.total) + '</td>' +
          '<td>' + App.badge(q.status, App.quoteStatusMeta[q.status]) + '</td>' +
          '<td>' + (q.validUntil ? q.validUntil + (expiring ? ' <span class="overdue-tag still">' + App.relDays(q.validInDays) + '</span>' : '') : '—') + '</td>' +
          (App.seeAll() ? '<td>' + App.escapeHtml(q.ownerName) + '</td>' : '') +
          '<td>' + (readOnly ? '<span class="sub-line">只读</span>' : '<button class="btn btn-sm" data-qid2="' + q.id + '">查看</button>') + '</td>' +
          '</tr>';
      }).join('') : '<tr><td colspan="8"><div class="empty"><span data-icon="inbox"></span><p>没有符合条件的报价</p></div></td></tr>') +
      '</tbody></table></div></div>';

    root.querySelectorAll('[data-qid], [data-qid2]').forEach(el => el.addEventListener('click', () => openDrawer(el.dataset.qid || el.dataset.qid2)));
    root.querySelectorAll('[data-ap]').forEach(el => el.addEventListener('click', () => approve(el.dataset.ap, true)));
    root.querySelectorAll('[data-rj]').forEach(el => el.addEventListener('click', () => rejectModal(el.dataset.rj)));
    root.querySelectorAll('[data-st]').forEach(el => el.addEventListener('click', () => { state.status = el.dataset.st; renderList(); }));
    const kwEl = root.querySelector('#kwInput');
    const doSearch = () => { state.kw = kwEl.value; renderList(); };
    kwEl.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    const kwBtn = root.querySelector('#kwBtn');
    if (kwBtn) kwBtn.addEventListener('click', doSearch);
    const add = root.querySelector('#addBtn');
    if (add) add.addEventListener('click', addModal);
    App.mountIcons(root);
  }

  async function approve(id, pass, reason) {
    const res = await approveQuote(id, pass, reason);
    if (res.code !== 0) return App.toast(res.msg, 'danger');
    App.toast(pass ? '已通过并发送客户（有效期自动 +15 天）' : '已驳回');
    renderList();
  }

  function rejectModal(id) {
    App.openModal({
      title: '驳回报价',
      html: '<div class="field"><label>驳回原因<b>*</b></label><textarea class="textarea" id="rjReason" placeholder="例如：毛利不足，单价需上浮 5%"></textarea><p class="form-error"></p></div>',
      foot: '<button class="btn" data-act="cancel">取消</button><button class="btn btn-danger" data-act="ok">确认驳回</button>',
      onMount(box) {
        box.querySelector('[data-act="cancel"]').addEventListener('click', () => App.closeModal());
        box.querySelector('[data-act="ok"]').addEventListener('click', async e => {
          const btn = e.currentTarget, rEl = box.querySelector('#rjReason');
          App.formClear(rEl);
          if (!rEl.value.trim()) return App.formError(rEl, '请填写驳回原因');
          App.btnLoading(btn);
          await approve(id, false, rEl.value);
          App.btnDone(btn); App.closeModal();
        });
      },
    });
  }

  /* ---------- 报价抽屉 ---------- */
  async function openDrawer(id) {
    const res = await fetchQuoteDetail(id);
    if (res.code !== 0) { App.toast(res.msg, 'danger'); return; }
    const q = res.data;
    const mine = q.ownerId === sess.userId;
    const canEdit = App.can('quote.editAll') || mine;
    const ver = q.versions[q.version - 1];

    App.openDrawer({
      title: '报价 ' + q.no,
      wide: true,
      html:
        '<div class="mini-stats">' +
        '<div class="mini-stat"><div class="lbl">最新版本</div><div class="val">v' + q.version + '</div></div>' +
        '<div class="mini-stat"><div class="lbl">报价金额</div><div class="val success">' + App.fmtMoney(q.total) + '</div></div>' +
        '<div class="mini-stat"><div class="lbl">较上版</div><div class="val ' + (q.delta && q.delta.amount >= 0 ? 'warn' : 'success') + '">' +
        (q.delta ? (q.delta.amount >= 0 ? '+' : '') + q.delta.pct + '%' : '—') + '</div></div>' +
        '<div class="mini-stat"><div class="lbl">有效期</div><div class="val" style="font-size:15px">' + (q.validUntil || '—') + '</div></div>' +
        '</div>' +

        '<div class="field-grid" style="margin-bottom:16px">' +
        '<div><div class="lbl">客户</div>' + App.escapeHtml(q.customerName) + '</div>' +
        '<div><div class="lbl">业务员</div>' + App.escapeHtml(q.ownerName) + '</div>' +
        '<div><div class="lbl">创建 / 更新</div>' + q.createdAt + ' / ' + q.updatedAt + '</div>' +
        '<div><div class="lbl">状态</div>' + App.badge(q.status, App.quoteStatusMeta[q.status]) + '</div>' +
        '</div>' +
        (q.rejectReason ? '<div class="view-banner" style="color:var(--danger);background:var(--danger-bg);border-color:rgba(255,84,112,.3)"><span data-icon="ban"></span>驳回原因：' + App.escapeHtml(q.rejectReason) + '</div>' : '') +

        '<div class="card" style="margin-bottom:14px"><div class="card-head"><div class="card-title">明细 · v' + q.version + '</div>' +
        '<span class="card-sub">' + q.itemCount + ' 项 · 合计 <b class="money">' + App.fmtMoney(q.total) + '</b></span></div>' +
        '<div class="card-body table-wrap"><table class="table">' +
        '<thead><tr><th>产品</th><th>规格</th><th>数量</th><th>单价</th><th>小计</th></tr></thead><tbody>' +
        ver.items.map(i => '<tr><td>' + App.escapeHtml(i.name) + '</td><td class="sub-line">' + App.escapeHtml(i.spec) + '</td>' +
        '<td class="num">' + i.qty + ' ' + i.unit + '</td><td class="money">' + App.fmtMoney(i.price) + '</td>' +
        '<td class="money">' + App.fmtMoney(i.qty * i.price) + '</td></tr>').join('') +
        '</tbody></table></div></div>' +

        (q.versions.length > 1 ? '<div class="card" style="margin-bottom:14px"><div class="card-head"><div class="card-title">版本历史</div></div><div class="card-body"><ul class="timeline">' +
        q.versions.slice().reverse().map((v, i) =>
          '<li class="' + (i === 0 ? 'done' : '') + '"><span class="t-dot"></span><div class="t-title">v' + v.v + '<em>' + v.date + ' · ' + App.fmtMoney(v.total) + '</em></div>' +
          '<div class="t-sub">' + App.escapeHtml(v.note || '') + '</div></li>').join('') + '</ul></div></div>' : '') +

        (q.note ? '<p class="form-hint" style="margin-bottom:14px">' + App.escapeHtml(q.note) + '</p>' : '') +

        '<div class="row-actions">' +
        (canEdit && ['草稿', '已驳回'].includes(q.status) ? '<button class="btn btn-primary" id="qSubmit"><span data-icon="send"></span>提交审批</button>' : '') +
        (canEdit && q.status === '已发送' ? '<button class="btn btn-primary" id="qDeal"><span data-icon="check-circle"></span>标记成交（自动生成订单）</button>' : '') +
        (canEdit && q.status === '已发送' ? '<button class="btn" id="qAdjust"><span data-icon="pencil"></span>调价（新版本）</button>' : '') +
        (q.status === '待审批' ? '<span class="form-hint">审批中，等老板批复</span>' : '') +
        (App.isBoss() && !q.dealOrderId ? '<button class="btn btn-danger" id="qDel"><span data-icon="trash-2"></span>删除报价</button>' : '') +
        (q.dealOrderId ? '<a class="btn" href="orders.html?oid=' + q.dealOrderId + '">查看关联订单</a>' : '') +
        '</div>',

      onMount(box) {
        const sub = box.querySelector('#qSubmit');
        if (sub) sub.addEventListener('click', async () => {
          App.btnLoading(sub);
          const r = await submitQuote(id);
          App.btnDone(sub);
          if (r.code !== 0) return App.toast(r.msg, 'danger');
          App.toast('已提交审批，等待老板批复'); App.closeDrawer(); renderList();
        });
        const deal = box.querySelector('#qDeal');
        if (deal) deal.addEventListener('click', () => App.confirm({
          title: '标记成交？',
          html: '将按 v' + q.version + ' 金额 <b class="money">' + App.fmtMoney(q.total) + '</b> 自动生成订单，客户阶段同步为「已下单」。',
          okText: '确认成交',
          onOk: async () => {
            const r = await markQuoteDeal(id);
            if (r.code !== 0) return App.toast(r.msg, 'danger');
            App.toast('成交！订单 ' + r.data.order.no + ' 已生成');
            App.closeDrawer(); renderList();
          },
        }));
        const adj = box.querySelector('#qAdjust');
        if (adj) adj.addEventListener('click', () => adjustModal(q));
        const del = box.querySelector('#qDel');
        if (del) del.addEventListener('click', () => App.confirm({
          title: '删除报价 ' + q.no + '？',
          html: '将删除该报价的<b>全部版本</b>与审批记录。客户与订单不受影响。此操作不可恢复。',
          okText: '确认删除', danger: true,
          onOk: async () => {
            const r = await deleteQuote(id);
            if (r.code !== 0) return App.toast(r.msg, 'danger');
            App.toast('报价已删除'); App.closeDrawer(); renderList();
          },
        }));
        App.mountIcons(box);
      },
    });
  }

  /* ---------- 调价（追加新版本；已发送/已成交自动进审批） ---------- */
  function adjustModal(q) {
    const products = DB.products;
    const cur = q.versions[q.version - 1];
    const rows = cur.items.map(i => ({
      pid: i.productId || products.find(p => p.name === i.name)?.id || products[0].id,
      name: i.name || '', spec: i.spec || '',
      qty: i.qty, price: i.price,
      unit: i.unit || (products.find(p => p.name === i.name) || {}).unit || '件',
    }));
    App.openModal({
      title: '调价 · ' + q.no + '（当前 v' + q.version + '）',
      wide: true,
      html:
        '<div class="form-hint" style="margin-bottom:12px">已发送的报价调价会自动回到「待审批」，由老板批复后生效。</div>' +
        '<div class="field"><label>调整原因</label><input class="input" id="adjNote" placeholder="如：锌价上调，角钢单价上调 50 元"></div>' +
        '<div class="field"><label>明细<b>*</b></label>' +
        '<div style="margin-bottom:4px"><div class="row-actions" style="flex-wrap:wrap">' +
        '<div style="flex:1.2;min-width:150px;font-size:11.5px;color:var(--ink-faint)">产品名称（可输入或下拉选择）</div>' +
        '<div style="flex:1.3;min-width:140px;font-size:11.5px;color:var(--ink-faint)">规格</div>' +
        '<div style="width:74px;font-size:11.5px;color:var(--ink-faint)">数量</div>' +
        '<div style="width:108px;font-size:11.5px;color:var(--ink-faint)">单价（元）</div>' +
        '<div style="width:72px;font-size:11.5px;color:var(--ink-faint)">单位</div>' +
        '<div style="width:34px"></div></div></div>' +
        '<div id="adjRows"></div><datalist id="aProdList">' + products.map(x => '<option value="' + App.escapeHtml(x.name) + '">').join('') + '</datalist>' +
        '<button class="btn btn-sm" id="adjAdd" style="margin-top:8px"><span data-icon="plus"></span>加一行</button></div>' +
        '<div class="view-banner" style="margin:0"><span data-icon="coins"></span>新版本报价总金额（客户看到的总价）：<b class="money" id="adjTotal" style="margin-left:6px;font-size:16px">¥0</b></div>',
      foot: '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">提交新版本</button>',
      onMount(box) {
        const rowsEl = box.querySelector('#adjRows');
        const totalEl = box.querySelector('#adjTotal');
        function calc() {
          totalEl.textContent = App.fmtMoney(rows.reduce((s, r) => s + r.qty * r.price, 0));
        }
        function renderRows() {
          rowsEl.innerHTML = rows.map((r, i) => {
            const p = products.find(x => x.id === r.pid) || {};
            return '<div class="row-actions" style="margin-bottom:8px;flex-wrap:wrap" data-row="' + i + '">' +
              '<input class="input a-name" list="aProdList" value="' + App.escapeHtml(r.name || '') + '" style="flex:1.2;min-width:150px" placeholder="输入产品名（库里没有的可直接自定义）" title="可输入，也可从产品库下拉选择" autocomplete="off">' +
              '<input class="input a-spec" value="' + App.escapeHtml(r.spec || '') + '" style="flex:1.3;min-width:140px" placeholder="规格（可改）" title="规格（可改）">' +
              '<input class="input a-qty num" type="number" min="1" value="' + r.qty + '" style="width:74px" title="数量">' +
              '<input class="input a-price num" type="number" min="0" step="0.01" value="' + r.price + '" style="width:108px" title="单价（可改）">' +
              '<select class="select a-unit" style="width:72px" title="单位">' +
              unitOptions(r.unit).map(u => '<option' + (u === r.unit ? ' selected' : '') + '>' + u + '</option>').join('') + '</select>' +
              '<button class="btn btn-sm btn-danger a-del"><span data-icon="trash-2"></span></button></div>';
          }).join('');
          rowsEl.querySelectorAll('.a-name').forEach(inp => inp.addEventListener('input', () => {
            const i = Number(inp.closest('[data-row]').dataset.row);
            rows[i].name = inp.value;
            const p = products.find(x => x.name === inp.value.trim());
            if (p) {
              rows[i].pid = p.id; rows[i].spec = p.spec; rows[i].unit = p.unit; rows[i].price = p.price;
              const rowDiv = inp.closest('[data-row]');
              rowDiv.querySelector('.a-spec').value = p.spec;
              rowDiv.querySelector('.a-price').value = p.price;
              rowDiv.querySelector('.a-unit').value = p.unit;
              calc();
            }
          }));
          rowsEl.querySelectorAll('.a-name').forEach(inp => inp.addEventListener('input', () => { rows[Number(inp.closest('[data-row]').dataset.row)].name = inp.value; }));
          rowsEl.querySelectorAll('.a-spec').forEach(inp => inp.addEventListener('input', () => { rows[Number(inp.closest('[data-row]').dataset.row)].spec = inp.value; }));
          rowsEl.querySelectorAll('.a-qty').forEach(inp => inp.addEventListener('input', () => { rows[Number(inp.closest('[data-row]').dataset.row)].qty = Number(inp.value) || 1; calc(); }));
          rowsEl.querySelectorAll('.a-price').forEach(inp => inp.addEventListener('input', () => { rows[Number(inp.closest('[data-row]').dataset.row)].price = Number(inp.value) || 0; calc(); }));
          rowsEl.querySelectorAll('.a-unit').forEach(sel => sel.addEventListener('change', () => { rows[Number(sel.closest('[data-row]').dataset.row)].unit = sel.value; }));
          rowsEl.querySelectorAll('.a-del').forEach(btn => btn.addEventListener('click', () => {
            if (rows.length === 1) return;
            rows.splice(Number(btn.closest('[data-row]').dataset.row), 1); renderRows(); calc();
          }));
          App.mountIcons(rowsEl);
        }
        renderRows(); calc();
        box.querySelector('#adjAdd').addEventListener('click', () => { rows.push({ pid: products[0].id, name: products[0].name, spec: products[0].spec, qty: 1, price: products[0].price, unit: products[0].unit }); renderRows(); calc(); });
        box.querySelector('[data-act="cancel"]').addEventListener('click', () => App.closeModal());
        box.querySelector('[data-act="ok"]').addEventListener('click', async e => {
          const btn = e.currentTarget;
          const items = rows.map(r => {
            const p = products.find(x => x.id === r.pid);
            return { productId: p.id, name: (r.name || '').trim() || p.name, spec: (r.spec || '').trim(), unit: r.unit, qty: r.qty, price: r.price };
          });
          App.btnLoading(btn);
          const res = await createQuoteVersion(q.id, { items, note: box.querySelector('#adjNote').value });
          App.btnDone(btn);
          if (res.code !== 0) return App.toast(res.msg, 'danger');
          App.closeModal();
          App.toast(res.data.status === '待审批' ? '新版本 v' + res.data.version + ' 已提交审批' : '新版本 v' + res.data.version + ' 已保存');
          App.closeDrawer(); renderList();
        });
      },
    });
  }

  /* ---------- Excel / CSV 表格解析：识别表头列，导出报价明细行 ---------- */
  function parseGrid(grid) {
    const norm = x => String(x == null ? '' : x).trim();
    const KEY = { name: ['产品', '品名', '名称', '材料', '物料', '货品'], spec: ['规格', '型号'], qty: ['数量'], price: ['单价', '价格'], unit: ['单位'], cust: ['客户'] };
    let headIdx = -1, map = null;
    for (let i = 0; i < Math.min(grid.length, 8); i++) {
      const row = (grid[i] || []).map(norm);
      const m = {}; let hits = 0;
      Object.keys(KEY).forEach(k => {
        const idx = row.findIndex(cell => KEY[k].some(kw => cell.includes(kw)));
        if (idx >= 0) { m[k] = idx; hits++; }
      });
      if (hits >= 2) { headIdx = i; map = m; break; }
    }
    const num = x => Number(String(x == null ? '' : x).replace(/[^\d.]/g, '')) || 0;
    const out = []; let custName = '';
    if (headIdx >= 0) {
      if (map.cust != null) {
        for (let i = headIdx + 1; i < grid.length; i++) {
          const v = norm((grid[i] || [])[map.cust]);
          if (v) { custName = v; break; }
        }
      }
      for (let i = headIdx + 1; i < grid.length; i++) {
        const row = grid[i] || [];
        const name = norm(map.name != null ? row[map.name] : '');
        if (!name) continue;
        out.push({ pid: '', name, spec: norm(map.spec != null ? row[map.spec] : ''), qty: Math.max(1, num(map.qty != null ? row[map.qty] : '') || 1), price: num(map.price != null ? row[map.price] : ''), unit: norm(map.unit != null ? row[map.unit] : '') || '件' });
      }
    } else {
      for (const row of grid) {
        const cells = (row || []).map(norm);
        if (!cells[0]) continue;
        out.push({ pid: '', name: cells[0], spec: norm(cells[1]), qty: Math.max(1, num(cells[2]) || 1), price: num(cells[3]), unit: '件' });
      }
    }
    return { rows: out, custName };
  }

  /* ---------- 新建报价（产品行编辑） ---------- */
  function addModal(preCid) {
    const products = DB.products;
    let rows = [{ pid: products[0].id, name: products[0].name, spec: products[0].spec, qty: 1, price: products[0].price, unit: products[0].unit }];
    App.openModal({
      title: '新建报价',
      wide: true,
      html:
        '<div class="form-grid">' +
        '<div class="form-item"><label>客户<b>*</b></label><select class="select" id="qCust">' +
        '<option value="">请选择</option>' +
        DB.customers.filter(c => c.stage !== '已流失' && (App.seeAll() || c.owner === sess.userId))
          .map(c => '<option value="' + c.id + '">' + App.escapeHtml(c.name) + '</option>').join('') +
        '</select><p class="form-error"></p></div>' +
        '<div class="form-item"><label>备注</label><input class="input" id="qNote" placeholder="选填"></div>' +
        '</div>' +
        '<div class="field"><label>产品明细<b>*</b></label>' +
        '<div class="import-row" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">' +
        '<button class="btn btn-sm" id="qImport"><span data-icon="file-spreadsheet"></span>导入 Excel 表格</button>' +
        '<button class="btn btn-sm" id="qTpl"><span data-icon="download"></span>下载导入模板</button>' +
        '<span class="sub-line" id="qImportMsg">先下载模板→按格式填写→再导入，系统自动识别（图片识别开发中）</span></div>' +
        '<div id="qHead" style="margin-bottom:4px">' +
        '<div class="row-actions" style="flex-wrap:wrap">' +
        '<div style="flex:1.2;min-width:150px;font-size:11.5px;color:var(--ink-faint)">① 产品名称（可输入或下拉选择）</div>' +
        '<div style="flex:1.3;min-width:140px;font-size:11.5px;color:var(--ink-faint)">② 规格</div>' +
        '<div style="width:74px;font-size:11.5px;color:var(--ink-faint)">③ 数量</div>' +
        '<div style="width:108px;font-size:11.5px;color:var(--ink-faint)">④ 单价（元）</div>' +
        '<div style="width:72px;font-size:11.5px;color:var(--ink-faint)">⑤ 单位</div>' +
        '<div style="width:96px;font-size:11.5px;color:var(--ink-faint);text-align:right">小计</div>' +
        '<div style="width:34px"></div></div></div>' +
        '<div id="qRows"></div><datalist id="qProdList">' + products.map(x => '<option value="' + App.escapeHtml(x.name) + '">').join('') + '</datalist>' +
        '<button class="btn btn-sm" id="qAddRow" style="margin-top:8px"><span data-icon="plus"></span>加一行</button><p class="form-error" id="qRowsErr"></p></div>' +
        '<div class="import-total" style="margin:0"><span data-icon="coins"></span>报价总金额（客户看到的总价）：<b class="money" id="qTotal" style="margin-left:6px;font-size:16px">¥0</b></div>',
      foot: '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存草稿</button>',
      onMount(box) {
        if (preCid) { const sel = box.querySelector('#qCust'); if (sel) sel.value = preCid; }
        const rowsEl = box.querySelector('#qRows');
        const totalEl = box.querySelector('#qTotal');
        const imp = box.querySelector('#qImport');
        if (imp) imp.addEventListener('click', () => {
          const inp = document.createElement('input');
          inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv';
          inp.onchange = async () => {
            const f = inp.files && inp.files[0];
            if (!f) return;
            const msg = box.querySelector('#qImportMsg');
            msg.textContent = '正在解析「' + f.name + '」…';
            try {
              let grid;
              if (/csv$/i.test(f.name)) {
                const text = await f.text();
                grid = text.split(/\r?\n/).map(line => {
                  const sep = line.indexOf('\t') >= 0 ? '\t' : ',';
                  return line.split(sep).map(x => x.replace(/^"|"$/g, '').trim());
                }).filter(row => row.some(x => x !== ''));
              } else {
                const buf = await f.arrayBuffer();
                const wb = XLSX.read(buf, { type: 'array' });
                grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
              }
              const res = parseGrid(grid);
              if (!res.rows.length) { msg.textContent = '没有识别到有效数据行，请确认第一行是表头（含"产品/数量"等字样）'; return; }
              rows = res.rows; renderRows(); calc();
              if (res.custName) {
                const c = DB.customers.find(x => x.name === res.custName);
                if (c) { box.querySelector('#qCust').value = c.id; msg.textContent = '已识别客户「' + c.name + '」，并导入 ' + res.rows.length + ' 行明细，请核对金额'; }
                else msg.textContent = '已导入 ' + res.rows.length + ' 行明细；表格中的客户「' + res.custName + '」不在客户库，请手动选择客户';
              } else msg.textContent = '已导入 ' + res.rows.length + ' 行明细，请核对数量与单价';
            } catch (err) { msg.textContent = '解析失败：' + err.message; }
          };
          inp.click();
        });
        const tpl = box.querySelector('#qTpl');
        if (tpl) tpl.addEventListener('click', () => {
          try {
            const ws = XLSX.utils.aoa_to_sheet([
              ['客户名称', '产品名称', '规格', '数量', '单价（元）', '单位'],
              [], [], [],
            ]);
            ws['!cols'] = [{ wch: 20 }, { wch: 24 }, { wch: 26 }, { wch: 8 }, { wch: 12 }, { wch: 8 }];
            const ws2 = XLSX.utils.aoa_to_sheet([
              ['填写说明'],
              ["1. 第一个工作表'报价明细'里，从第 5 行开始填写产品明细（前几行留空不影响导入，也可删掉本说明表）。"],
              ["2. 客户名称：必须与系统客户管理里的名称完全一致（一个表格只填一个客户）。"],
              ["3. 产品名称：优先填产品库里已有的名称，系统会自动带出规格和参考单价；库里没有的可以随意填写，作为自定义产品。"],
              ["4. 规格：选填。数量：必填，数字。单价（元）：必填，数字。单位：如 吨 / 根 / 件 / 米。"],
              ["5. 填完后保存，回到新建报价弹窗点'导入 Excel 表格'选择这个文件即可。"],
            ]);
            ws2['!cols'] = [{ wch: 100 }];
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '报价明细');
            XLSX.utils.book_append_sheet(wb, ws2, '填写说明');
            XLSX.writeFile(wb, '报价导入模板.xlsx');
            const msg = box.querySelector('#qImportMsg');
            if (msg) msg.textContent = '模板已下载（在浏览器下载目录），填写后点"导入 Excel 表格"上传';
          } catch (e) { App.toast('模板生成失败：' + e.message, 'danger'); }
        });
        function calc() {
          const total = rows.reduce((s, r) => s + (r.price || 0) * (r.qty || 0), 0);
          totalEl.textContent = App.fmtMoney(total);
        }
        function renderRows() {
          rowsEl.innerHTML = rows.map((r, i) => {
            const p = products.find(x => x.id === r.pid) || {};
            return '<div class="row-actions" style="margin-bottom:8px;flex-wrap:wrap" data-row="' + i + '">' +
              '<input class="input q-name" list="qProdList" value="' + App.escapeHtml(r.name || '') + '" style="flex:1.2;min-width:150px" placeholder="输入产品名（库里没有的可直接自定义）" title="可输入，也可从产品库下拉选择" autocomplete="off">' +
              '<input class="input q-spec" value="' + App.escapeHtml(r.spec || '') + '" style="flex:1.3;min-width:140px" placeholder="规格（可改）" title="规格（可改）">' +
              '<input class="input q-qty num" type="number" min="1" value="' + r.qty + '" style="width:74px" placeholder="数量" title="数量">' +
              '<input class="input q-price num" type="number" min="0" step="0.01" value="' + r.price + '" style="width:108px" placeholder="单价" title="单价（可改）">' +
              '<select class="select q-unit" style="width:72px" title="单位">' +
              unitOptions(r.unit || p.unit).map(u => '<option' + (u === (r.unit || p.unit) ? ' selected' : '') + '>' + u + '</option>').join('') + '</select>' +
              '<span class="money q-sub" style="flex:none;width:96px;text-align:right">' + App.fmtMoney((r.price || 0) * r.qty) + '</span>' +
              '<button class="btn btn-sm btn-danger q-del"' + (rows.length === 1 ? ' disabled' : '') + '><span data-icon="trash-2"></span></button></div>';
          }).join('');
          rowsEl.querySelectorAll('.q-name').forEach(inp => inp.addEventListener('input', () => {
            const i = Number(inp.closest('[data-row]').dataset.row);
            rows[i].name = inp.value;
            const p = products.find(x => x.name === inp.value.trim());
            if (p) {
              rows[i].pid = p.id; rows[i].spec = p.spec; rows[i].unit = p.unit; rows[i].price = p.price;
              const rowDiv = inp.closest('[data-row]');
              rowDiv.querySelector('.q-spec').value = p.spec;
              rowDiv.querySelector('.q-price').value = p.price;
              rowDiv.querySelector('.q-unit').value = p.unit;
              calc();
            }
          }));
          rowsEl.querySelectorAll('.q-spec').forEach(inp => inp.addEventListener('input', () => { rows[Number(inp.closest('[data-row]').dataset.row)].spec = inp.value; }));
          rowsEl.querySelectorAll('.q-qty').forEach(inp => inp.addEventListener('input', () => {
            const i = Number(inp.closest('[data-row]').dataset.row);
            rows[i].qty = Math.max(1, Number(inp.value) || 1); calc();
            inp.closest('[data-row]').querySelector('.q-sub').textContent = App.fmtMoney((rows[i].price || 0) * rows[i].qty);
          }));
          rowsEl.querySelectorAll('.q-price').forEach(inp => inp.addEventListener('input', () => {
            const i = Number(inp.closest('[data-row]').dataset.row);
            rows[i].price = Number(inp.value) || 0; calc();
            inp.closest('[data-row]').querySelector('.q-sub').textContent = App.fmtMoney(rows[i].price * rows[i].qty);
          }));
          rowsEl.querySelectorAll('.q-unit').forEach(sel => sel.addEventListener('change', () => {
            rows[Number(sel.closest('[data-row]').dataset.row)].unit = sel.value;
          }));
          rowsEl.querySelectorAll('.q-del').forEach(btn => btn.addEventListener('click', () => {
            const i = Number(btn.closest('[data-row]').dataset.row);
            rows.splice(i, 1); renderRows(); calc();
          }));
          App.mountIcons(rowsEl);
        }
        renderRows(); calc();
        box.querySelector('#qAddRow').addEventListener('click', () => { rows.push({ pid: products[0].id, name: products[0].name, spec: products[0].spec, qty: 1, price: products[0].price, unit: products[0].unit }); renderRows(); calc(); });
        box.querySelector('[data-act="cancel"]').addEventListener('click', () => App.closeModal());
        box.querySelector('[data-act="ok"]').addEventListener('click', async e => {
          const btn = e.currentTarget;
          const cSel = box.querySelector('#qCust');
          App.formClear(cSel);
          if (!cSel.value) return App.formError(cSel, '请选择客户');
          App.btnLoading(btn);
          const items = rows.map(r => {
            const p = products.find(x => x.id === r.pid);
            return { productId: (p || {}).id || '', name: (r.name || '').trim() || (p ? p.name : ''), spec: (r.spec || '').trim(), unit: r.unit, qty: r.qty, price: r.price };
          });
          const res = await saveQuote({
            customerId: cSel.value, items, owner: sess.userId, note: box.querySelector('#qNote').value,
          });
          App.btnDone(btn);
          if (res.code !== 0) return App.toast(res.msg, 'danger');
          App.closeModal(); App.toast('报价草稿已保存，记得提交审批'); renderList();
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
    /* 从客户页"推进到已报价"跳转过来：自动打开新建报价并预选客户 */
    const sp = new URLSearchParams(location.search);
    if (sp.get('new') === '1') {
      const cid = sp.get('cid');
      if (cid && DB.customers.some(c => c.id === cid)) addModal(cid);
      else addModal();
      try { history.replaceState(null, '', 'quotes.html'); } catch (e) { /* 某些环境限制 replaceState，忽略 */ }
    }
  });
})();
