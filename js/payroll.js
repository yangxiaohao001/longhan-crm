/* payroll.js — 工资核算（总经理 / 财务专用）
   月度工资表：考勤 Excel 导入 → 扣款/加班费自动建议 → 人工核对调整 → 标记发放
   规则（PAYROLL_RULES）：日工资 = 基本工资 ÷ 21.75；迟到每次扣 50 元；加班费 = 时薪 × 1.5 */
(function () {
  const sess = App.session();
  const RULES = { BASE_DAYS: 21.75, LATE_FINE: 50, OT_RATE: 1.5 };
  const STATUS_META = { '草稿': 'badge-warn', '已发放': 'badge-success' };
  const todayStr = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  const state = { month: todayStr.slice(0, 7) };

  const num = x => Math.round((Number(x) || 0) * 100) / 100;
  const dailyWage = base => num((Number(base) || 0) / RULES.BASE_DAYS);
  const hourlyWage = base => num(dailyWage(base) / 8);
  const calcNet = r => num((Number(r.base_salary) || 0) - (Number(r.deduction_attend) || 0)
    + (Number(r.overtime_pay) || 0) + (Number(r.bonus) || 0) - (Number(r.other_deduction) || 0));

  /* 按考勤数据给出扣款/加班费建议值 */
  function suggest(r) {
    const daily = dailyWage(r.base_salary);
    return {
      deduction_attend: num((Number(r.absent_days) || 0) * daily + (Number(r.late_count) || 0) * RULES.LATE_FINE),
      overtime_pay: num((Number(r.overtime_hours) || 0) * hourlyWage(r.base_salary) * RULES.OT_RATE),
    };
  }

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
        '<div class="view-banner"><span data-icon="banknote"></span>规则：日工资 = 基本工资 ÷ 21.75；迟到每次扣 ' + RULES.LATE_FINE + ' 元；加班费 = 时薪 × ' + RULES.OT_RATE + '。导入考勤后自动计算，可逐项手工调整。</div>' +

        '<div class="grid grid-kpi" style="margin-bottom:16px">' +
        '<div class="kpi"><div class="kpi-label"><span class="icon" data-icon="banknote"></span>本月应发合计</div><div class="kpi-value" data-count="' + Math.round(totalNet) + '">¥' + App.fmtMoney(totalNet) + '</div></div>' +
        '<div class="kpi"><div class="kpi-label"><span class="icon" data-icon="wallet"></span>已发放</div><div class="kpi-value success">¥' + App.fmtMoney(paidNet) + '</div></div>' +
        '<div class="kpi"><div class="kpi-label"><span class="icon" data-icon="users"></span>人数</div><div class="kpi-value" data-count="' + rows.length + '">' + rows.length + '</div></div>' +
        '</div>' +

        '<div class="card"><div class="card-head">' +
        '<div class="chip-row"><select class="select" id="monthSel" style="width:130px">' + monthOptions() + '</select></div>' +
        '<div class="card-tools">' +
        '<button class="btn btn-sm" id="pTpl"><span data-icon="download"></span>下载导入模板</button>' +
        '<button class="btn btn-sm" id="pExport"><span data-icon="download"></span>导出本月工资表</button>' +
        '<button class="btn btn-sm" id="pAdd"><span data-icon="plus"></span>新增员工工资</button>' +
        '</div></div>' +
        '<div class="card-body">' +
        '<div class="import-row" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">' +
        '<button class="btn btn-sm" id="pImport"><span data-icon="file-spreadsheet"></span>导入考勤工资 Excel</button>' +
        '<span class="sub-line" id="pImportMsg">列：姓名 / 基本工资 / 出勤天数 / 缺勤天数 / 迟到次数 / 加班小时 / 奖金补贴 / 其他扣款（可拖入虚线框）</span></div>' +
        '<div id="pDrop" class="q-drop">将考勤工资 Excel 拖到此处导入（支持从微信直接拖入）</div>' +
        '</div>' +
        '<div class="card-body table-wrap"><table class="table">' +
        '<thead><tr><th>员工</th><th>基本工资</th><th>出勤</th><th>缺勤</th><th>迟到</th><th>加班(h)</th><th>考勤扣款</th><th>加班费</th><th>奖金</th><th>其他扣款</th><th>应发</th><th>状态</th><th></th></tr></thead><tbody>' +
        (rows.length ? rows.map(r =>
          '<tr>' +
          '<td style="font-weight:600">' + App.escapeHtml(r.userName) + '<div class="sub-line">' + App.escapeHtml(r.position || '') + '</div></td>' +
          '<td class="money">' + App.fmtMoney(r.base_salary) + '</td>' +
          '<td class="num">' + (r.attend_days || 0) + '</td>' +
          '<td class="num">' + (r.absent_days || 0) + '</td>' +
          '<td class="num">' + (r.late_count || 0) + '</td>' +
          '<td class="num">' + (r.overtime_hours || 0) + '</td>' +
          '<td class="money danger">' + App.fmtMoney(r.deduction_attend) + '</td>' +
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
          : '<tr><td colspan="13"><div class="empty"><span data-icon="inbox"></span><p>本月还没有工资数据——点「新增员工工资」逐个录入，或用「导入考勤工资 Excel」批量导入</p></div></td></tr>') +
        '</tbody></table></div></div>';

      root.querySelector('#monthSel').addEventListener('change', e => { state.month = e.target.value; renderList(); });
      root.querySelector('#pAdd').addEventListener('click', () => editModal(null));
      root.querySelector('#pImport').addEventListener('click', () => pickImport());
      root.querySelector('#pTpl').addEventListener('click', downloadTpl);
      root.querySelector('#pExport').addEventListener('click', () => exportXlsx(rows));
      root.querySelectorAll('[data-pedit]').forEach(b => b.addEventListener('click', () => editModal(rows.find(x => x.id === b.dataset.pedit))));
      root.querySelectorAll('[data-ppay]').forEach(b => b.addEventListener('click', () => App.confirm({
        title: '标记为已发放？', html: '将记录发放日期为今天（' + App.today + '）。', okText: '确认发放',
        onOk: async () => { const r = await savePayrollRow({ user_id: b.dataset.ppay, month: state.month, status: '已发放', pay_date: todayStr }); if (r.code !== 0) return App.toast(r.msg, 'danger'); App.toast('已标记发放'); renderList(); },
      })));
      root.querySelectorAll('[data-pdel]').forEach(b => b.addEventListener('click', () => App.confirm({
        title: '删除这条工资记录？', html: '删除后不可恢复。', okText: '删除', danger: true,
        onOk: async () => { const r = await deletePayrollRow(b.dataset.pdel); if (r.code !== 0) return App.toast(r.msg, 'danger'); App.toast('已删除'); renderList(); },
      })));
      bindDrop(root.querySelector('#pDrop'));
      App.mountIcons(root);
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

  /* ---------- 编辑 / 新增 ---------- */
  function editModal(row) {
    const isNew = !row;
    const r = row ? Object.assign({}, row) : { user_id: '', month: state.month, base_salary: 0, attend_days: 0, absent_days: 0, late_count: 0, overtime_hours: 0, deduction_attend: 0, overtime_pay: 0, bonus: 0, other_deduction: 0, note: '' };
    const sug = suggest(r);
    r.deduction_attend = r.deduction_attend || sug.deduction_attend;
    r.overtime_pay = r.overtime_pay || sug.overtime_pay;
    const users = DB.users.filter(u => u.active !== false);
    App.openModal({
      title: isNew ? '新增员工工资 · ' + state.month : '编辑工资 · ' + (r.userName || ''),
      wide: true,
      html:
        '<div class="form-grid">' +
        '<div class="form-item"><label>员工<b>*</b></label>' + (isNew
          ? '<select class="select" id="eUser">' + users.map(u => '<option value="' + u.id + '">' + App.escapeHtml(u.name) + '（' + u.position + '）</option>').join('') + '</select>'
          : '<input class="input" value="' + App.escapeHtml(r.userName || '') + '" disabled>') + '</div>' +
        '<div class="form-item"><label>基本工资（元）<b>*</b></label><input class="input num" id="eBase" type="number" min="0" step="0.01" value="' + (r.base_salary || '') + '"><p class="form-error"></p></div>' +
        '<div class="form-item"><label>出勤天数</label><input class="input num" id="eAttend" type="number" min="0" step="0.5" value="' + (r.attend_days || 0) + '"></div>' +
        '<div class="form-item"><label>缺勤天数</label><input class="input num" id="eAbsent" type="number" min="0" step="0.5" value="' + (r.absent_days || 0) + '"></div>' +
        '<div class="form-item"><label>迟到次数</label><input class="input num" id="eLate" type="number" min="0" value="' + (r.late_count || 0) + '"></div>' +
        '<div class="form-item"><label>加班小时</label><input class="input num" id="eOt" type="number" min="0" step="0.5" value="' + (r.overtime_hours || 0) + '"></div>' +
        '<div class="form-item"><label>考勤扣款（缺勤×日薪 + 迟到×50）</label><input class="input num" id="eDed" type="number" min="0" step="0.01" value="' + (r.deduction_attend || 0) + '"></div>' +
        '<div class="form-item"><label>加班费（时薪×1.5×小时）</label><input class="input num" id="eOtPay" type="number" min="0" step="0.01" value="' + (r.overtime_pay || 0) + '"></div>' +
        '<div class="form-item"><label>奖金 / 补贴（元）</label><input class="input num" id="eBonus" type="number" step="0.01" value="' + (r.bonus || 0) + '"></div>' +
        '<div class="form-item"><label>其他扣款（元）</label><input class="input num" id="eOther" type="number" min="0" step="0.01" value="' + (r.other_deduction || 0) + '"></div>' +
        '<div class="form-item" style="grid-column:1/-1"><label>备注</label><input class="input" id="eNote" value="' + App.escapeHtml(r.note || '') + '"></div>' +
        '</div>' +
        '<div class="import-total" style="margin:0"><span data-icon="banknote"></span>应发工资：<b class="money success" id="eNet" style="margin-left:6px;font-size:16px">¥0</b><span class="sub-line" style="margin-left:10px" id="eNetHint"></span></div>',
      foot: '<button class="btn" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">保存</button>',
      onMount(box) {
        const $ = id => box.querySelector(id);
        function refresh() {
          const rr = {
            base_salary: Number($('#eBase').value) || 0,
            absent_days: Number($('#eAbsent').value) || 0,
            late_count: Number($('#eLate').value) || 0,
            overtime_hours: Number($('#eOt').value) || 0,
            deduction_attend: Number($('#eDed').value) || 0,
            overtime_pay: Number($('#eOtPay').value) || 0,
            bonus: Number($('#eBonus').value) || 0,
            other_deduction: Number($('#eOther').value) || 0,
          };
          $('#eNet').textContent = App.fmtMoney(calcNet(rr));
          const sug = suggest(rr);
          $('#eNetHint').textContent = '建议扣款 ' + App.fmtMoney(sug.deduction_attend) + ' / 建议加班费 ' + App.fmtMoney(sug.overtime_pay) + '（日薪 ' + App.fmtMoney(dailyWage(rr.base_salary)) + '）';
        }
        ['\#eBase', '#eAttend', '#eAbsent', '#eLate', '#eOt'].forEach(sel => $(sel).addEventListener('input', () => {
          const rr = { base_salary: Number($('#eBase').value) || 0, absent_days: Number($('#eAbsent').value) || 0, late_count: Number($('#eLate').value) || 0, overtime_hours: Number($('#eOt').value) || 0 };
          const sug = suggest(rr);
          $('#eDed').value = sug.deduction_attend;
          $('#eOtPay').value = sug.overtime_pay;
          refresh();
        }));
        ['#eDed', '#eOtPay', '#eBonus', '#eOther'].forEach(sel => $(sel).addEventListener('input', refresh));
        refresh();
        box.querySelector('[data-act="cancel"]').addEventListener('click', () => App.closeModal());
        box.querySelector('[data-act="ok"]').addEventListener('click', async e => {
          const btn = e.currentTarget;
          const baseEl = $('#eBase');
          App.formClear(baseEl);
          const base = Number(baseEl.value);
          if (!base || base <= 0) return App.formError(baseEl, '请填写基本工资');
          App.btnLoading(btn);
          const r = await savePayrollRow({
            user_id: isNew ? $('#eUser').value : r.user_id, month: state.month,
            base_salary: base, attend_days: Number($('#eAttend').value) || 0,
            absent_days: Number($('#eAbsent').value) || 0, late_count: Number($('#eLate').value) || 0,
            overtime_hours: Number($('#eOt').value) || 0,
            deduction_attend: Number($('#eDed').value) || 0, overtime_pay: Number($('#eOtPay').value) || 0,
            bonus: Number($('#eBonus').value) || 0, other_deduction: Number($('#eOther').value) || 0,
            note: $('#eNote').value,
          });
          App.btnDone(btn);
          if (r.code !== 0) return App.toast(r.msg, 'danger');
          App.closeModal(); App.toast('工资记录已保存'); renderList();
        });
      },
    });
  }

  /* ---------- 考勤工资 Excel 导入 ---------- */
  function parseImport(grid) {
    const norm = x => String(x == null ? '' : x).trim();
    const KEY = { name: ['姓名', '员工', '名称'], base: ['基本工资'], attend: ['出勤'], absent: ['缺勤'], late: ['迟到'], ot: ['加班'], bonus: ['奖金', '补贴'], other: ['其他扣款', '社保', '扣款'] };
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
        if (!name || /合计|平均|汇总/.test(name)) continue;
        out.push({
          name, base_salary: num(map.base != null ? row[map.base] : 0),
          attend_days: num(map.attend != null ? row[map.attend] : 0), absent_days: num(map.absent != null ? row[map.absent] : 0),
          late_count: parseInt(num(map.late != null ? row[map.late] : 0)) || 0, overtime_hours: num(map.ot != null ? row[map.ot] : 0),
          bonus: num(map.bonus != null ? row[map.bonus] : 0), other_deduction: num(map.other != null ? row[map.other] : 0),
        });
      }
    } else {
      /* 无表头：按默认列顺序 姓名/基本工资/出勤/缺勤/迟到/加班/奖金/其他扣款 */
      for (const row of grid) {
        const cells = (row || []).map(norm);
        if (!cells[0] || /合计|说明/.test(cells[0])) continue;
        out.push({ name: cells[0], base_salary: num(cells[1]), attend_days: num(cells[2]), absent_days: num(cells[3]), late_count: parseInt(num(cells[4])) || 0, overtime_hours: num(cells[5]), bonus: num(cells[6]), other_deduction: num(cells[7]) });
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
      if (d.skipped.length) m += '；跳过 ' + d.skipped.length + ' 人（' + d.skipped.slice(0, 3).map(x => x.name + '：' + x.reason).join('；') + '）';
      msg.textContent = m;
      App.toast(m, d.skipped.length ? 'warn' : 'success');
      renderList();
      /* 源文件留档到云存储 */
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
      const head = ['姓名', '基本工资', '出勤天数', '缺勤天数', '迟到次数', '加班小时', '奖金补贴', '其他扣款', '备注'];
      const ws = XLSX.utils.aoa_to_sheet([
        ['河北龙瀚金属制品有限公司 — ' + state.month + ' 月考勤工资导入表'],
        head,
        ['示例：张三', 5000, 21, 0, 1, 4, 0, 200, '示例行，导入前请删除'],
        [],
        ['说明：姓名需与系统员工名完全一致；扣款与加班费不填则按规则自动计算（迟到×50 + 缺勤×日工资；加班×时薪×1.5）。'],
      ]);
      ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 20 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '工资导入');
      XLSX.writeFile(wb, state.month + '月工资导入模板.xlsx');
    } catch (e) { App.toast('模板生成失败：' + e.message, 'danger'); }
  }

  function exportXlsx(rows) {
    try {
      const head = ['姓名', '岗位', '基本工资', '出勤天数', '缺勤天数', '迟到次数', '加班小时', '考勤扣款', '加班费', '奖金补贴', '其他扣款', '应发工资', '状态', '发放日期', '备注'];
      const data = rows.map(r => [r.userName, r.position || '', Number(r.base_salary) || 0, Number(r.attend_days) || 0, Number(r.absent_days) || 0, Number(r.late_count) || 0, Number(r.overtime_hours) || 0, Number(r.deduction_attend) || 0, Number(r.overtime_pay) || 0, Number(r.bonus) || 0, Number(r.other_deduction) || 0, Number(r.net_pay) || 0, r.status, r.pay_date || '', r.note || '']);
      const total = rows.reduce((s, r) => s + (Number(r.net_pay) || 0), 0);
      data.push(['合计', '', '', '', '', '', '', '', '', '', '', Math.round(total * 100) / 100, '', '', '']);
      const ws = XLSX.utils.aoa_to_sheet([head].concat(data));
      ws['!cols'] = [{ wch: 10 }, { wch: 8 }, { wch: 11 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 11 }, { wch: 10 }, { wch: 10 }, { wch: 11 }, { wch: 12 }, { wch: 8 }, { wch: 11 }, { wch: 18 }];
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
