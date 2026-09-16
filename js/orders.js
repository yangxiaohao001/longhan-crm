/* ============================================================
   orders.js — 订单模块（重设计版）
   列表 + 生产看板（统一走 fetchProductionKanban）+ 订单抽屉：
   全生命周期时间轴 / 大数字金额卡 / 下一步推进（含定金校验+老板强制）
   数据一律经 api.js，页面不自算账。
   ============================================================ */
'use strict';
(function () {
  const root = document.getElementById('pageRoot');
  /* session 必须在 DOMContentLoaded 后取（避免 App 尚未完全就绪） */
  const state = { tab: 'list', kw: '', stage: '', all: false, loaded: false };
  let sess = null;

  const ORDER_FLOW = ['已下单', '生产中', '已发货', '已收款'];
  const NEXT_OF = { '已下单': '生产中', '生产中': '已发货', '已发货': '已收款' };

  function myFilter(list) {
    const s = App.session() || sess;
    if (App.seeAll()) return list;
    return list.filter(x => x.owner === (s && s.userId));
  }

  /* ---------- 列表 ---------- */
  async function renderList() {
    root.innerHTML = '<div class="skeleton s-block"></div><div class="skeleton s-block"></div>';
    const res = await fetchOrders({});
    if (res.code !== 0) { root.innerHTML = '<div class="empty"><p>' + App.escapeHtml(res.msg) + '</p></div>'; return; }
    const all = myFilter(res.data);
    const kw = state.kw.trim();
    const list = all.filter(o =>
      (!state.stage || o.status === state.stage) &&
      (!kw || o.no.includes(kw) || o.customerName.includes(kw)));

    const month = (App.today || new Date().toISOString().slice(0, 10)).slice(0, 7);
    const monthOrders = all.filter(o => String(o.orderDate || '').slice(0, 7) === month);

    root.innerHTML =
      (App.seeAll() ? '' : '<div class="view-banner"><span data-icon="user"></span>我的订单视图：仅显示我负责的订单</div>') +

      '<div class="grid grid-kpi" style="margin-bottom:16px">' +
      '<div class="kpi"><div class="kpi-label"><span data-icon="trending-up"></span>本月新签</div><div class="kpi-value" data-count="' + monthOrders.length + '" data-int="1">—</div><div class="kpi-foot"><span class="kpi-delta">' + monthOrders.length + ' 单</span></div></div>' +
      '<div class="kpi"><div class="kpi-label"><span data-icon="coins"></span>本月成交额</div><div class="kpi-value success" data-count="' + monthOrders.reduce((s, o) => s + o.amount, 0) + '">—</div></div>' +
      '<div class="kpi"><div class="kpi-label"><span data-icon="circle-dollar-sign"></span>未收金额</div><div class="kpi-value warn" data-count="' + all.reduce((s, o) => s + o.balance, 0) + '">—</div></div>' +
      '<div class="kpi"><div class="kpi-label"><span data-icon="alert-triangle"></span>逾期交期</div><div class="kpi-value danger">' + all.filter(o => o.dueInDays != null && o.dueInDays < 0 && o.status !== '已收款').length + ' <small style="font-size:13px">单</small></div></div>' +
      '</div>' +

      '<div class="card"><div class="card-head">' +
      '<div class="chip-row">' + [''].concat(ORDER_FLOW).map(s =>
        '<button class="chip' + (state.stage === s ? ' active' : '') + '" data-stage="' + s + '">' + (s || '全部') + '</button>').join('') + '</div>' +
      '<div class="card-tools"><div class="search-box"><span data-icon="search"></span>' +
      '<input class="input" id="kwInput" placeholder="搜索单号 / 客户名" style="width:190px" value="' + App.escapeHtml(state.kw) + '"><button class="btn btn-sm" id="kwBtn">搜索</button></div>' +
      '<button class="btn btn-sm" id="tabKanban"><span data-icon="columns-2"></span>生产看板</button></div>' +
      '</div><div class="card-body table-wrap"><table class="table">' +
      '<thead><tr><th>订单号</th><th>客户</th><th>金额</th><th>已收</th><th>欠款</th><th>状态</th><th>下单 / 交期</th>' + (App.seeAll() ? '<th>业务员</th>' : '') + '<th>下一步</th></tr></thead><tbody>' +
      (list.length ? list.map(o => {
        const next = NEXT_OF[o.status];
        const overdueDue = o.dueInDays != null && o.dueInDays < 0 && o.status !== '已收款';
        return '<tr>' +
          '<td><span class="row-link" data-oid="' + o.id + '">' + o.no + '</span></td>' +
          '<td>' + App.escapeHtml(o.customerName) + '</td>' +
          '<td class="money">' + App.fmtMoney(o.amount) + '</td>' +
          '<td class="money success">' + App.fmtMoney(o.paid) + '</td>' +
          '<td class="money ' + (o.balance > 0 ? 'balance' : 'success') + '">' + App.fmtMoney(o.balance) + '</td>' +
          '<td>' + App.badge(o.status, App.orderStatusMeta[o.status]) + '</td>' +
          '<td><div>' + o.orderDate + '</div><div class="sub-line">' + (o.dueDate || '—') +
          (overdueDue ? ' <span class="overdue-tag">逾期 ' + Math.abs(o.dueInDays) + ' 天</span>' : '') + '</div></td>' +
          (App.seeAll() ? '<td>' + App.escapeHtml(o.ownerName) + '</td>' : '') +
          '<td>' + (next && canAdvance(o)
            ? '<button class="btn btn-sm btn-primary" data-adv="' + o.id + '">→ ' + next + '</button>'
            : (next ? '<span class="sub-line">需老板/财务操作</span>' : '<span class="sub-line">已完结</span>')) + '</td>' +
          '</tr>';
      }).join('') : '<tr><td colspan="9"><div class="empty"><span data-icon="inbox"></span><p>没有符合条件的订单</p></div></td></tr>') +
      '</tbody></table></div></div>';

    root.querySelectorAll('.kpi-value[data-count]').forEach(el => {
      const v = Number(el.dataset.count);
      if (el.hasAttribute('data-int')) App.countUp(el, v, x => String(Math.round(x)));
      else App.countUp(el, v);
    });
    root.querySelectorAll('[data-oid]').forEach(el => el.addEventListener('click', () => openDrawer(el.dataset.oid)));
    root.querySelectorAll('[data-adv]').forEach(el => el.addEventListener('click', () => advance(el.dataset.adv)));
    root.querySelectorAll('[data-stage]').forEach(el => el.addEventListener('click', () => { state.stage = el.dataset.stage; renderList(); }));
    const kwEl = root.querySelector('#kwInput');
    const doSearch = () => { state.kw = kwEl.value; renderList(); };
    kwEl.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    const kwBtn = root.querySelector('#kwBtn');
    if (kwBtn) kwBtn.addEventListener('click', doSearch);
    root.querySelector('#tabKanban').addEventListener('click', () => { state.tab = 'kanban'; render(); });
    App.mountIcons(root);
  }

  function canAdvance() { return App.can('order.advanceAll') || App.hasFollowup(); }

  /* ---------- 生产看板（统一走 fetchProductionKanban） ---------- */
  async function renderKanban() {
    root.innerHTML = '<div class="skeleton s-block"></div>';
    const res = await fetchProductionKanban();
    if (res.code !== 0) { root.innerHTML = '<div class="empty"><p>' + App.escapeHtml(res.msg) + '</p></div>'; return; }
    const d = res.data;
    const dotCls = { '已下单': 'dot--info', '生产中': 'dot--warn', '已发货': 'dot--danger' };
    root.innerHTML =
      '<div class="card" style="margin-bottom:16px"><div class="card-head"><div class="card-title">生产进度看板</div>' +
      '<div class="card-tools"><span class="card-sub">已收款结案 ' + d.done.count + ' 单 · ' + App.fmtWan(d.done.amount) + '</span>' +
      '<button class="btn btn-sm" id="tabList"><span data-icon="list-checks"></span>订单列表</button></div></div>' +
      '<div class="card-body kanban">' +
      d.cols.map(col =>
        '<div class="kcol"><div class="kcol-head"><span class="dot ' + dotCls[col.stage] + '"></span><b>' + col.stage + '</b>' +
        '<span class="sub">' + col.count + ' 单 · ' + App.fmtWan(col.amount) + '</span></div>' +
        col.cards.map(c =>
          '<div class="kcard" data-oid="' + c.id + '">' +
          '<div class="k-no">' + c.no + (c.productionNo ? ' · ' + c.productionNo : '') + '</div>' +
          '<div class="k-name">' + App.escapeHtml(c.customerName) + '</div>' +
          (c.productionPct != null
            ? '<div class="progress"><i style="width:' + c.productionPct + '%"></i></div>'
            : (c.depositPending ? '<div class="sub-line" style="color:var(--warning)">⌾ 定金未到，暂缓排产</div>' : '')) +
          '<div class="k-meta"><span>' + App.fmtMoney(c.amount) + '</span>' +
          '<span>' + (c.overdueDays > 0 ? '<span class="overdue-tag still">回款逾期 ' + c.overdueDays + 'd</span>' : (c.productionPct != null ? '完工 ' + c.productionPct + '%' : c.orderDate)) + '</span></div>' +
          '</div>').join('') +
        '</div>').join('') +
      '</div></div>';
    root.querySelectorAll('[data-oid]').forEach(el => el.addEventListener('click', () => openDrawer(el.dataset.oid)));
    root.querySelector('#tabList').addEventListener('click', () => { state.tab = 'list'; render(); });
    App.mountIcons(root);
  }

  /* ---------- 订单抽屉 ---------- */
  async function openDrawer(id) {
    const res = await fetchOrderDetail(id);
    if (res.code !== 0) { App.toast(res.msg, 'danger'); return; }
    const o = res.data;

    /* 全生命周期时间轴（修复字段：mock 存的是 ship / done） */
    const nodes = [
      { key: 'ordered', title: '签订合同 / 下单' },
      { key: 'deposit', title: '收取定金' },
      { key: 'production', title: '下达生产' },
      { key: 'ship', title: '发货' },
      { key: 'done', title: '收齐货款 · 结案' },
    ];
    const curIdx = nodes.findIndex(n => o.stageDates && o.stageDates[n.key]);
    const flowIdx = ORDER_FLOW.indexOf(o.status);
    const timeline = nodes.map((n, i) => {
      const dt = (o.stageDates || {})[n.key];
      const cls = dt ? 'done' : (i === (flowIdx >= 0 ? Math.min(flowIdx + 1, nodes.length - 1) : 0) ? 'now' : '');
      const planMap = { ordered: o.orderDate, deposit: '', production: '', ship: o.dueDate, done: o.paymentDue };
      return '<li class="' + cls + '"><span class="t-dot"></span><div class="t-title">' + n.title +
        '<em>' + (dt || (cls === 'now' ? '进行中' : '')) + '</em></div>' +
        (!dt && planMap[n.key] ? '<div class="t-sub">计划 ' + planMap[n.key] + '</div>' : '') + '</li>';
    }).join('');

    const next = NEXT_OF[o.status];
    const payPct = o.amount ? Math.round(o.paid / o.amount * 100) : 0;
    const depPct = DB.settings.depositPct || 0;

    App.openDrawer({
      title: '订单 ' + o.no,
      wide: true,
      html:
        '<div class="mini-stats">' +
        '<div class="mini-stat"><div class="lbl">订单金额</div><div class="val">' + App.fmtMoney(o.amount) + '</div></div>' +
        '<div class="mini-stat"><div class="lbl">已收款</div><div class="val success">' + App.fmtMoney(o.paid) + '</div></div>' +
        '<div class="mini-stat"><div class="lbl">欠款</div><div class="val ' + (o.balance > 0 ? 'danger' : 'success') + '">' + App.fmtMoney(o.balance) + '</div></div>' +
        '<div class="mini-stat"><div class="lbl">交期</div><div class="val" style="font-size:15px">' + (o.dueDate || '—') +
        (o.dueInDays != null && o.dueInDays < 0 && o.status !== '已收款' ? '<div class="sub-line" style="color:var(--danger)">已逾期 ' + Math.abs(o.dueInDays) + ' 天</div>' : '') + '</div></div>' +
        '</div>' +

        '<div class="card" style="margin-bottom:14px"><div class="card-body">' +
        '<div class="prod-top" style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--ink-sub);margin-bottom:6px">' +
        '<b style="color:var(--ink)">回款进度 ' + payPct + '%</b><span>定金要求 ' + depPct + '%</span></div>' +
        '<div class="progress"><i class="' + (payPct >= 100 ? '' : payPct < depPct ? 'danger' : '') + '" style="width:' + payPct + '%"></i></div>' +
        '<div class="row-actions" style="margin-top:14px">' +
        (next && canAdvance(o)
          ? '<button class="btn btn-primary" id="dAdv"><span data-icon="check"></span>推进到「' + next + '」</button>'
          : (next ? '<span class="form-hint">状态推进需老板 / 财务 / 跟单权限</span>' : '<span class="badge badge-success">订单已完结</span>')) +
        (App.can('payment.edit') || o.owner === (App.session() && App.session().userId)
          ? '<button class="btn" id="dPay"><span data-icon="wallet"></span>登记回款</button>' : '') +
        (o.quoteNo ? '<a class="btn" href="quotes.html">关联报价 ' + o.quoteNo + '</a>' : '') +
        (App.isBoss() ? '<button class="btn" id="dEdit"><span data-icon="pencil"></span>编辑订单</button>' : '') +
        (App.isBoss() ? '<button class="btn btn-sm btn-danger" id="dDel"><span data-icon="trash-2"></span>删除</button>' : '') +
        '</div></div></div>' +

        '<div class="card" style="margin-bottom:14px"><div class="card-head"><div class="card-title">全生命周期</div>' +
        (o.status !== '已收款' ? '<span class="card-sub">当前：' + o.status + '</span>' : '') + '</div>' +
        '<div class="card-body"><ul class="timeline">' + timeline + '</ul></div></div>' +

        (o.production && o.production.steps ? (
          '<div class="card" style="margin-bottom:14px"><div class="card-head"><div class="card-title">生产工序</div><span class="card-sub">' + o.production.no + ' · 综合 ' + (o.productionPct || 0) + '%</span></div>' +
          '<div class="card-body">' + o.production.steps.map(s =>
            '<div class="prod-row"><div class="prod-top"><b>' + s.name + '</b><span>' + s.pct + '%</span></div>' +
            '<div class="progress"><i class="' + (s.pct === 0 ? 'danger' : s.pct < 100 ? 'warn' : '') + '" style="width:' + s.pct + '%"></i></div></div>').join('') +
          '</div></div>') : '') +

        '<div class="card" style="margin-bottom:14px"><div class="card-head"><div class="card-title">回款流水</div></div>' +
        (o.payments.length ? '<div class="card-body table-wrap"><table class="table"><thead><tr><th>日期</th><th>类型</th><th>金额</th><th>方式</th><th>记录人</th></tr></thead><tbody>' +
          o.payments.map(p => '<tr><td>' + p.date + '</td><td>' + App.badge(p.type, App.payTypeMeta[p.type]) + '</td>' +
          '<td class="money success">' + App.fmtMoney(p.amount) + '</td><td>' + p.method + '</td><td>' + App.escapeHtml((App.userById(p.recorder) || {}).name) + '</td></tr>').join('') +
          '</tbody></table></div>'
          : '<div class="card-body"><div class="empty"><span data-icon="wallet"></span><p>还没有回款记录</p></div></div>') +
        '</div>' +

        '<div class="field-grid">' +
        '<div><div class="lbl">客户</div><a class="row-link" href="customers.html?cid=' + o.customerId + '" style="font-family:var(--font-body)">' + App.escapeHtml(o.customerName) + '</a></div>' +
        '<div><div class="lbl">业务员</div>' + App.escapeHtml(o.ownerName) + '</div>' +
        '<div><div class="lbl">下单日期</div>' + o.orderDate + '</div>' +
        '<div><div class="lbl">约定付款</div>' + (o.paymentDue || '—') + (o.overdueDays > 0 ? ' <span class="overdue-tag still">逾期 ' + o.overdueDays + ' 天</span>' : '') + '</div>' +
        (o.fileCount ? '</div>' +
        '<div class="card" style="margin:0 0 16px"><div class="card-head"><div class="card-title">附件</div><span class="card-sub">' + o.fileCount + ' 个文件</span></div>' +
        '<div class="card-body"><div class="att-grid">' + o.files.map((f, idx) => {
          const e = (f.name.slice(f.name.lastIndexOf('.') + 1) || '').toUpperCase();
          const isImg = /image/.test(f.mime || '') || ['JPG', 'JPEG', 'PNG', 'GIF', 'WEBP', 'BMP'].includes(e);
          const MAP = { DOC: ['#2b7cd3', 'W'], DOCX: ['#2b7cd3', 'W'], XLS: ['#217346', 'X'], XLSX: ['#217346', 'X'], CSV: ['#217346', 'X'], PPT: ['#d24726', 'P'], PPTX: ['#d24726', 'P'], PDF: ['#e2434c', 'PDF'], ZIP: ['#d97706', 'ZIP'], RAR: ['#d97706', 'ZIP'], '7Z': ['#d97706', 'ZIP'], DWG: ['#8b5cf6', 'CAD'], DXF: ['#8b5cf6', 'CAD'], STEP: ['#8b5cf6', 'CAD'], STP: ['#8b5cf6', 'CAD'], TXT: ['#64748b', 'TXT'], HTML: ['#ea580c', 'HTML'] };
          const badge = MAP[e] || ['#64748b', (e || '文件').slice(0, 4)];
          const size = f.size >= 1048576 ? (f.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((f.size || 0) / 1024)) + ' KB';
          return '<div class="att-tile">' +
            '<a class="att-thumb" href="' + App.escapeHtml(f.url || '#') + '" target="_blank" rel="noopener">' +
            (isImg && f.url ? '<img src="' + App.escapeHtml(f.url) + '" alt="">' :
              '<div class="att-page" style="color:' + badge[0] + '"><span style="' + (badge[1].length > 1 ? 'font-size:12px' : '') + '">' + badge[1] + '</span></div>') +
            '</a>' +
            '<button class="att-del" data-delfile="' + idx + '" title="删除附件"><span data-icon="trash-2"></span></button>' +
            '<div class="att-info">' +
            '<a class="att-name" href="' + App.escapeHtml(f.url || '#') + '" target="_blank" rel="noopener" title="' + App.escapeHtml(f.name) + '">' + App.escapeHtml(f.name) + '</a>' +
            '<div class="att-size">' + (isImg ? '图片' : e) + ' · ' + size + '</div></div>' +
            '</div>';
        }).join('') + '</div></div></div>'
        : '') + (o.fileCount ? '' : '</div>') +
        (o.note ? '<p class="form-hint" style="margin-top:12px">备注：' + App.escapeHtml(o.note) + '</p>' : '') +

        '<div id="dropZone" style="margin-top:14px;border:2px dashed var(--border-strong);border-radius:10px;padding:18px 12px;text-align:center;cursor:pointer;transition:all .15s;color:var(--ink-sub)">' +
        '<div style="font-size:13.5px;color:var(--ink)"><b>拖拽文件到此处上传</b>（支持从微信 / QQ 直接拖入）</div>' +
        '<div class="sub-line" style="margin-top:4px">Word / PDF / Excel / 图片 / CAD / 压缩包均可 · 单个不超过 50MB · 可多选</div>' +
        '<button class="btn btn-sm" id="dUpload" style="margin-top:8px"><span data-icon="upload"></span>或点击选择文件</button>' +
        '</div>',
      onMount(box) {
        const adv = box.querySelector('#dAdv');
        if (adv) adv.addEventListener('click', () => advance(id, () => { App.closeDrawer(); render(); }));
        const pay = box.querySelector('#dPay');
        if (pay) pay.addEventListener('click', () => payModal(o, () => { App.closeDrawer(); render(); }));
        const up = box.querySelector('#dUpload');
        if (up) up.addEventListener('click', e => { e.stopPropagation(); uploadFiles(o, () => { App.closeDrawer(); openDrawer(id); }); });
        /* 拖拽上传：支持从微信 / QQ / 资源管理器直接拖入 */
        const dz = box.querySelector('#dropZone');
        if (dz) {
          const highlight = on => { dz.style.borderColor = on ? 'var(--primary)' : 'var(--border-strong)'; dz.style.background = on ? 'var(--primary-dim)' : 'transparent'; };
          ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); highlight(true); }));
          ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); highlight(false); }));
          dz.addEventListener('drop', e => {
            const files = Array.from(e.dataTransfer.files || []);
            if (!files.length) return App.toast('没有识别到文件，请重试', 'warn');
            uploadFiles(o, files, () => { App.closeDrawer(); openDrawer(id); });
          });
        }
        const edit = box.querySelector('#dEdit');
        if (edit) edit.addEventListener('click', () => editOrderModal(o, () => { App.closeDrawer(); render(); }));
        const del = box.querySelector('#dDel');
        if (del) del.addEventListener('click', () => App.confirm({
          title: '删除订单 ' + o.no + '？', html: '将同时删除该订单的全部回款记录。此操作不可恢复。',
          okText: '确认删除', danger: true,
          onOk: async () => {
            const r = await adminDeleteOrder(id);
            if (r.code !== 0) return App.toast(r.msg, 'danger');
            App.toast('订单已删除'); App.closeDrawer(); render();
          },
        }));
        const dFile = box.querySelectorAll('[data-delfile]');
        const oRef = o;
        dFile.forEach(b => b.addEventListener('click', async () => {
          const idx = Number(b.dataset.delfile);
          const f = (oRef.files || [])[idx];
          if (!f) return;
          App.confirm({ title: '删除附件？', html: '将删除「' + App.escapeHtml(f.name) + '」', danger: true, okText: '删除',
            onOk: async () => {
              await App.dbRemove(f);
              oRef.files.splice(idx, 1);
              _cloudSync("orders", "upsert", oRef);   /* 嵌套数组变更不触发钩子，显式同步 */
              App.toast('附件已删除');
              App.closeDrawer(); openDrawer(id);
            }
          });
        }));
        App.mountIcons(box);
      },
    });
  }

  /* 上传附件：files 为 FileList/数组（拖拽或选择均可），任意常见格式 */
  function uploadFiles(o, files, done) {
    /* 兼容按钮点击（第二参数为回调）：弹出文件选择框 */
    if (typeof files === 'function') { done = files; files = null; }
    if (!files) {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.multiple = true;
      inp.onchange = () => { if (inp.files && inp.files.length) uploadFiles(o, Array.from(inp.files), done); };
      inp.click();
      return;
    }
    const list = Array.from(files || []);
    if (!list.length) return;
    App.toast('正在上传 ' + list.length + ' 个文件…', 'info');
    let okCount = 0, failMsg = '';
    setTimeout(async () => {
      for (const f of list) {
        if (f.size > 50 * 1024 * 1024) { failMsg = '「' + f.name + '」超过 50MB，已跳过'; continue; }
        const r = await App.dbUpload(o.id, f);
        if (r.ok) {
          o.files = o.files || [];
          o.files.push({ name: r.name, size: r.size, mime: r.mime, url: r.url, path: r.path });
          okCount++;
        } else failMsg = '「' + f.name + '」上传失败：' + r.msg;
      }
      /* files 是嵌套数组，不触发同步钩子，必须显式同步 */
      _cloudSync("orders", "upsert", o);
      if (failMsg) App.toast(failMsg, okCount ? 'warn' : 'danger');
      App.toast(okCount ? '上传完成（' + okCount + ' 个文件）' : '没有文件上传成功', okCount ? 'success' : 'danger');
      if (done) done();
    }, 50);
  }

  /* ---------- 推进（含定金校验 + 老板强制） ---------- */
  async function advance(id, done) {
    const res = await advanceOrderStage(id);
    if (res.code === 0) {
      App.toast('已推进到「' + res.data.status + '」');
      if (done) done(); else render();
      return;
    }
    if (res.code === 2) {
      /* 定金不足：仅老板可强制 */
      if (App.isBoss()) {
        App.confirm({
          title: '定金未达标，确认发货？',
          html: res.msg + '<br><br>强制发货将记录本次操作。请确认已与客户口头约定。',
          okText: '老板确认发货', danger: true,
          onOk: async () => {
            const r2 = await advanceOrderStage(id, { force: true });
            if (r2.code === 0) { App.toast('已强制推进到「' + r2.data.status + '」'); if (done) done(); else render(); }
            else App.toast(r2.msg, 'danger');
          },
        });
      } else {
        App.toast(res.msg, 'danger');
      }
      return;
    }
    App.toast(res.msg, 'danger');
  }

  /* ---------- 登记回款弹窗 ---------- */
  function payModal(o, done) {
    const opts = [];
    if (o.paid === 0) opts.push('定金');
    if (o.balance > 0 && o.paid > 0) opts.push('尾款', '部分尾款');
    App.openModal({
      title: '登记回款 · ' + o.no,
      html:
        '<div class="form-hint" style="margin-bottom:12px">应收余额 <b class="money warn">' + App.fmtMoney(o.balance) + '</b>，欠款客户：' + App.escapeHtml(o.customerName) + '</div>' +
        '<div class="field"><label>回款类型</label><select class="select" id="pType">' + opts.map(t => '<option>' + t + '</option>').join('') + '</select></div>' +
        '<div class="form-grid">' +
        '<div class="form-item"><label>金额（元）<b>*</b></label><input class="input num" id="pAmt" type="number" min="1" step="0.01" value="' + (o.balance || '') + '"><p class="form-error"></p></div>' +
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
          const res = await savePayment({
            orderId: o.id, amount: amt, type: box.querySelector('#pType').value,
            date: box.querySelector('#pDate').value, method: box.querySelector('#pMethod').value,
            note: box.querySelector('#pNote').value, recorder: (App.session() && App.session().userId),
          });
          App.btnDone(btn);
          if (res.code !== 0) return App.toast(res.msg, 'danger');
          App.closeModal();
          App.toast(res.data.settled ? '回款登记成功，尾款已结清并结案' : '回款登记成功');
          if (done) done();
        });
      },
    });
  }

  /* URL 直达订单 */
  function openFromUrl() {
    const oid = new URLSearchParams(location.search).get('oid');
    if (oid) { history.replaceState(null, '', 'orders.html'); openDrawer(oid); }
  }

  function render() { state.tab === 'kanban' ? renderKanban() : renderList(); }

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
    await render();
    openFromUrl();
  });
})();

