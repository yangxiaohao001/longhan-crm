/* payroll.js — 工资核算（总经理 / 财务专用）
   应发 = 基本工资 + 加班费（25 元/h × 加班小时） + 奖金 − 其他扣款
   员工可来自系统账号，也可直接填写系统外人员；新月份自动结转员工名单 */
(function () {
  const sess = App.session();
  const OT_HOURLY = 25;
  const STATUS_META = { '草稿': 'badge-warn', '已发放': 'badge-success' };
  const todayStr = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  const state = { month: todayStr.slice(0, 7) };

  const num = x => Math.round((Number(x) || 0) * 100) / 100;
  /* 工资 = 基本工资 ÷ 30 × 出勤天数 + 加班费 + 奖金 − 其他扣款 */
  const calcNet = r => num(num(Number(r.base_salary) || 0) / 30 * (Number(r.attend_days) || 0) + (Number(r.overtime_pay) || 0) + (Number(r.bonus) || 0) - (Number(r.other_deduction) || 0));

  /* 月份状态点：该月有工资数据且全部已发放 → green；有数据含草稿 → yellow；无数据 → 无点 */
  function monthStatus(m) {
    try {
      const rows = (DB.payrolls || []).filter(x => x.month === m);
      if (!rows.length) return '';
      return rows.every(r => r.status === '已发放') ? 'green' : 'yellow';
    } catch (e) { return ''; }
  }
  document.addEventListener('click', () => {
    const mc = document.getElementById('monthCal');
    if (mc) mc.style.display = 'none';
  });

  function renderList() {
    const root = document.getElementById('pageRoot');
    if (!(App.isBoss() || sess.position === '财务')) {
      root.innerHTML = '<div class="empty" style="padding:60px 0"><span data-icon="lock"></span><p>工资核算仅对总经理和财务开放</p></div>';
      return;
    }
    fetchPayroll(state.month).then(res => {
      if (res.code !== 0) { root.innerHTML = '<div class="empty"><p>' + App.escapeHtml(res.msg) + '</p></div>'; return; }
      const rows = res.data;
      const totalNet = rows.reduce((s, r) => s + (Number(r.net_pay) || 0), 0);
      const paidNet = rows.filter(r => r.status === '已发放').reduce((s, r) => s + (Number(r.net_pay) || 0), 0);

      root.innerHTML =
        '<div class="grid grid-kpi" style="margin-bottom:16px">' +
        '<div class="kpi"><div class="kpi-label"><span data-icon="banknote"></span>本月应发合计</div><div class="kpi-value" data-count="' + Math.round(totalNet) + '">—</div></div>' +
        '<div class="kpi"><div class="kpi-label"><span data-icon="wallet"></span>已发放</div><div class="kpi-value success" data-count="' + Math.round(paidNet) + '">—</div></div>' +
        '<div class="kpi"><div class="kpi-label"><span data-icon="users"></span>人数</div><div class="kpi-value" data-count="' + rows.length + '" data-int="1">—</div></div>' +
        '</div>' +

        '<div class="card"><div class="card-head">' +
        '<div class="chip-row" style="position:relative">' +
        '<button class="btn btn-sm" id="monthBtn" style="gap:7px"><span data-icon="calendar"></span><b id="monthBtnTxt">' + state.month + '</b><i class="mc-dot ' + (monthStatus(state.month) ? 'mc-' + monthStatus(state.month) : 'mc-none') + '"></i></button>' +
        '<div id="monthCal" class="month-cal" style="display:none"></div>' +
        '</div>' +
        '<div class="card-tools">' +
        '<button class="btn btn-sm" id="pTpl"><span data-icon="download"></span>下载导入模板</button>' +
        '<button class="btn btn-sm" id="pExport"><span data-icon="download"></span>导出本月工资表</button>' +
        '<button class="btn btn-sm" id="pAdd"><span data-icon="plus"></span>新增员工工资</button>' +
        '</div></div>' +
        '<div class="card-body">' +
        '<div class="import-row" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">' +
        '<button class="btn btn-sm" id="pImport"><span data-icon="file-spreadsheet"></span>导入考勤工资 Excel</button>' +
        '<span class="sub-line" id="pImportMsg">列：姓名 / 基本工资 / 出勤天数 / 加班小时 / 奖金 / 其他扣款（加班费按 25 元/小时 自动计算）</span></div>' +
        '<div id="pDrop" class="q-drop">将考勤工资 Excel 拖到此处导入（支持从微信直接拖入）</div>' +
        '</div>' +
        '<div class="card-body table-wrap"><table class="table">' +
        '<thead><tr><th>员工</th><th>基本工资</th><th>出勤天数</th><th>加班小时</th><th>加班费</th><th>奖金</th><th>其他扣款</th><th>应发</th><th>状态</th><th></th></tr></thead><tbody>' +
        (rows.length ? rows.map(r =>
          '<tr>' +
          '<td style="font-weight:600">' + App.escapeHtml(r.userName) + '</td>' +
          '<td class="money">' + App.fmtMoney(r.base_salary) + '</td>' +
          '<td class="num">' + (r.attend_days || 0) + '</td>' +
          '<td class="num">' + (r.overtime_hours || 0) + '</td>' +
          '<td class="money">' + App.fmtMoney(r.overtime_pay) + '</td>' +
          '<td class="money">' + App.fmtMoney(r.bonus) + '</td>' +
          '<td class="money danger">' + App.fmtMoney(r.other_deduction) + '</td>' +
          '<td class="money success" style="font-weight:700">' + App.fmtMoney(r.net_pay) + '</td>' +
          '<td>' + App.badge(r.status, STATUS_META[r.status]) + (r.pay_date ? '<div class="sub-line">' + r.pay_date + '</div>' : '') + '</td>' +
          '<td><div class="row-actions">' +
          (r.status !== '已发放' ? '<button class="btn btn-sm btn-primary" data-ppay="' + r.id + '">标记发放</button>' : '') +
          '<button class="btn btn-sm" data-pedit="' + r.id + '"><span data-icon="pencil"></span>编辑</button>' +
          '<button class="btn btn-sm btn-danger" data-pdel="' + r.id + '"><span data-icon="trash-2"></span></button>' +
          '</div></td></tr>').join('')
          : '<tr><td colspan="10"><div class="empty"><span data-icon="inbox"></span><p>本月还没有工资数据——点「新增员工工资」逐个录入，或「导入考勤工资 Excel」批量导入；切换到新月份时会自动带上员工名单</p></div></td></tr>') +
        '</tbody></table></div></div>';

      /* 月份日历面板 */
      const mBtn = root.querySelector('#monthBtn'), mCal = root.querySelector('#monthCal');
      let calYear = Number(state.month.slice(0, 4));
      const renderCal = () => {
        const cells = [];
        for (let i = 1; i <= 12; i++) {
          const m = calYear + '-' + String(i).padStart(2, '0');
          const st = monthStatus(m);
          cells.push('<button class="mc-cell' + (m === state.month ? ' active' : '') + '" data-m="' + m + '">' + i + '月' +
            (st ? '<i class="mc-dot mc-' + st + '"></i>' : '') + '</button>');
        }
        mCal.innerHTML =
          '<div class="month-cal-head"><button class="btn btn-sm" id="calPrev"><span data-icon="chevron-left"></span></button>' +
          '<b style="font-size:13.5px">' + calYear + ' 年</b>' +
          '<button class="btn btn-sm" id="calNext"><span data-icon="chevron-right"></span></button></div>' +
          '<div class="month-cal-grid">' + cells.join('') + '</div>' +
          '<div class="month-cal-legend"><span><i class="mc-dot mc-green"></i>已发放</span><span><i class="mc-dot mc-yellow"></i>有数据未发放</span><span>无点 = 无数据</span></div>';
        mCal.querySelector('#calPrev').addEventListener('click', () => { calYear--; renderCal(); });
        mCal.querySelector('#calNext').addEventListener('click', () => { calYear++; renderCal(); });
        mCal.querySelectorAll('.mc-cell').forEach(c => c.addEventListener('click', () => {
          state.month = c.dataset.m;
          mCal.style.display = 'none';
          root.querySelector('#monthBtnTxt').textContent = state.month;
          renderList();
        }));
        App.mountIcons(mCal);
      };
      mBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (mCal.style.display !== 'none') { mCal.style.display = 'none'; return; }
        calYear = Number(state.month.slice(0, 4));
        renderCal();
        mCal.style.display = 'block';
      });
      mCal.addEventListener('click', e => e.stopPropagation());
      root.querySelector('#pAdd').addEventListener('click', () => editModal(null));
      root.querySelector('#pImport').addEventListener('click', () => pickImport());
      root.querySelector('#pTpl').addEventListener('click', downloadTpl);
      root.querySelector('#pExport').addEventListener('click', () => exportXlsx(rows));
      root.querySelectorAll('[data-pedit]').forEach(b => b.addEventListener('click', () => editModal(rows.find(x => x.id === b.dataset.pedit))));
      root.querySelectorAll('[data-ppay]').forEach(b => b.addEventListener('click', () => payModal(rows.find(x => x.id === b.dataset.ppay))));
      root.querySelectorAll('[data-pdel]').forEach(b => b.addEventListener('click', () => App.confirm({
        title: '删除这条工资记录？', html: '删除后不可恢复。', okText: '删除', danger: true,
        onOk: async () => { const r = await deletePayrollRow(b.dataset.pdel); if (r.code !== 0) return App.toast(r.msg, 'danger'); App.toast('已删除'); renderList(); },
      })));
      bindDrop(root.querySelector('#pDrop'));
      App.mountIcons(root);
      root.querySelectorAll('.kpi-value[data-count]').forEach(el => App.countUp(el, Number(el.dataset.count)));
    });
  }

  function monthOptions() {
    const out = [];
    const d = new Date();
    for (let i = 0; i < 24; i++) {
      const m = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      out.push('<option value="' + m + '"' + (m === state.month ? ' selected' : '') + '>' + m + '</option>');
      d.setMonth(d.getMonth() - 1);
    }
    return out.join('');
  }

  /* ---------- 编辑 / 新增（员工可直接输入姓名，也可从下拉选择系统员工） ---------- */
  function editModal(row) {
    const isNew = !row;
    const r = row ? Object.assign({}, row) : { user_id: '', name: '', month: state.month, base_salary: '', attend_days: 0, overtime_hours: 0, overtime_pay: 0, bonus: 0, other_deduction: 0, note: '' };
    const sysNames = DB.users.filter(u => u.active !== false).map(u => u.name);
    App.openModal({
      title: isNew ? '新增员工工资 · ' + state.month : '编辑工资 · ' + (r.userName || ''),
      wide: true,
      html:
        '<div class="form-grid">' +
        '<div class="form-item"><label>员工姓名<b>*</b></label><input class="input" id="eName" list="pUserList" value="' + App.escapeHtml(r.userName || '') + '" placeholder="输入姓名（可填系统外人员）" autocomplete="off"><datalist id="pUserList">' + sysNames.map(n => '<option value="' + App.escapeHtml(n) + '">').join('') + '</datalist><p class="form-error"></p></div>' +
        '<div class="form-item"><label>基本工资（元）<b>*</b></label><input class="input num" id="eBase" type="number" min="0" step="0.01" value="' + (r.base_salary || '') + '"><p class="form-error"></p></div>' +
        '<div class="form-item"><label>出勤天数（基本工资按 ÷30×出勤 折算）<b>*</b></label><input class="input num" id="eAttend" type="number" min="0" step="0.5" value="' + (r.attend_days || 0) + '"></div>' +
        '<div class="form-item"><label>加班小时</label><input class="input num" id="eOt" type="number" min="0" step="0.5" value="' + (r.overtime_hours || 0) + '"></div>' +
        '<div class="form-item"><label>加班费（元，按 ' + OT_HOURLY + ' 元/小时）</label><input class="input num" id="eOtPay" type="number" min="0" step="0.01" value="' + (r.overtime_pay || 0) + '"></div>' +
        '<div class="form-item"><label>奖金 / 补贴（元）</label><input class="input num" id="eBonus" type="number" step="0.01" value="' + (r.bonus || 0) + '"></div>' +
        '<div class="form-item"><label>其他扣款（元）</label><input class="input num" id="eOther" type="number" min="0" step="0.01" value="' + (r.other_deduction || 0) + '"></div>' +
        '<div class="form-item" style="grid-column:1/-1"><label>备注</label><input class="input" id="eNote" value="' + App.escapeHtml(r.note || '') + '"></div>' +
        '</div>' +
        '<div class="import-total" style="margin:0"><span data-icon="banknote"></span>应发工资：<b class="money success" id="eNet" style="margin-left:6px;font-size:16px">¥0</b><span class="sub-line" style="margin-left:10px">= 基本工资÷30×出勤 + 加班费 + 奖金 − 其他扣款</span></div>',
      foot: '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存</button>',
      onMount(box) {
        const $ = id => box.querySelector(id);
        function refresh() {
          $('#eNet').textContent = App.fmtMoney(calcNet({
            base_salary: $('#eBase').value, attend_days: $('#eAttend').value, overtime_pay: $('#eOtPay').value,
            bonus: $('#eBonus').value, other_deduction: $('#eOther').value,
          }));
        }
        $('#eOt').addEventListener('input', () => { $('#eOtPay').value = num(Number($('#eOt').value) || 0) * OT_HOURLY; refresh(); });
        ['#eBase', '#eAttend', '#eOtPay', '#eBonus', '#eOther'].forEach(sel => $(sel).addEventListener('input', refresh));
        refresh();
        box.querySelector('[data-act="cancel"]').addEventListener('click', () => App.closeModal());
        box.querySelector('[data-act="ok"]').addEventListener('click', async e => {
          const btn = e.currentTarget;
          const nameEl = $('#eName'), baseEl = $('#eBase');
          [nameEl, baseEl].forEach(App.formClear);
          const name = nameEl.value.trim();
          if (!name) return App.formError(nameEl, '请填写员工姓名');
          const base = Number(baseEl.value);
          if (!base || base <= 0) return App.formError(baseEl, '请填写基本工资');
          const attendV = Number($('#eAttend').value);
          if (!(attendV >= 0) || $('#eAttend').value === '') return App.formError($('#eAttend'), '请填写出勤天数');
          App.btnLoading(btn);
          /* 注意：不能命名为 r —— 会遮蔽外层 r（编辑时读 r.user_id 触发 TDZ 崩溃，保存永远转圈） */
          const saved = await savePayrollRow({
            user_id: isNew ? '' : r.user_id, name, month: state.month,
            base_salary: base, attend_days: Number($('#eAttend').value) || 0,
            overtime_hours: Number($('#eOt').value) || 0, overtime_pay: Number($('#eOtPay').value) || 0,
            bonus: Number($('#eBonus').value) || 0, other_deduction: Number($('#eOther').value) || 0,
            note: $('#eNote').value,
          });
          App.btnDone(btn);
          if (saved.code !== 0) return App.toast(saved.msg, 'danger');
          App.closeModal(); App.toast('工资记录已保存'); renderList();
        });
      },
    });
  }

  /* ---------- 标记发放（发放日期可选） ---------- */
  function payModal(row) {
    App.openModal({
      title: '标记为已发放 · ' + (row.userName || ''),
      html:
        '<div class="form-grid">' +
        '<div class="form-item"><label>应发工资</label><input class="input" value="¥' + App.fmtMoney(row.net_pay) + '" disabled></div>' +
        '<div class="form-item"><label>发放日期<b>*</b></label><input class="input" id="payDate" type="date" value="' + todayStr + '"></div>' +
        '</div>',
      foot: '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">确认发放</button>',
      onMount(box) {
        box.querySelector('[data-act="cancel"]').addEventListener('click', () => App.closeModal());
        box.querySelector('[data-act="ok"]').addEventListener('click', async e => {
          const btn = e.currentTarget;
          const date = box.querySelector('#payDate').value;
          if (!date) return App.toast('请选择发放日期', 'danger');
          App.btnLoading(btn);
          const r = await savePayrollRow({ user_id: row.user_id, name: row.userName, month: row.month, status: '已发放', pay_date: date });
          App.btnDone(btn);
          if (r.code !== 0) return App.toast(r.msg, 'danger');
          App.closeModal(); App.toast('已标记发放（' + date + '）'); renderList();
        });
      },
    });
  }

  /* ---------- 考勤工资 Excel 导入 ---------- */
  function parseImport(grid) {
    const norm = x => String(x == null ? '' : x).trim();
    const KEY = { name: ['姓名', '员工', '名称'], base: ['基本工资'], attend: ['出勤'], ot: ['加班'], bonus: ['奖金', '补贴'], other: ['其他扣款', '社保'] };
    let map = null, headIdx = -1;
    for (let i = 0; i < Math.min(grid.length, 10); i++) {
      const row = (grid[i] || []).map(norm);
      const m = {}; const used = new Set(); let hits = 0;
      Object.keys(KEY).forEach(k => {
        const idx = row.findIndex((cell, ci) => !used.has(ci) && KEY[k].some(kw => cell.includes(kw)));
        if (idx >= 0) { m[k] = idx; used.add(idx); hits++; }
      });
      if (hits >= 2 && m.name != null) { map = m; headIdx = i; break; }
    }
    const num = x => Number(String(x == null ? '' : x).replace(/[^\d.-]/g, '')) || 0;
    const out = [];
    if (map) {
      for (let i = headIdx + 1; i < grid.length; i++) {
        const row = grid[i] || [];
        const name = norm(map.name != null ? row[map.name] : '');
        if (!name || /合计|平均|汇总|^示例|^说明/.test(name)) continue;
        out.push({ name, base_salary: num(map.base != null ? row[map.base] : 0), attend_days: num(map.attend != null ? row[map.attend] : 0), overtime_hours: num(map.ot != null ? row[map.ot] : 0), bonus: num(map.bonus != null ? row[map.bonus] : 0), other_deduction: num(map.other != null ? row[map.other] : 0) });
      }
    } else {
      for (const row of grid) {
        const cells = (row || []).map(norm);
        if (!cells[0] || /合计|说明|^示例/.test(cells[0])) continue;
        out.push({ name: cells[0], base_salary: num(cells[1]), attend_days: num(cells[2]), overtime_hours: num(cells[3]), bonus: num(cells[4]), other_deduction: num(cells[5]) });
      }
    }
    return out;
  }

  function pickImport() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv';
    inp.onchange = () => { if (inp.files && inp.files[0]) doImport(inp.files[0]); };
    inp.click();
  }

  async function doImport(f) {
    const msg = document.getElementById('pImportMsg');
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
      const items = parseImport(grid);
      if (!items.length) { msg.textContent = '没有识别到有效数据行，请参照模板格式'; return; }
      const res = await importPayrollRows(items, state.month);
      const d = res.data;
      let m = '导入完成：新建 ' + d.created.length + ' 人，更新 ' + d.updated.length + ' 人';
      if (d.skipped.length) m += '（系统外员工已按外部人员登记）';
      msg.textContent = m;
      App.toast(m, 'success');
      renderList();
      App.dbUpload('payroll-imports', f);
    } catch (err) { msg.textContent = '解析失败：' + err.message; }
  }

  function bindDrop(dz) {
    if (!dz) return;
    const highlight = on => dz.classList.toggle('on', on);
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); highlight(true); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); highlight(false); }));
    dz.addEventListener('drop', e => {
      const files = Array.from(e.dataTransfer.files || []);
      const ok = files.find(f => /\.(xlsx|xls|csv)$/i.test(f.name));
      if (!ok) return App.toast('请拖入 Excel / CSV 文件', 'warn');
      doImport(ok);
    });
  }

  /* ---------- 模板下载 / 导出 ---------- */
  function downloadTpl() {
    try {
      const head = ['姓名', '基本工资', '出勤天数', '加班小时', '奖金', '其他扣款', '备注'];
      const ws = XLSX.utils.aoa_to_sheet([
        ['河北龙瀚金属制品有限公司 — ' + state.month + ' 月工资导入表'],
        head,
        [], [], [], [], [], [], [], [],
      ]);
      ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 24 }];
      const ws2 = XLSX.utils.aoa_to_sheet([
        ['填写说明'],
        ['1. 请在第一个工作表「工资导入」的表头下填写员工明细，一行一个人；本说明表不用删除，导入时自动忽略。'],
        ['2. 姓名：可填系统员工，也可填系统外人员（临时工等），系统会自动登记。'],
        ['3. 基本工资：月基本工资（元）。出勤天数：本月实际上班天数。'],
        ['4. 工资公式：基本工资 ÷ 30 × 出勤天数 + 加班费 + 奖金 − 其他扣款。'],
        ['5. 加班费：不填则按 25 元/小时 × 加班小时自动计算；填了以填写值为准。'],
        ['6. 奖金/补贴、其他扣款：没有填 0 即可。备注：选填。'],
      ]);
      ws2['!cols'] = [{ wch: 100 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '工资导入');
      XLSX.utils.book_append_sheet(wb, ws2, '填写说明');
      XLSX.writeFile(wb, state.month + '月工资导入模板.xlsx');
    } catch (e) { App.toast('模板生成失败：' + e.message, 'danger'); }
  }

  function exportXlsx(rows) {
    try {
      const head = ['姓名', '基本工资', '出勤天数', '加班小时', '加班费', '奖金', '其他扣款', '应发工资', '状态', '发放日期', '备注'];
      const data = rows.map(r => [r.userName, Number(r.base_salary) || 0, Number(r.attend_days) || 0, Number(r.overtime_hours) || 0, Number(r.overtime_pay) || 0, Number(r.bonus) || 0, Number(r.other_deduction) || 0, Number(r.net_pay) || 0, r.status, r.pay_date || '', r.note || '']);
      const total = rows.reduce((s, r) => s + (Number(r.net_pay) || 0), 0);
      data.push(['合计', '', '', '', '', '', '', Math.round(total * 100) / 100, '', '', '']);
      const ws = XLSX.utils.aoa_to_sheet([head].concat(data));
      ws['!cols'] = [{ wch: 10 }, { wch: 11 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 11 }, { wch: 12 }, { wch: 8 }, { wch: 11 }, { wch: 18 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, state.month + ' 工资表');
      XLSX.writeFile(wb, state.month + '月工资表.xlsx');
    } catch (e) { App.toast('导出失败：' + e.message, 'danger'); }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (!App.requireLogin()) return;
    if (App.bootstrapFromCloud) await App.bootstrapFromCloud();
    await new Promise(r => {
      const t0 = Date.now();
      const w = () => (typeof App.canRoute === 'function') ? r() : (Date.now() - t0 < 3000 ? setTimeout(w, 30) : r());
      w();
    });
    if (!(App.isBoss() || sess.position === '财务')) {
      document.getElementById('pageRoot').innerHTML = '<div class="empty" style="padding:60px 0"><span data-icon="lock"></span><p>工资核算仅对总经理和财务开放</p></div>';
      return;
    }
    await renderList();
  });
})();
