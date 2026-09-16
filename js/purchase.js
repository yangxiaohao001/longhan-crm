/* ============================================================
   purchase.js — 采购管理（新模块）
   流程：业务/老板申请 → 老板审批 → 财务付款 → 入库
   角色：sales 只读 + 可发起；boss 审批+全部；finance 付款登记
   ============================================================ */
'use strict';
(function () {
  const root = document.getElementById('pageRoot');
  const sess = App.session();
  const state = { kw: '', status: '' };
  const FLOW = ['待审批', '已审批', '已付款', '已入库'];

  async function renderList() {
    root.innerHTML = '<div class="skeleton s-block"></div>';
    const filters = {};
    if (state.status) filters.status = state.status;
    const res = await fetchPurchases(filters);
    if (res.code !== 0) { root.innerHTML = '<div class="empty"><p>' + App.escapeHtml(res.msg) + '</p></div>'; return; }
    const kw = state.kw.trim();
    const list = res.data.filter(p => !kw || p.no.includes(kw) || p.title.includes(kw) || p.supplierName.includes(kw));
    const canReq = App.can('purchase.request');
    const canApp = App.can('purchase.approve');
    const canPay = App.can('purchase.pay');

    root.innerHTML =
      '<div class="view-banner"><span data-icon="truck"></span>采购流程：申请 → 老板审批 → 财务付款 → 到货入库；金额由明细自动合计</div>' +

      '<div class="card" style="margin-bottom:16px"><div class="card-head">' +
      '<div class="chip-row">' + [''].concat(FLOW).map(s =>
        '<button class="chip' + (state.status === s ? ' active' : '') + '" data-st="' + s + '">' + (s || '全部') + '</button>').join('') + '</div>' +
      '<div class="card-tools"><div class="search-box"><span data-icon="search"></span>' +
      '<input class="input" id="kwInput" placeholder="搜单号 / 标题 / 供应商" style="width:180px" value="' + App.escapeHtml(state.kw) + '"><button class="btn btn-sm" id="kwBtn">搜索</button></div>' +
      (canReq ? '<button class="btn btn-primary btn-sm" id="addBtn"><span data-icon="plus"></span>发起采购申请</button>' : '') +
      (App.isBoss() || App.can('purchase.request') ? '<button class="btn btn-sm" id="supBtn"><span data-icon="building-2"></span>供应商管理</button>' : '') +
      '</div></div>' +
      '<div class="card-body table-wrap"><table class="table">' +
      '<thead><tr><th>采购单</th><th>标题</th><th>供应商</th><th>关联订单</th><th>金额</th><th>状态</th><th>申请人 / 日期</th><th></th></tr></thead><tbody>' +
      (list.length ? list.map(p => {
        const nextAct =
          p.status === '待审批' && canApp ? '<button class="btn btn-sm btn-primary" data-act2="approve" data-pid="' + p.id + '">审批通过</button>' :
          p.status === '已审批' && canPay ? '<button class="btn btn-sm btn-primary" data-act2="pay" data-pid="' + p.id + '">登记付款</button>' :
          p.status === '已付款' && canPay ? '<button class="btn btn-sm btn-warn" data-act2="receive" data-pid="' + p.id + '">确认入库</button>' :
          '<span class="sub-line">' +
          (p.status === '待审批' ? '等老板审批' : p.status === '已审批' ? '等财务付款' : p.status === '已付款' ? '等入库' : '已完结') + '</span>';
        return '<tr>' +
          '<td><span class="row-link" data-pid2="' + p.id + '">' + p.no + '</span></td>' +
          '<td>' + App.escapeHtml(p.title) + '</td>' +
          '<td>' + App.escapeHtml(p.supplierName) + '</td>' +
          '<td>' + (p.orderNo ? '<span class="row-link" onclick="location.href=\'orders.html?oid=' + p.orderId + '\'">' + p.orderNo + '</span>' : '<span class="sub-line">备货</span>') + '</td>' +
          '<td class="money">' + App.fmtMoney(p.amount) + '</td>' +
          '<td>' + App.badge(p.status, App.purchaseStatusMeta[p.status]) + '</td>' +
          '<td>' + App.escapeHtml(p.requesterName) + '<div class="sub-line">' + p.createdAt + '</div></td>' +
          '<td><div class="row-actions">' + nextAct + '</div></td>' +
          '</tr>';
      }).join('') : '<tr><td colspan="8"><div class="empty"><span data-icon="inbox"></span><p>暂无采购单</p></div></td></tr>') +
      '</tbody></table></div></div>' +

      '<div class="card"><div class="card-head"><div class="card-title">供应商档案</div><span class="card-sub">' + DB.suppliers.length + ' 家</span></div>' +
      '<div class="card-body table-wrap"><table class="table">' +
      '<thead><tr><th>供应商</th><th>分类</th><th>联系人</th><th>电话</th><th></th></tr></thead><tbody>' +
      (DB.suppliers.length ? DB.suppliers.map(s =>
        '<tr data-sid="' + s.id + '">' +
        '<td style="font-weight:600">' + App.escapeHtml(s.name) + '</td>' +
        '<td><span class="badge">' + App.escapeHtml(s.category || '其他') + '</span></td>' +
        '<td>' + App.escapeHtml(s.contact || '—') + '</td>' +
        '<td class="num">' + App.escapeHtml(s.phone || '—') + '</td>' +
        '<td><div class="row-actions">' +
        '<button class="btn btn-sm" data-aredit="' + s.id + '"><span data-icon="pencil"></span>编辑</button>' +
        '<button class="btn btn-sm btn-danger" data-adel="' + s.id + '"><span data-icon="trash-2"></span>删除</button>' +
        '</div></td></tr>').join('')
        : '<tr><td colspan="5"><div class="empty"><span data-icon="inbox"></span><p>暂无供应商，点右上角「供应商管理」添加</p></div></td></tr>') +
      '</tbody></table></div></div>';

    root.querySelectorAll('[data-pid2]').forEach(el => el.addEventListener('click', () => openDrawer(el.dataset.pid2)));
    root.querySelectorAll('[data-st]').forEach(el => el.addEventListener('click', () => { state.status = el.dataset.st; renderList(); }));
    root.querySelectorAll('[data-act2]').forEach(el => el.addEventListener('click', () => advance(el.dataset.pid, el.dataset.act2)));
    root.querySelectorAll('[data-aredit]').forEach(el => el.addEventListener('click', () => supplierEditModal(el.dataset.aredit, renderList)));
    root.querySelectorAll('[data-adel]').forEach(el => el.addEventListener('click', () => App.confirm({
      title: '删除该供应商？', html: '将从供应商档案中删除（已被采购单使用的不能删）。', okText: '删除', danger: true,
      onOk: async () => {
        const r = await deleteSupplier(el.dataset.adel);
        if (r.code !== 0) return App.toast(r.msg, 'danger');
        App.toast('供应商已删除'); renderList();
      },
    })));
    const kwEl = root.querySelector('#kwInput');
    const doSearch = () => { state.kw = kwEl.value; renderList(); };
    kwEl.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    const kwBtn = root.querySelector('#kwBtn');
    if (kwBtn) kwBtn.addEventListener('click', doSearch);
    const add = root.querySelector('#addBtn');
    if (add) add.addEventListener('click', addModal);
    const supBtn = root.querySelector('#supBtn');
    if (supBtn) supBtn.addEventListener('click', suppliersModal);
    App.mountIcons(root);
  }

  async function advance(id, step) {
    if (step === 'approve') {
      App.confirm({
        title: '审批通过？',
        html: '通过后采购单进入待付款，财务安排资金。<br>请确认预算与价格合理。',
        okText: '通过',
        onOk: async () => {
          const r = await advancePurchase(id, 'approve');
          if (r.code !== 0) return App.toast(r.msg, 'danger');
          App.toast('已审批通过，等财务付款'); renderList();
        },
      });
      return;
    }
    const label = step === 'pay' ? '登记付款' : '确认入库';
    const r = await advancePurchase(id, step);
    if (r.code !== 0) return App.toast(r.msg, 'danger');
    App.toast('已' + label);
    renderList();
  }

  /* ---------- 采购抽屉（明细） ---------- */
  async function openDrawer(id) {
    const res = await fetchPurchases({});
    if (res.code !== 0) return;
    const p = res.data.find(x => x.id === id);
    if (!p) return;
    App.openDrawer({
      title: '采购 ' + p.no,
      html:
        '<div class="mini-stats">' +
        '<div class="mini-stat"><div class="lbl">金额</div><div class="val">' + App.fmtMoney(p.amount) + '</div></div>' +
        '<div class="mini-stat"><div class="lbl">状态</div><div class="val" style="font-size:14px">' + App.badge(p.status, App.purchaseStatusMeta[p.status]) + '</div></div>' +
        '<div class="mini-stat"><div class="lbl">明细</div><div class="val">' + p.items.length + ' 项</div></div>' +
        '</div>' +
        '<div class="field-grid" style="margin-bottom:16px">' +
        '<div><div class="lbl">供应商</div>' + App.escapeHtml(p.supplierName) + '</div>' +
        '<div><div class="lbl">申请人</div>' + App.escapeHtml(p.requesterName) + '</div>' +
        '<div><div class="lbl">关联订单</div>' + (p.orderNo || '备货') + '</div>' +
        '<div><div class="lbl">申请 / 审批 / 付款 / 入库</div>' + p.createdAt + ' / ' + (p.approveDate || '—') + ' / ' + (p.payDate || '—') + ' / ' + (p.receiveDate || '—') + '</div>' +
        '</div>' +
        '<div class="card"><div class="card-head"><div class="card-title">采购明细</div></div>' +
        '<div class="card-body table-wrap"><table class="table"><thead><tr><th>品名</th><th>规格</th><th>数量</th><th>单价</th><th>小计</th></tr></thead><tbody>' +
        p.items.map(i => '<tr><td>' + App.escapeHtml(i.name) + '</td><td class="sub-line">' + App.escapeHtml(i.spec) + '</td>' +
        '<td class="num">' + i.qty + ' ' + i.unit + '</td><td class="money">' + App.fmtMoney(i.price) + '</td>' +
        '<td class="money">' + App.fmtMoney(i.qty * i.price) + '</td></tr>').join('') +
        '</tbody></table></div></div>' +
        (p.note ? '<p class="form-hint" style="margin-top:12px">' + App.escapeHtml(p.note) + '</p>' : ''),
    });
  }

  /* ---------- 发起采购 ---------- */
  function addModal() {
    const orders = DB.orders.filter(o => o.status !== '已收款');
    let rows = [{ name: '', qty: 1, price: 0 }];
    App.openModal({
      title: '发起采购申请',
      wide: true,
      html:
        '<div class="form-grid">' +
        '<div class="form-item"><label>标题<b>*</b></label><input class="input" id="poTitle" placeholder="如：SO2026-058 批次备料"><p class="form-error"></p></div>' +
        '<div class="form-item"><label>供应商<b>*</b></label>' +
        '<input class="input" id="poSup" list="supOptions" placeholder="输入名称（不存在会自动建档）或从下拉选择" autocomplete="off">' +
        '<datalist id="supOptions">' + DB.suppliers.map(s => '<option value="' + App.escapeHtml(s.name) + '">').join('') + '</datalist>' +
        '<p class="form-error"></p></div>' +
        '<div class="form-item" style="grid-column:1/-1"><label>为哪个订单备料</label><select class="select" id="poOrder"><option value="">备货（不关联订单）</option>' +
        orders.map(o => '<option value="' + o.id + '">' + o.no + ' · ' + App.escapeHtml((App.customerById(o.customerId) || {}).name) + '</option>').join('') + '</select></div>' +
        '</div>' +
        '<div class="field"><label>采购明细<b>*</b></label><div id="poRows"></div>' +
        '<button class="btn btn-sm" id="poAdd" style="margin-top:8px"><span data-icon="plus"></span>加一行</button></div>' +
        '<div class="form-item"><label>备注</label><input class="input" id="poNote" placeholder="交期、运费等说明"></div>',
      foot: '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">' + (App.isBoss() ? '提交申请（自动通过审批）' : '提交申请（待老板审批）') + '</button>',
      onMount(box) {
        const rowsEl = box.querySelector('#poRows');
        function renderRows() {
          rowsEl.innerHTML = rows.map((r, i) =>
            '<div class="row-actions" style="margin-bottom:8px" data-row="' + i + '">' +
            '<input class="input po-name" value="' + App.escapeHtml(r.name) + '" style="flex:2" placeholder="品名，如 热轧卷板">' +
            '<input class="input po-spec" value="' + App.escapeHtml(r.spec || '') + '" style="flex:1.5" placeholder="规格">' +
            '<input class="input po-qty num" type="number" min="1" value="' + r.qty + '" style="width:80px" placeholder="数量">' +
            '<input class="input po-price num" type="number" min="0" value="' + r.price + '" style="width:100px" placeholder="单价">' +
            '<button class="btn btn-sm btn-danger po-del"' + (rows.length === 1 ? ' disabled' : '') + '><span data-icon="trash-2"></span></button></div>').join('');
          rowsEl.querySelectorAll('.po-name').forEach(inp => inp.addEventListener('input', () => { rows[Number(inp.closest('[data-row]').dataset.row)].name = inp.value; }));
          rowsEl.querySelectorAll('.po-spec').forEach(inp => inp.addEventListener('input', () => { rows[Number(inp.closest('[data-row]').dataset.row)].spec = inp.value; }));
          rowsEl.querySelectorAll('.po-qty').forEach(inp => inp.addEventListener('input', () => { rows[Number(inp.closest('[data-row]').dataset.row)].qty = Number(inp.value) || 1; }));
          rowsEl.querySelectorAll('.po-price').forEach(inp => inp.addEventListener('input', () => { rows[Number(inp.closest('[data-row]').dataset.row)].price = Number(inp.value) || 0; }));
          rowsEl.querySelectorAll('.po-del').forEach(btn => btn.addEventListener('click', () => {
            rows.splice(Number(btn.closest('[data-row]').dataset.row), 1); renderRows();
          }));
          App.mountIcons(rowsEl);
        }
        renderRows();
        box.querySelector('#poAdd').addEventListener('click', () => { rows.push({ name: '', qty: 1, price: 0 }); renderRows(); });
        box.querySelector('[data-act="cancel"]').addEventListener('click', () => App.closeModal());
        box.querySelector('[data-act="ok"]').addEventListener('click', async e => {
          const btn = e.currentTarget;
          const tEl = box.querySelector('#poTitle'), sEl = box.querySelector('#poSup');
          [tEl, sEl].forEach(App.formClear);
          if (!tEl.value.trim()) return App.formError(tEl, '请填写标题');
          const supName = sEl.value.trim();
          if (!supName) return App.formError(sEl, '请填写或选择供应商');
          /* 供应商不存在 → 自动建档（免跳转） */
          let sup = DB.suppliers.find(s => s.name === supName);
          if (!sup) {
            const r = await saveSupplier({ name: supName, category: '其他' });
            if (r.code !== 0) return App.formError(sEl, r.msg);
            sup = r.data;
            App.toast('已自动新建供应商「' + sup.name + '」');
          }
          const items = rows.filter(r => r.name.trim() && r.qty > 0);
          if (!items.length) return App.toast('请至少填写一行有效明细', 'danger');
          App.btnLoading(btn);
          const res = await savePurchase({
            title: tEl.value, supplierId: sup.id, orderId: box.querySelector('#poOrder').value,
            items, note: box.querySelector('#poNote').value, requester: sess.userId,
          });
          App.btnDone(btn);
          if (res.code !== 0) return App.toast(res.msg, 'danger');
          App.closeModal();
          App.toast(res.data.status === '已审批' ? '采购已提交（总经理发起，自动通过审批）' : '采购申请已提交，等老板审批');
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

/* ============================================================
   供应商管理
   ============================================================ */
function suppliersModal() {
  const CATS = ['钢材', '镀锌外协', '辅料', '物流', '设备', '其他'];
  const renderTable = () => {
    const rows = DB.suppliers.map(s =>
      '<tr data-sid="' + s.id + '">' +
      '<td><b>' + App.escapeHtml(s.name) + '</b></td>' +
      '<td>' + App.escapeHtml(s.contact || '—') + '</td>' +
      '<td>' + App.escapeHtml(s.phone || '—') + '</td>' +
      '<td><span class="badge">' + App.escapeHtml(s.category) + '</span></td>' +
      '<td><div class="row-actions">' +
      '<button class="btn btn-sm" data-sedit="' + s.id + '"><span data-icon="pencil"></span>编辑</button>' +
      '<button class="btn btn-sm btn-danger" data-sdel="' + s.id + '"><span data-icon="trash-2"></span>删除</button>' +
      '</div></td></tr>'
    ).join('');
    return '<div class="card-body table-wrap"><table class="table">' +
      '<thead><tr><th>名称</th><th>联系人</th><th>电话</th><th>分类</th><th></th></tr></thead><tbody>' +
      (DB.suppliers.length ? rows : '<tr><td colspan="5"><div class="empty"><span data-icon="inbox"></span><p>暂无供应商，点右上角「+ 新增供应商」添加</p></div></td></tr>') +
      '</tbody></table></div>';
  };

  App.openModal({
    title: '供应商管理', wide: true,
    html:
      '<div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="btn btn-primary btn-sm" id="supAddBtn"><span data-icon="plus"></span>新增供应商</button></div>' +
      '<div id="supTableWrap">' + renderTable() + '</div>',
    foot: '<button class="btn btn-primary" data-act="ok">关闭</button>',
    onMount(box) {
      const refresh = () => { box.querySelector('#supTableWrap').innerHTML = renderTable(); App.mountIcons(box); bind(); };
      const bind = () => {
        box.querySelectorAll('[data-sedit]').forEach(b => b.addEventListener('click', () => supplierEditModal(b.dataset.sedit, refresh)));
        box.querySelectorAll('[data-sdel]').forEach(b => b.addEventListener('click', () => App.confirm({
          title: '删除供应商？', html: '将从供应商档案中删除（已被采购单使用的不能删）', danger: true, okText: '删除',
          onOk: async () => {
            const r = await deleteSupplier(b.dataset.sdel);
            if (r.code !== 0) return App.toast(r.msg, 'danger');
            App.toast('已删除'); refresh();
          },
        })));
      };
      bind();
      box.querySelector('#supAddBtn').addEventListener('click', () => supplierEditModal(null, refresh));
      box.querySelector('[data-act="ok"]').addEventListener('click', () => App.closeModal());
      App.mountIcons(box);
    },
  });
}

function supplierEditModal(id, done) {
  const s = id ? DB.suppliers.find(x => x.id === id) : { name: '', contact: '', phone: '', category: '钢材' };
  const CATS = ['钢材', '镀锌外协', '辅料', '物流', '设备', '其他'];
  App.openModal({
    title: id ? '编辑供应商' : '新增供应商', wide: false,
    html:
      '<div class="form-grid">' +
      '<div class="form-item" style="grid-column:1/-1"><label>供应商名称<b>*</b></label><input class="input" id="supName" value="' + App.escapeHtml(s.name) + '"><p class="form-error"></p></div>' +
      '<div class="form-item"><label>联系人</label><input class="input" id="supContact" value="' + App.escapeHtml(s.contact) + '"></div>' +
      '<div class="form-item"><label>联系电话</label><input class="input" id="supPhone" value="' + App.escapeHtml(s.phone) + '"></div>' +
      '<div class="form-item" style="grid-column:1/-1"><label>分类</label><select class="select" id="supCat">' + CATS.map(c => '<option' + (c === s.category ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></div>' +
      '</div>',
    foot: '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存</button>',
    onMount(box) {
      box.querySelector('[data-act="cancel"]').addEventListener('click', () => App.closeModal());
      box.querySelector('[data-act="ok"]').addEventListener('click', async e => {
        const btn = e.currentTarget;
        const nEl = box.querySelector('#supName');
        App.formClear(nEl);
        if (!nEl.value.trim()) return App.formError(nEl, '请填写名称');
        App.btnLoading(btn);
        const r = await saveSupplier({ id, name: nEl.value, contact: box.querySelector('#supContact').value, phone: box.querySelector('#supPhone').value, category: box.querySelector('#supCat').value });
        App.btnDone(btn);
        if (r.code !== 0) return App.toast(r.msg, 'danger');
        App.closeModal();
        App.toast(id ? '已保存' : '供应商已添加');
        if (done) done();
      });
    },
  });
}