/* ---------- 总经理：编辑订单（改金额/日期/状态/付款进度） ---------- */
function editOrderModal(o, done) {
  const users = DB.users.map(u => '<option value="' + u.id + '"' + (u.id === o.owner ? ' selected' : '') + '>' + App.escapeHtml(u.name) + '</option>').join('');
  App.openModal({
    title: '编辑订单 · ' + o.no, wide: true,
    html:
      '<div class="form-grid">' +
      '<div class="form-item"><label>订单状态</label><select class="select" id="eStatus"><option>已下单</option><option>生产中</option><option>已发货</option><option>已收款</option></select></div>' +
      '<div class="form-item"><label>业务员</label><select class="select" id="eOwner">' + users + '</select></div>' +
      '<div class="form-item"><label>订单金额（元）<b>*</b></label><input class="input num" id="eAmount" type="number" min="0" step="0.01" value="' + o.amount + '"><p class="form-error"></p></div>' +
      '<div class="form-item"><label>已收款（元）</label><input class="input num" id="ePaid" type="number" min="0" step="0.01" value="' + o.paid + '"><p class="form-error"></p></div>' +
      '<div class="form-item"><label>下单日期</label><input class="input" id="eOrderDate" type="date" value="' + o.orderDate + '"></div>' +
      '<div class="form-item"><label>交期</label><input class="input" id="eDueDate" type="date" value="' + (o.dueDate || '') + '"></div>' +
      '<div class="form-item"><label>约定付款日</label><input class="input" id="ePayDue" type="date" value="' + (o.paymentDue || '') + '"></div>' +
      '<div class="form-item"><label>关联报价单号</label><input class="input" id="eQuoteNo" value="' + App.escapeHtml(o.quoteNo || '') + '"></div>' +
      '<div class="form-item" style="grid-column:1/-1"><label>备注</label><textarea class="textarea" id="eNote">' + App.escapeHtml(o.note || '') + '</textarea></div>' +
      '</div>' +
      '<p class="form-hint" style="margin-top:8px">注：修改"已收款"金额不会自动写回款流水，如有差异请去「回款」页调整。</p>',
    foot: '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存修改</button>',
    onMount(box) {
      box.querySelector('#eStatus').value = o.status;
      box.querySelector('[data-act="cancel"]').addEventListener('click', () => App.closeModal());
      box.querySelector('[data-act="ok"]').addEventListener('click', async e => {
        const btn = e.currentTarget;
        const amtEl = box.querySelector('#eAmount');
        App.formClear(amtEl);
        const amt = Number(amtEl.value);
        if (!amt || amt <= 0) return App.formError(amtEl, '请填写正确的金额');
        const paid = Number(box.querySelector('#ePaid').value) || 0;
        if (paid > amt + 0.01) return App.toast('已收款不能超过订单金额', 'danger');
        App.btnLoading(btn);
        const r = await adminUpdateOrder(o.id, {
          amount: amt, paid, status: box.querySelector('#eStatus').value,
          owner: box.querySelector('#eOwner').value,
          orderDate: box.querySelector('#eOrderDate').value || o.orderDate,
          dueDate: box.querySelector('#eDueDate').value,
          paymentDue: box.querySelector('#ePayDue').value,
          quoteNo: box.querySelector('#eQuoteNo').value,
          note: box.querySelector('#eNote').value,
        });
        App.btnDone(btn);
        if (r.code !== 0) return App.toast(r.msg, 'danger');
        App.closeModal(); App.toast('订单已保存');
        if (done) done();
      });
    },
  });
}
