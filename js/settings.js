/* settings.js — 系统设置（仅总经理）
   ① 账号管理（增 / 删 / 改 / 重置密码 / 启用停用）
   ② 业务规则（定金比例）
   ③ 主题与云端（Supabase 连接配置 + 测试）
   ============================================================ */
'use strict';
(function () {
  const root = document.getElementById('pageRoot');

  document.addEventListener('DOMContentLoaded', async () => {
    if (!App.requireLogin()) return;
    if (App.bootstrapFromCloud) await App.bootstrapFromCloud();
    /* 等待 perm.js 挂载（最多 3s） */
    const start = Date.now();
    const wait = () => {
      if (typeof App.isBoss === 'function') {
        if (!App.isBoss()) {
          root.innerHTML = '<div class="empty"><span data-icon="shield-check"></span><p>仅总经理可访问系统设置</p></div>';
          return;
        }
        try { render(); } catch (e) { root.innerHTML = '<div class="empty"><span data-icon="alert-triangle"></span><p>渲染失败：' + App.escapeHtml(e.message) + '</p>'; }
      } else if (Date.now() - start < 3000) {
        setTimeout(wait, 30);
      } else {
        root.innerHTML = '<div class="empty"><span data-icon="alert-triangle"></span><p>权限模块加载失败，请刷新</p></div>';
      }
    };
    wait();
  });

  /* ----- 内部工具 ----- */
  const _u = id => DB.users.find(x => x.id === id);
  const _uid = () => 'u' + Date.now().toString(36);
  /* 属性直接赋值不会触发数组钩子，必须显式云同步（否则刷新后改动丢失） */
  function syncUser(u) { if (typeof _cloudSync === 'function') _cloudSync('users', 'upsert', u); }
  function syncProduct(p, op) { if (typeof _cloudSync === 'function') _cloudSync('products', op || 'upsert', p); }

  /* ---------- 渲染 ---------- */
  function render() {
    const modules = App.modules();
    const positions = App.positions();
    const cfg = App.getCfg();
    const mode = App.dbMode();

    /* 账号卡片 */
    const userCards = DB.users.map(u => {
      const scopeText = (u.scopes || []).includes('*')
        ? '<span class="badge badge-warn">全部模块</span>'
        : (u.scopes || []).map(s => App.modules().find(m => m.key === s)?.name || s).join('、') || '<span class="sub-line">未分配</span>';
      return '<div class="card" style="margin-bottom:12px" data-uid="' + u.id + '">' +
        '<div class="card-body">' +
        '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
        '<span class="nav-avatar">' + u.initial + '</span>' +
        '<div style="flex:1;min-width:200px">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
        '<b style="font-size:14.5px">' + App.escapeHtml(u.name) + '</b>' +
        (u.position === '总经理' ? '<span class="badge badge-warn">总经理</span>' : '<span class="badge">' + App.escapeHtml(u.position) + '</span>') +
        (u.active === false ? '<span class="badge badge-danger">已停用</span>' : '<span class="badge badge-success">启用</span>') +
        '</div>' +
        '<div class="sub-line">登录名 <b class="num">' + App.escapeHtml(u.userName) + '</b> · 电话 ' + App.escapeHtml(u.phone || '—') + ' · 密码 ' + (u.pwd ? '已设置' : '未设置') + '</div>' +
        '<div class="sub-line">可见模块：' + scopeText + '</div>' +
        '</div>' +
        '<div class="row-actions">' +
        '<button class="btn btn-sm" data-edit="' + u.id + '"><span data-icon="pencil"></span>编辑</button>' +
        '<button class="btn btn-sm" data-pwd="' + u.id + '"><span data-icon="lock"></span>重置密码</button>' +
        '<button class="btn btn-sm" data-toggle="' + u.id + '">' + (u.active === false ? '启用' : '停用') + '</button>' +
        (u.id !== App.session().userId ? '<button class="btn btn-sm btn-danger" data-del="' + u.id + '"><span data-icon="trash-2"></span>删除</button>' : '') +
        '</div></div></div>';
    }).join('');

    /* 产品库管理 */
    const prodRows = DB.products.map(p =>
      '<tr><td style="font-weight:600">' + App.escapeHtml(p.name) + '</td>' +
      '<td class="sub-line">' + App.escapeHtml(p.spec || '—') + '</td>' +
      '<td>' + App.escapeHtml(p.unit || '—') + '</td>' +
      '<td class="money">' + App.fmtMoney(p.price) + '</td>' +
      '<td class="row-actions" style="justify-content:flex-end">' +
      '<button class="btn btn-sm" data-pedit="' + p.id + '"><span data-icon="pencil"></span>编辑</button>' +
      '<button class="btn btn-sm btn-danger" data-pdel="' + p.id + '"><span data-icon="trash-2"></span>删除</button></td></tr>').join('');
    const prodCard = '<div class="card" style="margin-bottom:16px"><div class="card-head"><div class="card-title">产品库管理</div>' +
      '<span class="card-sub">' + DB.products.length + ' 个产品 · 新建报价时从这里带出</span>' +
      '<div class="card-tools"><button class="btn btn-primary btn-sm" id="addProd"><span data-icon="plus"></span>新增产品</button></div></div>' +
      '<div class="card-body table-wrap"><table class="table"><thead><tr><th>产品名称</th><th>规格</th><th>单位</th><th>参考单价</th><th></th></tr></thead><tbody>' +
      (prodRows || '<tr><td colspan="5"><div class="empty"><p>还没有产品，点右上角「新增产品」建立常用产品库</p></div></td></tr>') +
      '</tbody></table></div></div>';

    /* 业务规则 */
    const rules = '<div class="card" style="margin-bottom:16px"><div class="card-head"><div class="card-title">业务规则</div></div>' +      '<div class="card-body"><div class="field"><label>发货前最低定金比例（%）</label>' +
      '<div class="row-actions"><input class="input num" id="depPct" type="number" min="0" max="100" value="' + (DB.settings.depositPct || 30) + '" style="width:110px">' +
      '<button class="btn btn-primary btn-sm" id="savePct">保存</button></div>' +
      '<p class="form-hint" style="margin-top:8px">订单「生产中 → 已发货」时校验：定金未达比例，业务员无法推进，需总经理在弹窗中确认。</p></div>' +
      '<div class="field" style="margin-bottom:0"><label>报价默认有效期</label><input class="input" value="15 天（审批通过自动计算）" disabled></div>' +
      '</div></div>';

    /* 主题 + 云端 */
    const cloud = '<div class="card" style="margin-bottom:16px"><div class="card-head">' +
      '<div class="card-title">主题外观</div><div class="card-sub">所有账号可独立切换</div></div>' +
      '<div class="card-body"><p>点击顶栏右上角小图标可在 <b>暗色</b> / <b>亮色</b> 之间切换；系统会记住你的选择。</p></div></div>' +

      '<div class="card" style="margin-bottom:16px"><div class="card-head">' +
      '<div class="card-title">云端（Supabase）</div>' +
      '<span class="card-sub">当前模式：' + (mode === 'cloud' ? '<span style="color:var(--success)">已连接云端</span>' : '<span style="color:var(--warning)">本地演示模式（仅本浏览器）</span>') + '</span>' +
      '</div><div class="card-body">' +
      '<p class="form-hint" style="margin-bottom:12px">填写 Supabase 项目的 URL 和 anon key 即可启用<b>跨设备同步 + 真实附件云存储</b>。<br>' +
      '免费版足够 5-15 人使用。' +
      '配置后请到 Supabase 建表（meta/users/customers/quotes/orders/payments/followups/reminders/suppliers/purchases/manual_ledgers/settings）和名为 <b>attachments</b> 的存储桶。</p>' +
      '<div class="form-grid">' +
      '<div class="form-item"><label>Supabase URL</label><input class="input" id="cfUrl" value="' + App.escapeHtml(cfg.SUPABASE_URL) + '" placeholder="https://xxxxx.supabase.co"></div>' +
      '<div class="form-item"><label>anon public key</label><input class="input" id="cfKey" value="' + App.escapeHtml(cfg.SUPABASE_ANON_KEY) + '" placeholder="eyJhbGciOiJIUzI1NiIs..."></div>' +
      '</div>' +
      '<div class="row-actions" style="margin-top:10px"><button class="btn btn-primary btn-sm" id="cfSave">保存配置</button>' +
      '<button class="btn btn-sm" id="cfTest">测试连接</button>' +
      '<span class="form-hint" id="cfMsg"></span></div>' +
      '<p class="form-hint" style="margin-top:8px">未配置时所有数据保存在浏览器本地（localStorage）；配置后自动切换到云端，跨设备共享。</p>' +
      '</div></div>';

    /* 角色权限配置（总经理：按岗位勾选可见模块，存云端全设备生效） */
    const psCfg = DB.settings.positionScopes || {};
    const FALLBACK = ['dashboard', 'customers', 'quotes', 'orders', 'payments', 'purchase', 'reminders'];
    /* 云端备份卡 */
    const bkCard = '<div class="card" style="margin-bottom:16px"><div class="card-head"><div class="card-title">云端数据备份</div>' +
      '<span class="card-sub">每天首次打开系统自动备份 · 永久保留（每天一份，可存 10 年以上）</span></div>' +
      '<div class="card-body">' +
      '<div style="text-align:right;margin-bottom:10px"><button class="btn btn-primary btn-sm" id="bkNow"><span data-icon="cloud-upload"></span>立即备份</button></div>' +
      '<div id="bkList"><div class="sub-line">加载中…</div></div>' +
      '<p class="form-hint" style="margin-top:10px">恢复会用所选备份<b>覆盖</b>当前云端全部数据，操作前请先点「立即备份」留存现状。</p>' +
      '</div></div>';

    const permRows = positions.filter(pp => pp !== '总经理').map(pp => {
      const cur = psCfg[pp] || ((DB.users.find(u => u.position === pp && Array.isArray(u.scopes) && u.scopes.length) || {}).scopes) || FALLBACK;
      return '<div class="perm-row" data-pos="' + pp + '" style="padding:10px 0;border-bottom:1px dashed var(--border)">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px"><b style="font-size:13.5px">' + pp + '</b>' +
        '<label style="margin-left:auto;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:4px"><input type="checkbox" class="perm-all"> 全选</label></div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px 14px">' + modules.map(m =>
          '<label style="font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:4px"><input type="checkbox" class="perm-chk" value="' + m.key + '"' + (cur.includes(m.key) ? ' checked' : '') + '> ' + m.name + '</label>').join('') +
        '</div></div>';
    }).join('');
    const permCard = '<div class="card" style="margin-bottom:16px"><div class="card-head"><div class="card-title">角色权限配置</div>' +
      '<span class="card-sub">按岗位分配可见模块，保存后该岗位账号重新登录生效</span></div>' +
      '<div class="card-body">' + permRows +
      '<div style="margin-top:12px;text-align:right"><button class="btn btn-primary btn-sm" id="savePerm"><span data-icon="save"></span>保存权限配置</button></div>' +
      '</div></div>';

    root.innerHTML =
      '<div class="grid" style="grid-template-columns:1.5fr 1fr;align-items:flex-start">' +
      '<div>' +
      '<div class="card" style="margin-bottom:16px"><div class="card-head"><div class="card-title">账号管理</div><span class="card-sub">' + DB.users.length + ' 个账号</span>' +
      '<div class="card-tools"><button class="btn btn-primary btn-sm" id="addUser"><span data-icon="user-plus"></span>新增账号</button></div></div>' +
      '<div class="card-body">' + userCards + '</div></div>' +
      permCard +
      prodCard +
      rules +
      '</div><div>' +
      cloud +
      bkCard +
      '<div class="card"><div class="card-head"><div class="card-title">公司</div></div><div class="card-body">' +
      '<div class="form-hint">' + App.escapeHtml(DB.meta.company) + '</div>' +
      '<div class="form-hint" style="margin-top:6px">演示基准日：' + DB.meta.today + '</div>' +
      '</div></div>' +
      '</div></div>';

    /* 账号卡按钮 */
    /* 云端备份交互 */
    const bkList = root.querySelector('#bkList');
    function renderBkList() {
      if (!bkList || !App.listCloudBackups) return;
      App.listCloudBackups().then(r => {
        if (!r.ok) { bkList.innerHTML = '<div class="sub-line">备份列表加载失败：' + App.escapeHtml(r.msg) + '</div>'; return; }
        if (!r.items.length) { bkList.innerHTML = '<div class="sub-line">还没有备份，点上方「立即备份」创建第一份</div>'; return; }
        bkList.innerHTML = r.items.slice(0, 8).map(b =>
          '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px dashed var(--border)">' +
          '<span class="sub-line" style="flex:1;min-width:0">' + App.escapeHtml(b.file.replace('.json', '')) + ' · ' + Math.max(1, Math.round((b.size || 0) / 1024)) + ' KB</span>' +
          '<a class="btn btn-sm" href="' + App.escapeHtml(App.backupPublicUrl(b.name)) + '" target="_blank" rel="noopener">下载</a>' +
          '<button class="btn btn-sm btn-danger" data-bkrestore="' + App.escapeHtml(b.name) + '">恢复</button></div>').join('');
        bkList.querySelectorAll('[data-bkrestore]').forEach(btn => btn.addEventListener('click', () => {
          const name = btn.dataset.bkrestore;
          App.confirm({
            title: '恢复备份（覆盖当前数据）',
            html: '将用 <b>' + App.escapeHtml(name) + '</b> 覆盖当前云端<b>全部数据</b>。<br><span style="color:#eab308">备份之后录入的新数据会丢失，此操作不可撤销。</span>',
            okText: '继续', danger: true,
            onOk: () => App.confirm({
              title: '再次确认',
              html: '确定要覆盖当前全部数据吗？',
              okText: '确认恢复', danger: true,
              onOk: async () => {
                App.toast('正在恢复…', 'info');
                const r2 = await App.restoreFromCloudBackup(name);
                if (!r2.ok) return App.toast('恢复失败：' + r2.msg, 'danger');
                App.toast('恢复完成，即将刷新');
                setTimeout(() => location.reload(), 1200);
              },
            }),
          });
        }));
      });
    }
    renderBkList();
    const bkNow = root.querySelector('#bkNow');
    if (bkNow) bkNow.addEventListener('click', async () => {
      if (!App.backupToCloud) return App.toast('本地模式不支持云端备份', 'danger');
      App.btnLoading(bkNow);
      const r = await App.backupToCloud();
      App.btnDone(bkNow);
      if (!r.ok) return App.toast('备份失败：' + r.msg, 'danger');
      App.toast('备份完成：' + r.tableCount + ' 张表 / ' + r.rowCount + ' 行');
      renderBkList();
    });

    /* 权限配置交互 */
    root.querySelectorAll('.perm-row').forEach(row => {
      const all = row.querySelector('.perm-all');
      const syncAll = () => { all.checked = [...row.querySelectorAll('.perm-chk')].every(c => c.checked); };
      syncAll();
      all.addEventListener('change', () => row.querySelectorAll('.perm-chk').forEach(c => { c.checked = all.checked; }));
      row.querySelectorAll('.perm-chk').forEach(c => c.addEventListener('change', syncAll));
    });
    const spBtn = root.querySelector('#savePerm');
    if (spBtn) spBtn.addEventListener('click', async () => {
      const map = {};
      root.querySelectorAll('.perm-row').forEach(row => {
        map[row.dataset.pos] = [...row.querySelectorAll('.perm-chk:checked')].map(c => c.value);
      });
      App.btnLoading(spBtn);
      const r = await saveSettings({ positionScopes: map });
      App.btnDone(spBtn);
      if (r.code !== 0) return App.toast(r.msg, 'danger');
      App.toast('权限配置已保存，该岗位账号重新登录后生效');
    });

    root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editUserModal(b.dataset.edit)));
    root.querySelectorAll('[data-pwd]').forEach(b => b.addEventListener('click', () => pwdResetModal(b.dataset.pwd)));
    root.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
      const u = _u(b.dataset.toggle);
      if (!u) return;
      u.active = u.active === false ? true : false;
      syncUser(u);
      App.toast((u.active ? '已启用 ' : '已停用 ') + u.name);
      render();
    }));
    root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      const u = _u(b.dataset.del);
      if (!u) return;
      App.confirm({
        title: '删除账号「' + u.name + '」？', html: '该账号将被删除，其历史数据（客户/订单/报价）保留但显示为「已删除」。此操作不可恢复。',
        okText: '确认删除', danger: true,
        onOk: () => {
          const i = DB.users.findIndex(x => x.id === u.id);
          if (i >= 0) DB.users.splice(i, 1);
          App.toast('账号已删除');
          render();
        },
      });
    }));
    root.querySelector('#addUser').addEventListener('click', () => editUserModal(null));

    /* 产品库按钮 */
    root.querySelector('#addProd').addEventListener('click', () => editProdModal(null));
    root.querySelectorAll('[data-pedit]').forEach(b => b.addEventListener('click', () => editProdModal(b.dataset.pedit)));
    root.querySelectorAll('[data-pdel]').forEach(b => b.addEventListener('click', () => {
      const p = DB.products.find(x => x.id === b.dataset.pdel);
      if (!p) return;
      App.confirm({
        title: '删除产品「' + p.name + '」？',
        html: '只从产品库中移除，<b>历史报价单不受影响</b>（报价里保存的是当时的明细副本）。此操作不可恢复。',
        okText: '确认删除', danger: true,
        onOk: () => {
          const i = DB.products.findIndex(x => x.id === p.id);
          if (i >= 0) DB.products.splice(i, 1);
          syncProduct({ id: p.id }, 'delete');
          App.toast('产品已删除');
          render();
        },
      });
    }));

    /* 业务规则 */
    root.querySelector('#savePct').addEventListener('click', async e => {
      const v = Number(root.querySelector('#depPct').value);
      const r = await saveSettings({ depositPct: v });
      if (r.code !== 0) return App.toast(r.msg, 'danger');
      App.toast('定金比例已保存为 ' + v + '%');
    });

    /* 云端 */
    root.querySelector('#cfSave').addEventListener('click', () => {
      App.saveCfg({
        SUPABASE_URL: root.querySelector('#cfUrl').value.trim(),
        SUPABASE_ANON_KEY: root.querySelector('#cfKey').value.trim(),
      });
      App.toast('配置已保存；下次刷新页面后生效');
      render();
    });
    root.querySelector('#cfTest').addEventListener('click', async () => {
      App.saveCfg({
        SUPABASE_URL: root.querySelector('#cfUrl').value.trim(),
        SUPABASE_ANON_KEY: root.querySelector('#cfKey').value.trim(),
      });
      const msg = root.querySelector('#cfMsg');
      msg.textContent = '正在测试…';
      const r = await App.testCloud();
      msg.textContent = r.ok ? '✓ 连接成功（meta 表已读 ' + r.rows + ' 行）' : '✗ ' + r.msg;
      msg.style.color = r.ok ? 'var(--success)' : 'var(--danger)';
    });

    App.mountIcons(root);
  }

  /* ----- 产品库编辑（新增/修改） ----- */
  function editProdModal(id) {
    const p = id ? DB.products.find(x => x.id === id) : null;
    const isNew = !p;
    const row = p || { id: 'p' + Date.now().toString(36), name: '', spec: '', unit: '吨', price: 0 };
    App.openModal({
      title: isNew ? '新增产品' : '编辑产品 · ' + p.name,
      html:
        '<div class="form-grid">' +
        '<div class="form-item"><label>产品名称<b>*</b></label><input class="input" id="pName" value="' + App.escapeHtml(row.name) + '" placeholder="如：镀锌角钢"><p class="form-error"></p></div>' +
        '<div class="form-item"><label>规格</label><input class="input" id="pSpec" value="' + App.escapeHtml(row.spec || '') + '" placeholder="如：50×50×5mm Q235B"></div>' +
        '<div class="form-item"><label>默认单位</label><select class="select" id="pUnit">' + ['吨', '根', '件', '米', '套', '个', '平方'].map(u => '<option' + (u === (row.unit || '吨') ? ' selected' : '') + '>' + u + '</option>').join('') + '</select></div>' +
        '<div class="form-item"><label>参考单价（元）<b>*</b></label><input class="input num" id="pPrice" type="number" min="0" step="0.01" value="' + (row.price || 0) + '"><p class="form-error"></p></div>' +
        '</div>' +
        '<p class="form-hint">这里维护的是<b>常用产品库</b>：业务员新建报价时一键带出名称 / 规格 / 单价，报价里仍可临时改价。</p>',
      foot: '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">' + (isNew ? '创建产品' : '保存') + '</button>',
      onMount(box) {
        box.querySelector('[data-act="cancel"]').addEventListener('click', () => App.closeModal());
        box.querySelector('[data-act="ok"]').addEventListener('click', async e => {
          const btn = e.currentTarget;
          const nEl = box.querySelector('#pName'), prEl = box.querySelector('#pPrice');
          [nEl, prEl].forEach(App.formClear);
          if (!nEl.value.trim()) return App.formError(nEl, '请填写产品名称');
          const price = Number(prEl.value);
          if (isNaN(price) || price < 0) return App.formError(prEl, '请填写正确的单价');
          row.name = nEl.value.trim();
          row.spec = box.querySelector('#pSpec').value.trim();
          row.unit = box.querySelector('#pUnit').value;
          row.price = price;
          App.btnLoading(btn);
          if (isNew) { DB.products.push(row); syncProduct(row); }
          else {
            const i = DB.products.findIndex(x => x.id === row.id);
            if (i >= 0) DB.products[i] = row;
            syncProduct(row);
          }
          App.btnDone(btn);
          App.closeModal();
          App.toast(isNew ? '产品已添加' : '产品已保存');
          render();
        });
      },
    });
  }

  /* ----- 账号编辑（新增/修改） ----- */
  function editUserModal(id) {
    const u = id ? _u(id) : { id: _uid(), name: '', userName: '', phone: '', position: '业务员', pwd: '123456', initial: '新', scopes: ['dashboard', 'customers', 'quotes', 'orders', 'payments', 'purchase', 'reminders'], active: true };
    const isNew = !id;
    const positions = App.positions();
    const modules = App.modules();
    const scopeChecks = modules.map(m => {
      const isAll = (u.scopes || []).includes('*');
      const on = isAll || (u.scopes || []).includes(m.key);
      return '<label class="chip' + (on ? ' active' : '') + '" style="cursor:pointer"><input type="checkbox" data-mod="' + m.key + '"' + (on ? ' checked' : '') + ' style="display:none">' + m.name + '</label>';
    }).join('');

    App.openModal({
      title: (isNew ? '新增账号' : '编辑账号 · ' + u.name), wide: true,
      html:
        '<div class="form-grid">' +
        '<div class="form-item"><label>姓名<b>*</b></label><input class="input" id="uName" value="' + App.escapeHtml(u.name) + '"><p class="form-error"></p></div>' +
        '<div class="form-item"><label>登录名<b>*</b></label><input class="input" id="uLogin" value="' + App.escapeHtml(u.userName) + '" placeholder="英文/拼音，如 lcf"><p class="form-error"></p></div>' +
        '<div class="form-item"><label>电话</label><input class="input" id="uPhone" value="' + App.escapeHtml(u.phone) + '" placeholder="139 0000 0000"></div>' +
        '<div class="form-item"><label>岗位<b>*</b></label><select class="select" id="uPos">' + positions.map(p => '<option' + (p === u.position ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></div>' +
        '<div class="form-item"><label>头像首字</label><input class="input" id="uInitial" maxlength="1" value="' + App.escapeHtml(u.initial) + '" placeholder="自动从姓名取"></div>' +
        '<div class="form-item"><label>登录密码</label><input class="input" id="uPwd" value="' + App.escapeHtml(u.pwd || '123456') + '"></div>' +
        '</div>' +
        '<div class="field"><label>可见模块（不勾选则该模块不显示在该账号导航里）</label>' +
        '<div class="chip-row" id="scopeRow">' +
        '<label class="chip" style="cursor:pointer"><input type="checkbox" id="uAll" style="display:none">全部模块（总经理）</label>' +
        scopeChecks +
        '</div></div>',
      foot: '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">' + (isNew ? '创建账号' : '保存') + '</button>',
      onMount(box) {
        const allBox = box.querySelector('#uAll');
        const modBoxes = box.querySelectorAll('[data-mod]');
        allBox.checked = (u.scopes || []).includes('*');
        modBoxes.forEach(cb => {
          const wrap = cb.closest('.chip');
          cb.addEventListener('change', () => wrap.classList.toggle('active', cb.checked));
        });
        allBox.addEventListener('change', () => {
          modBoxes.forEach(cb => { cb.checked = allBox.checked; cb.closest('.chip').classList.toggle('active', allBox.checked); });
        });
        box.querySelector('[data-act="cancel"]').addEventListener('click', () => App.closeModal());
        box.querySelector('[data-act="ok"]').addEventListener('click', async e => {
          const btn = e.currentTarget;
          const nEl = box.querySelector('#uName'), lEl = box.querySelector('#uLogin');
          [nEl, lEl].forEach(App.formClear);
          if (!nEl.value.trim()) return App.formError(nEl, '请填写姓名');
          if (!lEl.value.trim()) return App.formError(lEl, '请填写登录名');
          /* 登录名唯一性 */
          const dup = DB.users.find(x => x.userName === lEl.value.trim() && x.id !== u.id);
          if (dup) return App.formError(lEl, '登录名已被「' + dup.name + '」使用');
          u.name = nEl.value.trim();
          u.userName = lEl.value.trim();
          u.phone = box.querySelector('#uPhone').value.trim();
          u.position = box.querySelector('#uPos').value;
          u.pwd = box.querySelector('#uPwd').value;
          u.initial = (box.querySelector('#uInitial').value || u.name.slice(0, 1)).slice(0, 1);
          u.scopes = allBox.checked ? ['*'] : Array.from(box.querySelectorAll('[data-mod]:checked')).map(c => c.dataset.mod);
          u.active = u.active !== false;
          if (isNew) DB.users.push(u);            /* push 钩子自动云同步 */
          else syncUser(u);                        /* 编辑是属性赋值，必须显式同步 */
          App.btnLoading(btn);
          await new Promise(r => setTimeout(r, 200));
          App.btnDone(btn);
          App.closeModal();
          App.toast(isNew ? '已新增账号 ' + u.name : '已保存');
          render();
        });
      },
    });
  }

  function pwdResetModal(id) {
    const u = _u(id);
    if (!u) return;
    App.openModal({
      title: '重置密码 · ' + u.name,
      html: '<div class="form-hint" style="margin-bottom:12px">新密码将立即生效。建议设为 6 位以上英文 / 数字组合。</div>' +
        '<div class="field"><label>新密码</label><input class="input" id="newPwd" value="123456"><p class="form-error"></p></div>',
      foot: '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存</button>',
      onMount(box) {
        box.querySelector('[data-act="cancel"]').addEventListener('click', () => App.closeModal());
        box.querySelector('[data-act="ok"]').addEventListener('click', e => {
          const btn = e.currentTarget, pEl = box.querySelector('#newPwd');
          App.formClear(pEl);
          if (!pEl.value.trim() || pEl.value.length < 4) return App.formError(pEl, '至少 4 个字符');
          u.pwd = pEl.value;
          syncUser(u);
          App.btnLoading(btn);
          setTimeout(() => { App.btnDone(btn); App.closeModal(); App.toast('密码已重置'); }, 200);
        });
      },
    });
  }
})();
