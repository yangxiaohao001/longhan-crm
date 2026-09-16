/* ============================================================
   customers.js — 客户管理（重写版）
   列表（搜索/阶段/行业）→ 客户抽屉（档案/跟进/报价/订单/回款）
   角色范围：业务员只看自己的；财务只读（名称/欠款）；跟单看全部
   ============================================================ */
'use strict';
(function () {
  const root = document.getElementById('pageRoot');
  const sess = App.session();
  const state = { kw: '', stage: '', industry: '' };

  async function renderList() {
    root.innerHTML = '<div class="skeleton s-block"></div>';
    const filters = {};
    if (!App.seeAll()) filters.owner = sess.userId;      /* 业务员默认只看自己 */
    if (sess.position === '财务') filters.excludeLost = true;
    const res = await fetchCustomers(filters);
    if (res.code !== 0) { root.innerHTML = '<div class="empty"><p>' + App.escapeHtml(res.msg) + '</p></div>'; return; }
    const kw = state.kw.trim();
    /* 阶段/行业/关键词都在前端筛：res.data 是全量（仅按人过滤），chip 总数以此为准 */
    const list = res.data.filter(c =>
      (!state.stage || c.stage === state.stage) &&
      (!state.industry || c.industry === state.industry) &&
      (!kw || c.name.includes(kw) || c.contact.includes(kw) || (c.phone || '').replace(/\s/g, '').includes(kw.replace(/\s/g, ''))));
    const stageCounts = {};
    res.data.forEach(c => { stageCounts[c.stage] = (stageCounts[c.stage] || 0) + 1; });
    const stages = [''].concat(DB.stages);
    const industries = [''].concat([...new Set(res.data.map(c => c.industry).filter(Boolean))].sort());
    const readOnly = sess.position === '财务';

    root.innerHTML =
      (readOnly ? '<div class="view-banner"><span data-icon="shield-check"></span>财务视角：客户档案只读，可查看欠款与回款</div>'
        : (App.seeAll() ? '' : '<div class="view-banner"><span data-icon="user"></span>我的客户视图' + (App.hasFollowup() ? '（跟单权限：已放开查看全部，含跟进与推进）' : '：仅显示我负责的客户') + '</div>')) +

      '<div class="card"><div class="card-head">' +
      '<div class="chip-row" id="stageChips">' + stages.map(s =>
        '<button class="chip' + (state.stage === s ? ' active' : '') + '" data-stage="' + s + '">' + (s || '全部阶段') +
        (s ? ' (' + (stageCounts[s] || 0) + ')' : ' (' + res.data.length + ')') + '</button>').join('') + '</div>' +
      '<div class="card-tools">' +
      '<select class="select" id="indSel" style="width:130px"><option value="">全部行业</option>' +
      industries.filter(Boolean).map(i => '<option' + (state.industry === i ? ' selected' : '') + '>' + i + '</option>').join('') + '</select>' +
      '<div class="search-box"><span data-icon="search"></span><input class="input" id="kwInput" placeholder="搜索公司 / 联系人 / 电话" style="width:190px" value="' + App.escapeHtml(state.kw) + '"><button class="btn btn-sm" id="kwBtn">搜索</button></div>' +
      (!readOnly ? '<button class="btn btn-primary btn-sm" id="addBtn"><span data-icon="user-plus"></span>新建客户</button>' : '') +
      '</div></div>' +
      '<div class="card-body table-wrap"><table class="table">' +
      '<thead><tr><th>客户</th><th>阶段</th><th>累计成交</th><th>当前欠款</th><th>下次跟进</th>' + (App.seeAll() ? '<th>业务员</th>' : '') + '<th></th></tr></thead><tbody>' +
      (list.length ? list.map(c => {
        const overdueFollow = c.nextFollowIn != null && c.nextFollowIn < 0;
        return '<tr>' +
          '<td><span class="row-link" data-cid="' + c.id + '" style="font-family:var(--font-body)">' + App.escapeHtml(c.name) + '</span>' +
          '<div class="sub-line">' + App.escapeHtml(c.contact) + ' · ' + App.escapeHtml(c.phone) + ' · ' + App.escapeHtml(c.industry) + '</div></td>' +
          '<td>' + App.badge(c.stage, App.stageMeta[c.stage]) + '</td>' +
          '<td class="money">' + (c.totalDeal ? App.fmtMoney(c.totalDeal) : '—') + '</td>' +
          '<td class="money ' + (c.balance > 0 ? 'balance' : 'success') + '">' + (c.balance > 0 ? App.fmtMoney(c.balance) : '结清') + '</td>' +
          '<td>' + (c.stage === '已流失' ? '<span class="sub-line">已流失</span>'
            : (c.nextFollow ? (overdueFollow ? '<span class="overdue-tag still">' + App.relDays(c.nextFollowIn) + '</span>' : App.relDays(c.nextFollowIn)) : '<span class="sub-line">未安排</span>')) + '</td>' +
          (App.seeAll() ? '<td>' + App.escapeHtml(c.ownerName) + '</td>' : '') +
          '<td>' + (readOnly ? '<span class="sub-line">只读</span>' : '<button class="btn btn-sm" data-follow="' + c.id + '"><span data-icon="phone-call"></span>记跟进</button>') + '</td>' +
          '</tr>';
      }).join('') : '<tr><td colspan="7"><div class="empty"><span data-icon="inbox"></span><p>没有符合条件的客户</p></div></td></tr>') +
      '</tbody></table></div></div>';

    root.querySelectorAll('[data-cid]').forEach(el => el.addEventListener('click', () => openDrawer(el.dataset.cid)));
    root.querySelectorAll('[data-follow]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); followModal(el.dataset.follow); }));
    root.querySelectorAll('#stageChips .chip').forEach(el => el.addEventListener('click', () => { state.stage = el.dataset.stage; renderList(); }));
    root.querySelector('#indSel').addEventListener('change', e => { state.industry = e.target.value; renderList(); });
    const kwEl = root.querySelector('#kwInput');
    const doSearch = () => { state.kw = kwEl.value; renderList(); };
    kwEl.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    const kwBtn = root.querySelector('#kwBtn');
    if (kwBtn) kwBtn.addEventListener('click', doSearch);
    const addBtn = root.querySelector('#addBtn');
    if (addBtn) addBtn.addEventListener('click', addModal);
    App.mountIcons(root);
  }

  /* ---------- 客户抽屉 ---------- */
  async function openDrawer(id) {
    const res = await fetchCustomerDetail(id);
    if (res.code !== 0) { App.toast(res.msg, 'danger'); return; }
    const d = res.data, c = d.customer;
    const readOnly = sess.position === '财务';
    const bar = DB.stages.map((s, i) => '<i class="' + (i <= c.stageIndex ? 'done' : '') + '"></i>').join('');

    App.openDrawer({
      title: c.name,
      wide: true,
      html:
        '<div class="mini-stats">' +
        '<div class="mini-stat"><div class="lbl">当前阶段</div><div class="val" style="font-size:15px">' + App.badge(c.stage, App.stageMeta[c.stage]) + '</div></div>' +
        '<div class="mini-stat"><div class="lbl">累计成交</div><div class="val success">' + App.fmtMoney(c.totalDeal) + '</div></div>' +
        '<div class="mini-stat"><div class="lbl">当前欠款</div><div class="val ' + (c.balance > 0 ? 'danger' : 'success') + '">' + App.fmtMoney(c.balance) + '</div></div>' +
        '<div class="mini-stat"><div class="lbl">跟进 / 拜访</div><div class="val">' + c.followCount + ' / ' + c.visitCount + '</div></div>' +
        '</div>' +

        (c.stage === '已流失'
          ? '<div class="view-banner" style="color:var(--danger);background:var(--danger-bg);border-color:rgba(255,84,112,.3)"><span data-icon="ban"></span>丢单原因：' + App.escapeHtml(c.lostReason || '—') + '</div>'
          : '<div class="card" style="margin-bottom:14px"><div class="card-body">' +
          '<div class="stage-bar">' + bar + '</div>' +
          '<div class="row-actions" style="margin-top:12px">' +
          (!readOnly && c.isPreDeal && c.stageIndex < PRE_DEAL_STAGES.length ? '<button class="btn btn-primary btn-sm" id="cAdv"><span data-icon="chevron-right"></span>推进到「' + DB.stages[c.stageIndex + 1] + '」</button>' : '') +
          (!readOnly ? '<button class="btn btn-sm" id="cFollow"><span data-icon="phone-call"></span>记一笔跟进</button>' : '') +
          (!readOnly && c.stage !== '已流失' ? '<button class="btn btn-sm btn-danger" id="cLost">标记流失</button>' : '') +
          (c.stage === '已流失' && App.can('customer.editAll') ? '<button class="btn btn-sm btn-warn" id="cRe">重新激活</button>' : '') +
          (App.isBoss() ? '<button class="btn btn-sm" id="cEdit"><span data-icon="pencil"></span>编辑</button>' : '') +
          (App.isBoss() ? '<button class="btn btn-sm btn-danger" id="cDel"><span data-icon="trash-2"></span>删除</button>' : '') +
          '</div></div></div>') +

        '<div class="field-grid" style="margin-bottom:16px">' +
        '<div><div class="lbl">联系人</div>' + App.escapeHtml(c.contact) + ' · ' + App.escapeHtml(c.phone) + '</div>' +
        '<div><div class="lbl">收货地址</div>' + App.escapeHtml(c.address || '—') + '</div>' +
        '<div><div class="lbl">所属行业</div>' + App.escapeHtml(c.industry) + '</div>' +
        '<div><div class="lbl">业务员</div>' + App.escapeHtml(c.ownerName) + '</div>' +
        '<div><div class="lbl">建档</div>' + c.createdAt + '</div>' +
        '<div><div class="lbl">下次跟进</div>' + (c.nextFollow || '未安排') + '</div>' +
        '</div>' +
        (c.note ? '<p class="form-hint" style="margin-bottom:16px">' + App.escapeHtml(c.note) + '</p>' : '') +

        '<div class="card" style="margin-bottom:14px"><div class="card-head"><div class="card-title">跟进记录</div><span class="card-sub">' + d.followups.length + ' 条</span></div>' +
        '<div class="card-body">' + (d.followups.length ?
          '<ul class="timeline">' + d.followups.slice(0, 8).map(f =>
            '<li class="done"><span class="t-dot"></span><div class="t-title">' + f.type + ' · ' + f.userName + '<em>' + f.date + '</em></div>' +
            '<div class="t-sub">' + App.escapeHtml(f.content) + (f.next ? '<br>下一步：' + App.escapeHtml(f.next) : '') + '</div></li>').join('') + '</ul>'
          : '<div class="empty"><span data-icon="message-square"></span><p>暂无跟进记录</p></div>') + '</div></div>' +

        '<div class="card" style="margin-bottom:14px"><div class="card-head"><div class="card-title">历史订单</div><span class="card-sub">' + d.orders.length + ' 单</span></div>' +
        '<div class="card-body table-wrap">' + (d.orders.length ?
          '<table class="table"><thead><tr><th>订单号</th><th>金额</th><th>欠款</th><th>状态</th></tr></thead><tbody>' +
          d.orders.map(o => '<tr><td><span class="row-link" onclick="location.href=\'orders.html?oid=' + o.id + '\'">' + o.no + '</span></td>' +
          '<td class="money">' + App.fmtMoney(o.amount) + '</td>' +
          '<td class="money ' + (o.balance > 0 ? 'balance' : 'success') + '">' + App.fmtMoney(o.balance) + '</td>' +
          '<td>' + App.badge(o.status, App.orderStatusMeta[o.status]) + '</td></tr>').join('') + '</tbody></table>'
          : '<div class="empty"><span data-icon="clipboard-list"></span><p>暂无订单</p></div>') + '</div></div>' +

        '<div class="card"><div class="card-head"><div class="card-title">回款流水</div><span class="card-sub">' + d.payments.length + ' 笔</span></div>' +
        '<div class="card-body table-wrap">' + (d.payments.length ?
          '<table class="table"><thead><tr><th>日期</th><th>订单</th><th>类型</th><th>金额</th></tr></thead><tbody>' +
          d.payments.slice(0, 8).map(p => '<tr><td>' + p.date + '</td><td>' + p.orderNo + '</td>' +
          '<td>' + App.badge(p.type, App.payTypeMeta[p.type]) + '</td><td class="money success">' + App.fmtMoney(p.amount) + '</td></tr>').join('') + '</tbody></table>'
          : '<div class="empty"><span data-icon="wallet"></span><p>暂无回款</p></div>') + '</div></div>',
      onMount(box) {
        const adv = box.querySelector('#cAdv');
        if (adv) adv.addEventListener('click', async () => {
          const r = await advanceCustomerStage(id);
          if (r.code !== 0) return App.toast(r.msg, 'danger');
          App.closeDrawer(); renderList();
          if (r.data.stage === '已报价') {
            App.confirm({
              title: '客户已推进到「已报价」',
              html: '要不要立即为「' + App.escapeHtml(r.data.name) + '」创建报价单？<br>报价单创建并审批通过后，客户会自动推进到已下单。',
              okText: '立即创建报价', onOk: () => { location.href = 'quotes.html?new=1&cid=' + id; },
            });
          } else App.toast('已推进到「' + r.data.stage + '」');
        });
        const fl = box.querySelector('#cFollow');
        if (fl) fl.addEventListener('click', () => followModal(id));
        const lo = box.querySelector('#cLost');
        if (lo) lo.addEventListener('click', () => lostModal(id));
        const re = box.querySelector('#cRe');
        if (re) re.addEventListener('click', async () => {
          const r = await reactivateCustomer(id);
          if (r.code !== 0) return App.toast(r.msg, 'danger');
          App.toast('已重新激活'); App.closeDrawer(); renderList();
        });
        const ed = box.querySelector('#cEdit');
        if (ed) ed.addEventListener('click', () => adminEditCustomerModal(c, () => { App.closeDrawer(); openDrawer(id); }));
        const dl = box.querySelector('#cDel');
        if (dl) dl.addEventListener('click', () => App.confirm({
          title: '删除客户「' + c.name + '」？', html: '将删除该客户档案与所有关联记录（报价 / 订单 / 回款 / 跟进）。此操作不可恢复。',
          okText: '确认删除', danger: true,
          onOk: async () => {
            const r = await adminDeleteCustomer(id);
            if (r.code !== 0) return App.toast(r.msg, 'danger');
            App.toast('客户已删除'); App.closeDrawer(); renderList();
          },
        }));
        App.mountIcons(box);
      },
    });
  }

  /* ---------- 记跟进弹窗 ---------- */
  function followModal(cid) {
    App.openModal({
      title: '记一笔跟进',
      html:
        '<div class="form-grid">' +
        '<div class="form-item"><label>方式</label><select class="select" id="fType"><option>电话</option><option>微信</option><option>拜访</option></select></div>' +
        '<div class="form-item"><label>日期</label><input class="input" id="fDate" type="date" value="' + App.today + '"></div>' +
        '</div>' +
        '<div class="field"><label>聊了什么<b>*</b></label><textarea class="textarea" id="fContent" placeholder="一句话即可，例如：客户确认规格，下周出报价"></textarea><p class="form-error"></p></div>' +
        '<div class="field"><label>下一步</label><input class="input" id="fNext" placeholder="选填，例如：9 月 18 日前发新报价"></div>',
      foot: '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存</button>',
      onMount(box) {
        box.querySelector('[data-act="cancel"]').addEventListener('click', () => App.closeModal());
        box.querySelector('[data-act="ok"]').addEventListener('click', async e => {
          const btn = e.currentTarget;
          const cEl = box.querySelector('#fContent');
          App.formClear(cEl);
          if (!cEl.value.trim() || cEl.value.trim().length < 2) return App.formError(cEl, '请填写跟进内容');
          App.btnLoading(btn);
          const res = await addFollowup({
            customerId: cid, userId: sess.userId, type: box.querySelector('#fType').value,
            date: box.querySelector('#fDate').value, content: cEl.value, next: box.querySelector('#fNext').value,
          });
          App.btnDone(btn);
          if (res.code !== 0) return App.toast(res.msg, 'danger');
          App.closeModal(); App.toast('跟进已记录');
          if (cid) renderList();
        });
      },
    });
  }

  /* ---------- 标记流失 ---------- */
  function lostModal(cid) {
    App.openModal({
      title: '标记流失（需填原因）',
      html: '<div class="field"><label>丢单原因（至少 4 个字）<b>*</b></label><textarea class="textarea" id="lReason" placeholder="例如：客户选择了价格低 8% 的竞品"></textarea><p class="form-error"></p></div>',
      foot: '<button class="btn" data-act="cancel">取消</button><button class="btn btn-danger" data-act="ok">确认流失</button>',
      onMount(box) {
        box.querySelector('[data-act="cancel"]').addEventListener('click', () => App.closeModal());
        box.querySelector('[data-act="ok"]').addEventListener('click', async e => {
          const btn = e.currentTarget;
          const rEl = box.querySelector('#lReason');
          App.formClear(rEl);
          if (rEl.value.trim().length < 4) return App.formError(rEl, '至少 4 个字，便于复盘');
          App.btnLoading(btn);
          const res = await markCustomerLost(cid, rEl.value);
          App.btnDone(btn);
          if (res.code !== 0) return App.toast(res.msg, 'danger');
          App.closeModal(); App.toast('已标记流失'); App.closeDrawer(); renderList();
        });
      },
    });
  }

  /* ---------- 新建客户 ---------- */
  function addModal() {
    App.openModal({
      title: '新建客户',
      html:
        '<div class="form-grid">' +
        '<div class="form-item"><label>公司名称<b>*</b></label><input class="input" id="nName" placeholder="与营业执照一致"><p class="form-error"></p></div>' +
        '<div class="form-item"><label>所属行业</label><input class="input" id="nIndustry" placeholder="如：机械制造"></div>' +
        '<div class="form-item"><label>联系人<b>*</b></label><input class="input" id="nContact"><p class="form-error"></p></div>' +
        '<div class="form-item"><label>联系电话<b>*</b></label><input class="input" id="nPhone"><p class="form-error"></p></div>' +
        '<div class="form-item" style="grid-column:1/-1"><label>收货地址</label><input class="input" id="nAddress"></div>' +
        '<div class="form-item" style="grid-column:1/-1"><label>备注</label><textarea class="textarea" id="nNote" placeholder="客户偏好、账期要求等"></textarea></div>' +
        '</div>',
      foot: '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">建档</button>',
      onMount(box) {
        box.querySelector('[data-act="cancel"]').addEventListener('click', () => App.closeModal());
        box.querySelector('[data-act="ok"]').addEventListener('click', async e => {
          const btn = e.currentTarget;
          const nameEl = box.querySelector('#nName'), ctEl = box.querySelector('#nContact'), phEl = box.querySelector('#nPhone');
          [nameEl, ctEl, phEl].forEach(App.formClear);
          if (!nameEl.value.trim()) return App.formError(nameEl, '请填写公司名称');
          if (!ctEl.value.trim()) return App.formError(ctEl, '请填写联系人');
          if (!phEl.value.trim()) return App.formError(phEl, '请填写联系电话');
          App.btnLoading(btn);
          const res = await saveCustomer({
            name: nameEl.value, contact: ctEl.value, phone: phEl.value,
            address: box.querySelector('#nAddress').value, industry: box.querySelector('#nIndustry').value,
            note: box.querySelector('#nNote').value,
            owner: sess.userId,
          });
          App.btnDone(btn);
          if (res.code !== 0) return App.toast(res.msg, 'danger');
          App.closeModal(); App.toast('客户已建档，从「初步接触」开始跟进'); renderList();
        });
      },
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (!App.requireLogin()) return;
    /* 等待云端拉取（如果已配 Supabase）—— 否则 fetch 会用 mock 空数据 */
    if (App.bootstrapFromCloud) await App.bootstrapFromCloud();
    /* 等待 perm.js 挂载（最多 500ms） */
    await new Promise(r => {
      const t0 = Date.now();
      const w = () => (typeof App.canRoute === 'function') ? r() : (Date.now() - t0 < 3000 ? setTimeout(w, 30) : r());
      w();
    });
    await renderList();
    const cid = new URLSearchParams(location.search).get('cid');
    if (cid) { history.replaceState(null, '', 'customers.html'); openDrawer(cid); }
  });
})();

/* ---------- 总经理专属：编辑任何客户 / 删除 ---------- */
function adminEditCustomerModal(c, done) {
  const users = DB.users.map(u => '<option value="' + u.id + '"' + (u.id === c.owner ? ' selected' : '') + '>' + App.escapeHtml(u.name) + '</option>').join('');
  App.openModal({
    title: '编辑客户 · ' + c.name, wide: true,
    html:
      '<div class="form-grid">' +
      '<div class="form-item"><label>公司名称<b>*</b></label><input class="input" id="cName" value="' + App.escapeHtml(c.name) + '"><p class="form-error"></p></div>' +
      '<div class="form-item"><label>所属行业</label><input class="input" id="cIndustry" value="' + App.escapeHtml(c.industry) + '"></div>' +
      '<div class="form-item"><label>联系人<b>*</b></label><input class="input" id="cContact" value="' + App.escapeHtml(c.contact) + '"><p class="form-error"></p></div>' +
      '<div class="form-item"><label>电话<b>*</b></label><input class="input" id="cPhone" value="' + App.escapeHtml(c.phone) + '"><p class="form-error"></p></div>' +
      '<div class="form-item" style="grid-column:1/-1"><label>地址</label><input class="input" id="cAddress" value="' + App.escapeHtml(c.address || '') + '"></div>' +
      '<div class="form-item"><label>业务员</label><select class="select" id="cOwner">' + users + '</select></div>' +
      '<div class="form-item"><label>客户阶段</label><select class="select" id="cStage">' + DB.stages.map(s => '<option' + (s === c.stage ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></div>' +
      '<div class="form-item" style="grid-column:1/-1"><label>备注</label><textarea class="textarea" id="cNote">' + App.escapeHtml(c.note || '') + '</textarea></div>' +
      '</div>',
    foot: '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存</button>',
    onMount(box) {
      box.querySelector('[data-act="cancel"]').addEventListener('click', () => App.closeModal());
      box.querySelector('[data-act="ok"]').addEventListener('click', async e => {
        const btn = e.currentTarget;
        const nEl = box.querySelector('#cName'), ctEl = box.querySelector('#cContact'), phEl = box.querySelector('#cPhone');
        [nEl, ctEl, phEl].forEach(App.formClear);
        if (!nEl.value.trim()) return App.formError(nEl, '请填写公司名称');
        if (!ctEl.value.trim()) return App.formError(ctEl, '请填写联系人');
        if (!phEl.value.trim()) return App.formError(phEl, '请填写电话');
        App.btnLoading(btn);
        const r = await adminUpdateCustomer(c.id, {
          name: nEl.value, contact: ctEl.value, phone: phEl.value,
          address: box.querySelector('#cAddress').value, industry: box.querySelector('#cIndustry').value,
          owner: box.querySelector('#cOwner').value, stage: box.querySelector('#cStage').value,
          note: box.querySelector('#cNote').value,
        });
        App.btnDone(btn);
        if (r.code !== 0) return App.toast(r.msg, 'danger');
        App.closeModal(); App.toast('客户已保存');
        if (done) done();
      });
    },
  });
}
