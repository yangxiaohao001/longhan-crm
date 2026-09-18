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
      '<thead><tr>' + (App.isBoss() ? '<th style="width:34px"><input type="checkbox" class="chk-all" title="全选"></th>' : '') + '<th>报价单</th><th>客户</th><th>版本</th><th>金额</th><th>状态</th><th>有效期</th>' + (App.seeAll() ? '<th>业务员</th>' : '') + '<th></th></tr></thead><tbody>' +
      (list.length ? list.map(q => {
        const expiring = q.status === '已发送' && q.validInDays != null && q.validInDays <= 3;
        return '<tr>' + (App.isBoss() ? '<td><input type="checkbox" class="row-chk" data-id="' + q.id + '"></td>' : '') +
          '<td><span class="row-link" data-qid="' + q.id + '">' + q.no + '</span></td>' +
          '<td>' + App.escapeHtml(q.customerName) + '</td>' +
          '<td>v' + q.version + '</td>' +
          '<td class="money">' + App.fmtMoney(q.total) + '</td>' +
          '<td>' + App.badge(q.status, App.quoteStatusMeta[q.status]) + '</td>' +
          '<td>' + (q.validUntil ? q.validUntil + (expiring ? ' <span class="overdue-tag still">' + App.relDays(q.validInDays) + '</span>' : '') : '—') + '</td>' +
          (App.seeAll() ? '<td>' + App.escapeHtml(q.ownerName) + '</td>' : '') +
          '<td>' + (readOnly ? '<span class="sub-line">只读</span>' : '<button class="btn btn-sm" data-qid2="' + q.id + '">查看</button>') + '</td>' +
          '</tr>';
      }).join('') : '<tr><td colspan="' + (App.isBoss() ? 9 : 8) + '"><div class="empty"><span data-icon="inbox"></span><p>没有符合条件的报价</p></div></td></tr>') +
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
    if (App.isBoss() && typeof list !== 'undefined' && list.length) App.bindBatch(root, {
      onDelete: ids2 => App.confirm({
        title: '批量删除 ' + ids2.length + ' 个报价？',
        html: '已成交并生成订单的报价会<b>自动跳过</b>，其余将被删除且不可恢复。',
        okText: '确认删除', danger: true,
        onOk: async () => {
          let skip = 0;
          for (const qid of ids2) { const r = await deleteQuote(qid); if (r.code !== 0) skip++; }
          App.toast('已删除 ' + (ids2.length - skip) + ' 个报价' + (skip ? '，自动跳过 ' + skip + ' 个（已成交）' : ''));
          renderList();
        },
      }),
    });
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

        ((() => {
          const sp = (typeof _splitImportNote === 'function') ? _splitImportNote(q.note) : { text: q.note || '', files: [] };
          let h = '';
          if (sp.files.length) h += '<div class="field" style="margin-bottom:12px"><label>导入文件</label>' +
            sp.files.map(f2 => '<div class="file-card"><div class="fc-icon" style="background:#8b5cf6">表格</div><div class="fc-body">' +
            '<a class="fc-name" href="' + App.escapeHtml(f2.url) + '" target="_blank" rel="noopener">' + App.escapeHtml(f2.name) + '</a>' +
            '<div class="fc-meta">报价导入源文件 · 点击查看</div></div></div>').join('') + '</div>';
          if (sp.text) h += '<p class="form-hint" style="margin-bottom:14px">备注：' + App.escapeHtml(sp.text) + '</p>';
          return h;
        })()) +

        '<div class="row-actions">' +
        '<button class="btn" id="qPrintBtn"><span data-icon="download"></span>打印 / 导出 PDF</button>' +
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
        const pb = box.querySelector('#qPrintBtn');
        if (pb) pb.addEventListener('click', () => buildPrintDoc(q, ver));
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

  /* ---------- 人民币大写（用于报价单打印） ---------- */
  function rmbUpper(n) {
    n = Math.round(n * 100) / 100;
    const frac = Math.round((n % 1) * 100); const ints = Math.floor(n);
    const D = '零壹贰叁肆伍陆柒捌玖'; const U = ['', '拾', '佰', '仟']; const G = ['', '万', '亿', '兆'];
    if (!ints && !frac) return '零元整';
    let s = '', gi = 0, x = ints;
    while (x > 0) {
      const seg = x % 10000;
      if (seg) {
        let t = '', z = false, v = seg;
        for (let u = 0; v > 0; u++) {
          const d = v % 10;
          if (d === 0) { if (!z && t) { t = '零' + t; z = true; } }
          else { t = D[d] + U[u] + t; z = false; }
          v = Math.floor(v / 10);
        }
        s = t + G[gi] + s;
      } else if (s && !s.startsWith('零')) s = '零' + s;
      x = Math.floor(x / 10000); gi++;
    }
    s += ints ? '元' : '';
    if (frac === 0) s += '整';
    else {
      const j = Math.floor(frac / 10), f = frac % 10;
      s += (j ? D[j] + '角' : (ints ? '零' : ''));
      if (f) s += D[f] + '分'; else if (!j) s += '整';
    }
    return '人民币' + s;
  }

  /* ---------- 生成正式报价单打印视图（浏览器打印对话框中选"另存为 PDF"） ---------- */
  function buildPrintDoc(q, ver) {
    const esc = App.escapeHtml;
    const cust = q.customer || {};
    const items = ver.items.map((i, idx) =>
      '<tr><td style="text-align:center">' + (idx + 1) + '</td>' +
      '<td>' + esc(i.name) + '</td><td>' + esc(i.spec || '') + '</td>' +
      '<td style="text-align:center">' + esc(i.unit || '') + '</td>' +
      '<td style="text-align:right">' + i.qty + '</td>' +
      '<td style="text-align:right">' + App.fmtMoney(i.price) + '</td>' +
      '<td style="text-align:right">' + App.fmtMoney(i.qty * i.price) + '</td></tr>').join('');
    let area = document.getElementById('printArea');
    if (!area) { area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); }
    area.innerHTML =
      '<div class="pr-company">河北龙瀚金属制品有限公司</div>' +
      '<div class="pr-title">报  价  单</div>' +
      '<div class="pr-row"><span>NO：' + esc(q.no) + '</span><span>报价日期：' + esc(q.createdAt) + '</span></div>' +
      '<div class="pr-row"><span>客户名称：' + esc(q.customerName) + '</span><span>联系人：' + esc(cust.contact || '') + (cust.phone ? ' / ' + esc(cust.phone) : '') + '</span></div>' +
      '<table><thead><tr><th style="width:36px">序号</th><th>产品名称</th><th>规格 / 材质说明</th><th style="width:48px">单位</th><th style="width:60px">数量</th><th style="width:82px">单价（元）</th><th style="width:92px">小计（元）</th></tr></thead><tbody>' +
      items +
      '</tbody></table>' +
      '<div class="pr-row" style="margin-top:8px"><span>合计金额：<b>' + rmbUpper(q.total) + '</b></span><span>（小写：¥' + App.fmtMoney(q.total) + '）</span></div>' +
      '<div class="pr-note">' +
      '<div>报价说明：</div>' +
      '<div>1、本报价为出厂含税价（增值税税率 13%），不含运输、安装及现场配合费用。</div>' +
      '<div>2、报价有效期：至 ' + esc(q.validUntil || '出具之日起 30 天') + '（逾期或主要原材料价格波动超过 ±5% 时，价格另行协商）。</div>' +
      '<div>3、付款方式：合同签订后预付 50%，发货前结清全部余款。</div>' +
      '<div>4、交货周期：确认订单后 5-7 个工作日（特殊规格另行确认）。</div>' +
      '</div>' +
      '<div class="pr-sign"><span>报价人（业务员）：' + esc(q.ownerName) + '</span><span>审核人：______________</span><span>（公司盖章）</span></div>';
    try { window.print(); } catch (e) { /* 部分环境禁用打印，忽略 */ }
  }

  /* ---------- Excel / CSV 表格解析：识别表头列，导出报价明细行 ---------- */
  function parseGrid(grid) {
    const norm = x => String(x == null ? '' : x).trim();
    const KEY = { cust: ['客户'], name: ['产品名称', '产品', '品名', '名称', '材料', '物料', '货品'], spec: ['规格', '型号'], radius: ['半径'], qty: ['数量'], unit: ['单位'], price: ['单价', '价格'] };
    let headIdx = -1, map = null;
    for (let i = 0; i < Math.min(grid.length, 8); i++) {
      const row = (grid[i] || []).map(norm);
      const m = {}; const used = new Set(); let hits = 0;
      Object.keys(KEY).forEach(k => {
        const idx = row.findIndex((cell, ci) => !used.has(ci) && KEY[k].some(kw => cell.includes(kw)));
        if (idx >= 0) { m[k] = idx; used.add(idx); hits++; }
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
        if (!name || /税金|合计|小计|总计|示例|说明|条款|付款|有效期|人民币|盖章|报价人|审核人|联系人|报价单位|报价时间|交货周期|单位参考|报价日期/.test(name)) continue;
        let spec = norm(map.spec != null ? row[map.spec] : '');
        const radius = norm(map.radius != null ? row[map.radius] : '');
        if (radius) spec = (spec ? spec + ' ' : '') + 'R' + radius;
        out.push({ pid: '', name, spec, qty: Math.max(1, num(map.qty != null ? row[map.qty] : '') || 1), price: num(map.price != null ? row[map.price] : ''), unit: norm(map.unit != null ? row[map.unit] : '') || '件' });
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
    /* 报价有效期默认 1 个月，可编辑 */
    const dv = (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
    let rows = [{ pid: products[0].id, name: products[0].name, spec: products[0].spec, qty: 1, price: products[0].price, unit: products[0].unit }];
    let importedFiles = [];   /* 本次弹窗内导入过的源文件（上传 Promise），保存时全部写入备注标记 */
    let firstImportDone = false;
    App.openModal({
      title: '新建报价',
      wide: true,
      html:
        '<div class="form-grid">' +
        '<div class="form-item"><label>客户<b>*</b>（输入筛选，也可直接创建）</label><input class="input" id="qCust" list="qCustList" placeholder="输入关键词筛选；输入新名称保存时自动建档" autocomplete="off">' +
        '<datalist id="qCustList">' +
        DB.customers.filter(c => c.stage !== '已流失' && (App.seeAll() || c.owner === sess.userId))
          .map(c => '<option value="' + App.escapeHtml(c.name) + '">').join('') +
        '</datalist><p class="form-error"></p></div>' +
        '<div class="form-item"><label>报价有效期至（默认 1 个月，可改）</label><input class="input" id="qValid" type="date" value="' + dv + '"></div>' +
        '<div class="form-item"><label>备注</label><input class="input" id="qNote" placeholder="选填"></div>' +
        '</div>' +
        '<div class="field"><label>产品明细<b>*</b></label>' +
        '<div class="import-row" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">' +
        '<button class="btn btn-sm" id="qImport"><span data-icon="file-spreadsheet"></span>导入 Excel 表格</button>' +
        '<button class="btn btn-sm" id="qTpl1"><span data-icon="download"></span>旋转楼梯模板</button>' +
        '<button class="btn btn-sm" id="qTpl2"><span data-icon="download"></span>拉弯模板</button>' +
        '<span class="sub-line" id="qImportMsg">先下载模板→按格式填写→再导入；支持把 Excel/CSV 从微信直接拖到下方虚线框</span></div>' +
        '<div id="qDrop" class="q-drop">将 Excel / CSV 文件拖到此处上传（支持从微信 / QQ 直接拖入）</div>' +
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
        if (preCid) { const inp = box.querySelector('#qCust'); const pc = DB.customers.find(x => x.id === preCid); if (inp && pc) inp.value = pc.name; }
        const rowsEl = box.querySelector('#qRows');
        const totalEl = box.querySelector('#qTotal');
        async function doImportFile(f) {
          if (!f) return;
          if (!/\.(xlsx|xls|csv)$/i.test(f.name)) { App.toast('请拖入或选择 Excel / CSV 文件（不支持「' + f.name + '」）', 'warn'); return; }
          {
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
              /* 首次导入替换默认占位行，之后导入追加累加 */
              rows = firstImportDone ? rows.concat(res.rows) : res.rows;
              firstImportDone = true;
              renderRows(); calc();
              if (res.custName) {
                const c = DB.customers.find(x => x.name === res.custName);
                if (c) { box.querySelector('#qCust').value = c.name; msg.textContent = '已识别客户「' + c.name + '」，并导入 ' + res.rows.length + ' 行明细，请核对金额'; }
                else msg.textContent = '已导入 ' + res.rows.length + ' 行明细；表格中的客户「' + res.custName + '」不在客户库，请手动选择客户';
              } else msg.textContent = '已导入 ' + res.rows.length + ' 行明细，请核对数量与单价';
              /* 导入的源文件上传到云存储，保存报价后作为附件留档展示 */
              importedFiles.push(
                App.dbUpload('quote-imports', f).then(r => {
                  if (!r || !r.ok) { console.warn('[导入留档] 源文件上传失败：' + (r ? r.msg : '未知')); return null; }
                  return { name: r.name, size: r.size, mime: r.mime, url: r.url, path: r.path };
                }).catch(err => { console.warn('[导入留档] 源文件上传异常：' + err.message); return null; })
              );
            } catch (err) { msg.textContent = '解析失败：' + err.message; }
          };
        };
        const imp = box.querySelector('#qImport');
        if (imp) imp.addEventListener('click', () => {
          const inp = document.createElement('input');
          inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv';
          inp.onchange = () => { if (inp.files && inp.files[0]) doImportFile(inp.files[0]); };
          inp.click();
        });
        /* 拖拽导入：支持从微信 / QQ / 资源管理器直接拖入 */
        const dz = box.querySelector('#qDrop');
        if (dz) {
          const highlight = on => { dz.classList.toggle('on', on); };
          ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); highlight(true); }));
          ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); highlight(false); }));
          dz.addEventListener('drop', e => {
            const files = Array.from(e.dataTransfer.files || []);
            if (!files.length) return App.toast('没有识别到文件，请重试', 'warn');
            const ok = files.find(f => /\.(xlsx|xls|csv)$/i.test(f.name));
            if (!ok) return App.toast('请拖入 Excel / CSV 文件', 'warn');
            doImportFile(ok);
          });
        }
        /* 两个正式模板文件（openpyxl 生成、含完整排版），以 base64 内嵌，下载即成品 */
        const TPL_B64 = {
          stair: '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',
          bend: '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',
        };
        const buildTpl = type => {
          const b64 = TPL_B64[type];
          if (!b64) return;
          try {
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = type === 'stair' ? '旋转楼梯报价单模板.xlsx' : '拉弯报价单模板.xlsx';
            document.body.appendChild(a);
            a.click();
            a.remove();
            const msg = box.querySelector('#qImportMsg');
            if (msg) msg.textContent = '模板已下载：' + a.download + '（在浏览器下载目录）';
          } catch (e) { App.toast('模板下载失败：' + e.message, 'danger'); }
        };
        const t1 = box.querySelector('#qTpl1');
        if (t1) t1.addEventListener('click', () => buildTpl('stair'));
        const t2 = box.querySelector('#qTpl2');
        if (t2) t2.addEventListener('click', () => buildTpl('bend'));
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
          if (!cSel.value.trim()) return App.formError(cSel, '请选择或输入客户名称');
          App.btnLoading(btn);
          /* 客户名精确匹配现有客户；不匹配则自动建档（联系人/电话留待补充，负责人=当前登录人） */
          const cname = cSel.value.trim();
          let cid = (DB.customers.find(c => c.name === cname) || {}).id;
          if (!cid) {
            const cr = await saveCustomer({ name: cname, owner: sess.userId, quick: true });
            if (cr.code !== 0) { App.btnDone(btn); return App.toast('自动建档失败：' + cr.msg, 'danger'); }
            cid = cr.data.id;
          }
          const items = rows.map(r => {
            const p = products.find(x => x.id === r.pid);
            return { productId: (p || {}).id || '', name: (r.name || '').trim() || (p ? p.name : ''), spec: (r.spec || '').trim(), unit: r.unit, qty: r.qty, price: r.price };
          });
          let noteVal = box.querySelector('#qNote').value;
          const metas = (await Promise.all(importedFiles)).filter(Boolean);
          metas.forEach(m => { noteVal += (noteVal ? '\n' : '') + '[导入文件]' + m.name + '|' + m.url; });
          const res = await saveQuote({
            customerId: cid, items, owner: sess.userId, note: noteVal,
            validUntil: box.querySelector('#qValid').value,
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
