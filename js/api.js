/* ============================================================
   api.js — 异步服务存根层（形状即未来真实 API）
   内部读 mock DB；联调时按 TODO 注释替换为真实请求即可。
   所有页面必须经本层取数，禁止直接读 DB 自算一套。

   口径约定（与调研表对齐）：
   - 报价 version.total 不落库，一律由明细求和（_versionTotal）
   - 客户阶段：商机 5 段（初步接触→商务谈判）手动推进；
     订单 4 段（已下单/生产中/已发货/已收款）由订单状态自动同步
   - 丢单必须记录原因（markCustomerLost）
   - 报价流：草稿 →(提交) 待审批 →(老板通过) 已发送 →(成交) 已成交并自动生成订单
   ============================================================ */

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ---------- 内部派生工具（不对外） ---------- */
function _d(str) { return new Date(str + 'T00:00:00'); }
function _days(a, b) { return Math.round((_d(a) - _d(b)) / 86400000); } // 正数 = a 在 b 未来
function _monthOf(iso) { return iso ? iso.slice(0, 7) : ''; }
function _uid() { return 'x' + Math.random().toString(36).slice(2, 9); }

/* 云端同步：所有增/改/删走完后调（本地模式直接通过） */
function _cloudSync(table, op, payload) {
  if (typeof App === 'undefined' || !App.dbSync) return;
  if (App.dbMode && App.dbMode() !== 'cloud') return;
  App.dbSync(table, op, payload).then(r => {
    if (!r.ok) console.warn('[云同步] ' + table + ' ' + op + ' 失败:', r.msg);
  });
}

/* 拦截 DB 数组的所有可能变更方法：push / unshift / splice / 直接赋值 */
const _SYNC_TABLES = ['customers', 'quotes', 'orders', 'payments', 'followups', 'reminders', 'purchases', 'manualLedgers', 'users', 'suppliers'];
function _patchArray(table) {
  if (!DB[table] || !Array.isArray(DB[table]) || DB[table]._patched) return;
  const arr = DB[table];
  const origPush = arr.push.bind(arr);
  const origUnshift = arr.unshift.bind(arr);
  const origSplice = arr.splice.bind(arr);
  arr.push = function (...items) {
    const r = origPush(...items);
    items.forEach(it => _cloudSync(table, 'upsert', it));
    return r;
  };
  arr.unshift = function (...items) {
    const r = origUnshift(...items);
    items.forEach(it => _cloudSync(table, 'upsert', it));
    return r;
  };
  arr.splice = function (start, deleteCount, ...items) {
    const removed = this.slice(start, start + (deleteCount || 0));
    const r = origSplice(start, deleteCount, ...items);
    removed.forEach(it => _cloudSync(table, 'delete', it));
    items.forEach(it => _cloudSync(table, 'upsert', it));
    return r;
  };
  arr._patched = true;
}
function _patchAllArrays() { _SYNC_TABLES.forEach(_patchArray); }

function _ensurePatched() {
  if (typeof DB === 'undefined' || !DB.customers) return;
  _patchAllArrays();
}

function _customerById(id) { return DB.customers.find(c => c.id === id) || null; }
function _userById(id) { return DB.users.find(u => u.id === id) || null; }
function _orderById(id) { return DB.orders.find(o => o.id === id) || null; }
function _quoteById(id) { return DB.quotes.find(q => q.id === id) || null; }

const PRE_DEAL_STAGES = ['初步接触', '已报价'];
const ORDER_FLOW = ['已下单', '生产中', '已发货', '已收款'];
/* 动态计算近 6 个月（用于趋势图）；从最新月份往前推 */
function _trendMonths() {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 5; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'));
  }
  return out;
}
const TREND_MONTHS = _trendMonths();   /* 模块加载时确定一次即可 */
const TODAY_STR = (function () {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
})();

function _orderBalance(o) { return Math.max(0, o.amount - o.paid); }
function _versionTotal(v) { return v.items.reduce((s, i) => s + i.qty * i.price, 0); }
function _quoteTotal(q) { return _versionTotal(q.versions[q.versions.length - 1]); }

function _productionPct(o) {
  if (!o.production || !o.production.steps || !o.production.steps.length) return null;
  return Math.round(o.production.steps.reduce((s, x) => s + x.pct, 0) / o.production.steps.length);
}

function _orderOverdueDays(o, today) {
  return o.paymentDue && _orderBalance(o) > 0 && _days(today, o.paymentDue) > 0
    ? _days(today, o.paymentDue) : 0;
}

/* 报价有效状态：已发送但过有效期 → 视为已过期（不改动库） */
function _effectiveQuoteStatus(q, today) {
  if (q.status === '已发送' && q.validUntil && _days(today, q.validUntil) > 0) return '已过期';
  return q.status;
}

function _customerOrders(cid) { return DB.orders.filter(o => o.customerId === cid); }
function _customerPayments(cid) { return DB.payments.filter(p => p.customerId === cid); }
function _customerQuotes(cid) { return DB.quotes.filter(q => q.customerId === cid); }
function _customerDeal(cid) { return _customerOrders(cid).reduce((s, o) => s + o.amount, 0); }
function _customerDebt(cid) { return _customerOrders(cid).reduce((s, o) => s + _orderBalance(o), 0); }

/* 客户阶段 ↔ 订单状态自动同步（流失终态不动） */
function _syncCustomerStage(cid) {
  const c = _customerById(cid);
  if (!c || c.stage === '已流失') return;
  const os = _customerOrders(cid);
  if (!os.length) return;
  const prev = c.stage;
  if (os.some(o => o.status === '已发货')) c.stage = '已发货';
  else if (os.some(o => o.status === '生产中')) c.stage = '生产中';
  else if (os.some(o => o.status === '已下单')) c.stage = '已下单';
  else if (os.every(o => o.status === '已收款')) c.stage = '已收款';
  if (c.stage !== prev) _cloudSync("customers", "upsert", c);
}

function _customerView(c) {
  const today = DB.today;
  const os = _customerOrders(c.id);
  const overdueOs = os.filter(o => _orderOverdueDays(o, today) > 0);
  return {
    ...c,
    ownerName: (_userById(c.owner) || {}).name || '',
    totalDeal: _customerDeal(c.id),
    balance: _customerDebt(c.id),
    stageIndex: DB.stages.indexOf(c.stage),
    isPreDeal: PRE_DEAL_STAGES.includes(c.stage),
    nextFollowIn: c.nextFollow ? _days(c.nextFollow, today) : null,
    daysSinceLastFollow: c.lastFollow ? _days(today, c.lastFollow) : null,
    openOrderCount: os.filter(o => o.status !== '已收款').length,
    overdueOrderCount: overdueOs.length,
    overdueAmount: overdueOs.reduce((s, o) => s + _orderBalance(o), 0),
  };
}

function _quoteView(q) {
  const today = DB.today;
  const v = q.versions[q.versions.length - 1];
  return {
    id: q.id, no: q.no, customerId: q.customerId,
    customerName: (_customerById(q.customerId) || {}).name || '',
    ownerId: q.owner, ownerName: (_userById(q.owner) || {}).name || '',
    status: _effectiveQuoteStatus(q, today),
    version: v.v, total: _versionTotal(v), itemCount: v.items.length,
    validUntil: q.validUntil,
    validInDays: q.validUntil ? _days(q.validUntil, today) : null,
    createdAt: q.createdAt, updatedAt: q.updatedAt,
    note: q.note || '',
    hasApproval: !!(q.approval && q.approval.pending),
    rejectReason: q.rejectReason || '',
    dealOrderId: q.dealOrderId || '',
  };
}

function _orderView(o) {
  const today = DB.today;
  return {
    ...o,
    customerName: (_customerById(o.customerId) || {}).name || '',
    ownerName: (_userById(o.owner) || {}).name || '',
    balance: _orderBalance(o),
    overdueDays: _orderOverdueDays(o, today),
    dueInDays: o.dueDate ? _days(o.dueDate, today) : null,
    productionPct: _productionPct(o),
    fileCount: (o.files || []).length,
  };
}

function _monthEnd(m) {
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(y, mo, 0).getDate();
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(last).padStart(2, '0');
}

function _nextOrderNo() {
  const max = DB.orders.reduce((m, o) => Math.max(m, parseInt(o.no.slice(7), 10) || 0), 0);
  return 'SO2026-' + String(max + 1).padStart(3, '0');
}

/* ============================================================
   基础元数据
   ============================================================ */
// TODO: replace with fetch('GET /api/meta')
async function fetchMeta() {
  await delay(120);
  const industries = [...new Set(DB.customers.map(c => c.industry))].sort();
  return {
    code: 0,
    data: {
      today: DB.today,
      company: DB.meta.company,
      stages: DB.stages,
      preDealStages: PRE_DEAL_STAGES,
      industries,
      products: DB.products,
      users: DB.users,
      plannedModules: DB.plannedModules,
    },
  };
}

/* ============================================================
   工作台汇总
   // TODO: replace with fetch('GET /api/dashboard')
   ============================================================ */
async function fetchDashboardSummary() {
  await delay(420);
  const today = DB.today;
  const month = today.slice(0, 7);           // 2026-09
  const prevMonth = TREND_MONTHS[TREND_MONTHS.indexOf(month) - 1] || '2026-08';

  const monthOrders = DB.orders.filter(o => _monthOf(o.orderDate) === month);
  const prevOrders = DB.orders.filter(o => _monthOf(o.orderDate) === prevMonth);
  const monthDealAmount = monthOrders.reduce((s, o) => s + o.amount, 0);
  const prevDealAmount = prevOrders.reduce((s, o) => s + o.amount, 0);
  const monthPayments = DB.payments.filter(p => _monthOf(p.date) === month);
  const monthPayment = monthPayments.reduce((s, p) => s + p.amount, 0);
  const newCustomers = DB.customers.filter(c => _monthOf(c.createdAt) === month);
  const openOrders = DB.orders.filter(o => o.status !== '已收款');

  /* 近 6 个月趋势（成交 / 回款） */
  const trend = {
    labels: TREND_MONTHS.map(m => m.slice(5) + '月'),
    deal: TREND_MONTHS.map(m => DB.orders.filter(o => _monthOf(o.orderDate) === m).reduce((s, o) => s + o.amount, 0)),
    payment: TREND_MONTHS.map(m => DB.payments.filter(p => _monthOf(p.date) === m).reduce((s, p) => s + p.amount, 0)),
  };

  /* KPI 迷你趋势（应收 = 月末订单额累计 − 回款累计） */
  const spark = {
    deal: trend.deal,
    payment: trend.payment,
    orders: TREND_MONTHS.map(m => DB.orders.filter(o => _monthOf(o.orderDate) === m).length),
    newCust: TREND_MONTHS.map(m => DB.customers.filter(c => _monthOf(c.createdAt) === m).length),
    receivable: TREND_MONTHS.map(m => {
      const end = m === month ? today : _monthEnd(m);
      const dealCum = DB.orders.filter(o => o.orderDate <= end).reduce((s, o) => s + o.amount, 0);
      const payCum = DB.payments.filter(p => p.date <= end).reduce((s, p) => s + p.amount, 0);
      return Math.max(0, dealCum - payCum);
    }),
  };

  /* 业务员业绩（本月下单口径）+ 个人视角数据 */
  const sales = DB.users.filter(u => ['业务员', '内勤', '跟单'].includes(u.position));
  const ranking = sales.map(u => {
    const os = monthOrders.filter(o => o.owner === u.id);
    return { userId: u.id, name: u.name, initial: u.initial, amount: os.reduce((s, o) => s + o.amount, 0), orderCount: os.length };
  }).sort((a, b) => b.amount - a.amount);

  const monthPaymentByOwner = {};
  monthPayments.forEach(p => {
    const c = _customerById(p.customerId);
    if (c) monthPaymentByOwner[c.owner] = (monthPaymentByOwner[c.owner] || 0) + p.amount;
  });
  const ownerStats = {};
  sales.forEach(u => {
    const myOrders = monthOrders.filter(o => o.owner === u.id);
    const myOpen = openOrders.filter(o => o.owner === u.id);
    ownerStats[u.id] = {
      monthDealAmount: myOrders.reduce((s, o) => s + o.amount, 0),
      monthOrderCount: myOrders.length,
      newCustomerCount: newCustomers.filter(c => c.owner === u.id).length,
      receivableTotal: myOpen.reduce((s, o) => s + _orderBalance(o), 0),
      receivableCount: myOpen.filter(o => _orderBalance(o) > 0).length,
      monthPayment: monthPaymentByOwner[u.id] || 0,
      activeCustomerCount: DB.customers.filter(c => c.owner === u.id && c.stage !== '已流失').length,
    };
  });

  /* 订单阶段分布 */
  const stageDist = ORDER_FLOW.map(st => ({ stage: st, count: DB.orders.filter(o => o.status === st).length }));

  /* 待跟进（7 天内） */
  const dueFollows = DB.customers
    .filter(c => c.nextFollow && _days(c.nextFollow, today) <= 7)
    .sort((a, b) => a.nextFollow.localeCompare(b.nextFollow))
    .slice(0, 6)
    .map(c => ({
      customerId: c.id, name: c.name, stage: c.stage, ownerId: c.owner,
      ownerName: (_userById(c.owner) || {}).name || '',
      nextFollow: c.nextFollow, inDays: _days(c.nextFollow, today),
      lastFollow: c.lastFollow, overdue: c.lastFollow ? _days(today, c.lastFollow) > 14 : false,
    }));

  /* 超期未跟进（>14 天且未结案） */
  const overdueFollows = DB.customers
    .filter(c => c.lastFollow && _days(today, c.lastFollow) > 14 && !['已收款', '已流失'].includes(c.stage))
    .map(c => ({
      customerId: c.id, name: c.name, stage: c.stage, ownerId: c.owner,
      ownerName: (_userById(c.owner) || {}).name || '',
      daysSinceLast: _days(today, c.lastFollow), lastFollow: c.lastFollow,
    }))
    .sort((a, b) => b.daysSinceLast - a.daysSinceLast);

  /* 应收明细（前 6） */
  const receivables = openOrders
    .filter(o => _orderBalance(o) > 0)
    .map(o => {
      const c = _customerById(o.customerId) || {};
      return {
        orderId: o.id, no: o.no, customerId: o.customerId, name: c.name || '',
        ownerId: o.owner, ownerName: (_userById(o.owner) || {}).name || '',
        balance: _orderBalance(o), amount: o.amount,
        overdueDays: _orderOverdueDays(o, today), paymentDue: o.paymentDue || '',
        status: o.status,
      };
    })
    .sort((a, b) => b.overdueDays - a.overdueDays || b.balance - a.balance);

  /* 提醒分类计数 */
  const pending = DB.reminders.filter(r => r.status === 'pending');
  const reminderCounts = {
    total: pending.length,
    follow: pending.filter(r => r.type === 'follow').length,
    payment: pending.filter(r => r.type === 'payment').length,
    quote: pending.filter(r => r.type === 'quote').length,
    alert: pending.filter(r => r.type === 'alert').length,
  };

  return {
    code: 0,
    data: {
      today,
      kpis: {
        monthDealAmount,
        monthDealDeltaPct: prevDealAmount ? Math.round((monthDealAmount - prevDealAmount) / prevDealAmount * 1000) / 10 : 0,
        monthOrderCount: monthOrders.length,
        newCustomerCount: newCustomers.length,
        receivableTotal: openOrders.reduce((s, o) => s + _orderBalance(o), 0),
        receivableCount: openOrders.filter(o => _orderBalance(o) > 0).length,
        overdueTotal: receivables.filter(r => r.overdueDays > 0).reduce((s, r) => s + r.balance, 0),
        overdueCount: receivables.filter(r => r.overdueDays > 0).length,
        monthPayment,
      },
      spark,
      trend,
      ranking,
      ownerStats,
      stageDist,
      dueFollows,
      overdueFollows,
      receivables: receivables.slice(0, 6),
      reminderCounts,
    },
  };
}

/* ============================================================
   客户
   ============================================================ */

// TODO: replace with fetch('GET /api/customers?keyword=&industry=&stage=&owner=')
async function fetchCustomers(filters) {
  await delay(360);
  const f = filters || {};
  let list = DB.customers.slice();
  if (f.keyword) {
    const k = f.keyword.trim();
    const kDigits = k.replace(/\s/g, '');
    list = list.filter(c =>
      c.name.includes(k) || c.contact.includes(k) ||
      (c.phone || '').replace(/\s/g, '').includes(kDigits));
  }
  if (f.industry) list = list.filter(c => c.industry === f.industry);
  if (f.stage) list = list.filter(c => c.stage === f.stage);
  if (f.owner) list = list.filter(c => c.owner === f.owner);
  if (f.excludeLost) list = list.filter(c => c.stage !== '已流失');
  list.forEach(c => _syncCustomerStage(c.id));
  return { code: 0, data: list.map(_customerView) };
}

// TODO: replace with fetch('GET /api/customers/:id/detail')
async function fetchCustomerDetail(id) {
  await delay(320);
  const c = _customerById(id);
  if (!c) return { code: 1, msg: '客户不存在' };
  _syncCustomerStage(id);
  return {
    code: 0,
    data: {
      customer: _customerView(c),
      stageProgress: { full: DB.stages, index: DB.stages.indexOf(c.stage), preDeal: PRE_DEAL_STAGES },
      quotes: _customerQuotes(id).map(_quoteView).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      orders: _customerOrders(id).map(_orderView).sort((a, b) => String(b.orderDate || '').localeCompare(String(a.orderDate || ''))),
      payments: _customerPayments(id)
        .map(p => ({ ...p, orderNo: (_orderById(p.orderId) || { no: '—' }).no }))
        .sort((a, b) => b.date.localeCompare(a.date)),
      followups: DB.followups.filter(f => f.customerId === id)
        .map(f => ({ ...f, userName: (_userById(f.userId) || {}).name || '' }))
        .sort((a, b) => b.date.localeCompare(a.date)),
    },
  };
}

// TODO: replace with fetch('POST /api/customers', payload)
async function saveCustomer(payload) {
  await delay(500);
  if (!payload.name || !payload.name.trim()) return { code: 1, msg: '请填写公司名称' };
  const quick = payload.quick === true;   /* 快捷建档（报价时打字创建）：联系人/电话留待补充 */
  if (!quick) {
    if (!payload.contact || !payload.contact.trim()) return { code: 1, msg: '请填写联系人' };
    if (!payload.phone || !payload.phone.trim()) return { code: 1, msg: '请填写联系电话' };
  }
  const existed = DB.customers.find(c => c.name === payload.name.trim());
  if (existed) {
    if (quick) return { code: 0, data: _customerView(existed), existed: true };
    return { code: 1, msg: '已有同名客户，请勿重复建档' };
  }
  const c = {
    id: _uid(),
    name: payload.name.trim(), contact: (payload.contact || '').trim() || (quick ? '待补充' : ''), phone: (payload.phone || '').trim() || (quick ? '待补充' : ''),
    address: payload.address || '', industry: payload.industry || '其他',
    stage: '初步接触', owner: payload.owner || 'u2',
    nextFollow: payload.nextFollow || '', lastFollow: '',
    followCount: 0, visitCount: 0, createdAt: DB.today,
    note: payload.note || '',
  };
  DB.customers.unshift(c);
  _cloudSync("customers", "upsert", c);
  return { code: 0, data: _customerView(c) };
}

// TODO: replace with fetch('POST /api/followups', payload)
async function addFollowup(payload) {
  await delay(460);
  if (!payload.content || !payload.content.trim()) return { code: 1, msg: '请填写跟进内容' };
  const f = {
    id: _uid(), customerId: payload.customerId,
    userId: payload.userId || 'u2', date: payload.date || DB.today,
    type: payload.type || '电话', content: payload.content.trim(),
    next: payload.next || '',
  };
  DB.followups.push(f);
  const c = _customerById(payload.customerId);
  if (c) {
    c.lastFollow = f.date;
    if (c.followCount != null) c.followCount += 1;
    if (f.type === '拜访' && c.visitCount != null) c.visitCount += 1;
    if (payload.nextDate) c.nextFollow = payload.nextDate;
    else if (f.next) c.nextFollow = '';
  }
  return { code: 0, data: { ...f, userName: (_userById(f.userId) || {}).name || '' } };
}

/* 商机阶段手动推进（仅商机 5 段内） */
// TODO: replace with fetch('POST /api/customers/:id/advance-stage')
async function advanceCustomerStage(id) {
  await delay(420);
  const c = _customerById(id);
  if (!c) return { code: 1, msg: '客户不存在' };
  const i = PRE_DEAL_STAGES.indexOf(c.stage);
  if (i < 0) {
    return { code: 1, msg: c.stage === '已流失'
      ? '客户已流失，请先「重新激活」'
      : '「' + c.stage + '」由订单自动推进，无需手动操作' };
  }
  if (i === PRE_DEAL_STAGES.length - 1) {
    return { code: 1, msg: '「已报价」之后的阶段由「报价成交」自动生成订单后推进' };
  }
  c.stage = PRE_DEAL_STAGES[i + 1];
  _cloudSync("customers", "upsert", c);
  return { code: 0, data: _customerView(c) };
}

/* 标记流失（必须记录丢单原因，调研表明确要求） */
// TODO: replace with fetch('POST /api/customers/:id/lost')
async function markCustomerLost(id, reason) {
  await delay(460);
  const c = _customerById(id);
  if (!c) return { code: 1, msg: '客户不存在' };
  if (!reason || !reason.trim() || reason.trim().length < 4) {
    return { code: 1, msg: '请填写丢单原因（至少 4 个字），便于复盘' };
  }
  if (c.stage === '已流失') return { code: 1, msg: '该客户已是流失状态' };
  c.stage = '已流失';
  c.lostReason = reason.trim();
  c.nextFollow = '';
  _cloudSync("customers", "upsert", c);
  return { code: 0, data: _customerView(c) };
}

/* 重新激活流失客户 */
// TODO: replace with fetch('POST /api/customers/:id/reactivate')
async function reactivateCustomer(id) {
  await delay(420);
  const c = _customerById(id);
  if (!c) return { code: 1, msg: '客户不存在' };
  if (c.stage !== '已流失') return { code: 1, msg: '该客户不是流失状态' };
  c.stage = '已报价';
  _syncCustomerStage(id);
  const d = new Date(DB.today + 'T00:00:00');
  d.setDate(d.getDate() + 3);
  c.nextFollow = d.toISOString().slice(0, 10);
  _cloudSync("customers", "upsert", c);
  return { code: 0, data: _customerView(c) };
}

/* ============================================================
   报价
   ============================================================ */

// TODO: replace with fetch('GET /api/quotes?status=&keyword=&owner=')
async function fetchQuotes(filters) {
  await delay(380);
  const f = filters || {};
  let list = DB.quotes.slice();
  if (f.status) list = list.filter(q => _effectiveQuoteStatus(q, DB.today) === f.status);
  if (f.owner) list = list.filter(q => q.owner === f.owner);
  if (f.keyword) {
    const k = f.keyword.trim();
    list = list.filter(q => q.no.includes(k) || (_customerById(q.customerId) || {}).name.includes(k));
  }
  return { code: 0, data: list.map(_quoteView).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
}

// TODO: replace with fetch('GET /api/quotes/:id')
async function fetchQuoteDetail(id) {
  await delay(320);
  const q = _quoteById(id);
  if (!q) return { code: 1, msg: '报价单不存在' };
  const versions = q.versions.map(v => ({ v: v.v, date: v.date, note: v.note, total: _versionTotal(v), items: v.items }));
  const last = versions[versions.length - 1];
  const prev = versions.length > 1 ? versions[versions.length - 2] : null;
  return {
    code: 0,
    data: {
      ..._quoteView(q),
      customer: _customerById(q.customerId) || {},
      versions,
      delta: prev ? { amount: last.total - prev.total, pct: Math.round((last.total - prev.total) / prev.total * 1000) / 10 } : null,
      approval: q.approval || null,
    },
  };
}

// TODO: replace with fetch('POST /api/quotes', payload)
async function saveQuote(payload) {
  await delay(560);
  if (!payload.customerId) return { code: 1, msg: '请选择客户' };
  const items = (payload.items || []).filter(i => i.name && i.name.trim() && i.qty > 0);
  if (!items.length) return { code: 1, msg: '请至少添加一行有效产品' };
  const maxNo = DB.quotes.reduce((m, q) => Math.max(m, parseInt((q.no || '').slice(6), 10) || 0), 0);
  const seq = String(maxNo + 1).padStart(3, '0');
  const q = {
    id: _uid(), no: 'Q2026-' + seq, customerId: payload.customerId,
    owner: payload.owner || 'u2', status: '草稿',
    validUntil: payload.validUntil || '', createdAt: DB.today, updatedAt: DB.today,
    note: payload.note || '',
    versions: [{ v: 1, date: DB.today, note: payload.note || '新建报价', items }],
  };
  DB.quotes.unshift(q);
  const c = _customerById(payload.customerId);
  if (c && PRE_DEAL_STAGES.indexOf(c.stage) >= 0 && PRE_DEAL_STAGES.indexOf(c.stage) < 2) c.stage = '已报价';
  _cloudSync("quotes", "upsert", q);
  _cloudSync("quotes", "upsert", q);
  return { code: 0, data: _quoteView(q) };
}

/* 调整报价 = 追加新版本；已发送/已成交的单改价需重新走审批 */
// TODO: replace with fetch('POST /api/quotes/:id/versions')
async function createQuoteVersion(id, payload) {
  await delay(520);
  const q = _quoteById(id);
  if (!q) return { code: 1, msg: '报价单不存在' };
  if (q.approval && q.approval.pending) return { code: 1, msg: '该报价待审批，请等老板处理后再调整' };
  const items = (payload.items || []).filter(i => i.name && i.name.trim() && i.qty > 0);
  if (!items.length) return { code: 1, msg: '请至少添加一行有效产品' };
  const prev = q.versions[q.versions.length - 1];
  const prevTotal = _versionTotal(prev);
  const v = prev.v + 1;
  q.versions.push({ v, date: DB.today, note: payload.note || '调整报价', items });
  q.updatedAt = DB.today;
  const newTotal = _versionTotal(q.versions[q.versions.length - 1]);
  const needsApproval = ['已发送', '已成交'].includes(q.status);
  if (needsApproval) {
    const prevStatus = q.status;
    q.status = '待审批';
    q.approval = {
      pending: true, requester: q.owner, prevStatus,
      deltaPct: Math.round((newTotal - prevTotal) / prevTotal * 1000) / 10,
    };
  }
  _cloudSync("quotes", "upsert", q);
  return { code: 0, data: { ..._quoteView(q), delta: { amount: newTotal - prevTotal, pct: Math.round((newTotal - prevTotal) / prevTotal * 1000) / 10 } } };
}

/* 提交审批（草稿/已驳回 → 待审批） */
// TODO: replace with fetch('POST /api/quotes/:id/submit')
async function submitQuote(id) {
  await delay(420);
  const q = _quoteById(id);
  if (!q) return { code: 1, msg: '报价单不存在' };
  if (!['草稿', '已驳回'].includes(q.status)) return { code: 1, msg: '当前状态不可提交审批' };
  const prevStatus = q.status;
  q.status = '待审批';
  q.approval = { pending: true, requester: q.owner, prevStatus };
  q.updatedAt = DB.today;
  _cloudSync("quotes", "upsert", q);
  return { code: 0, data: _quoteView(q) };
}

/* 删除报价（总经理）：已成交的不允许删；splice 钩子自动云同步 delete */
async function deleteQuote(id) {
  await delay(260);
  const q = _quoteById(id);
  if (!q) return { code: 1, msg: '报价单不存在' };
  if (q.dealOrderId) return { code: 1, msg: '该报价已成交并生成订单，不能直接删除' };
  const i = DB.quotes.findIndex(x => x.id === id);
  if (i >= 0) DB.quotes.splice(i, 1);
  return { code: 0 };
}

/* 老板审批：通过 → 已发送（默认 15 天有效期）；驳回 → 已驳回 */
// TODO: replace with fetch('POST /api/quotes/:id/approve')
async function approveQuote(id, pass, reason) {
  await delay(440);
  const q = _quoteById(id);
  if (!q) return { code: 1, msg: '报价单不存在' };
  if (!q.approval || !q.approval.pending) return { code: 1, msg: '该报价没有待处理的审批' };
  const prevStatus = q.approval.prevStatus || '草稿';
  q.approval = null;
  if (pass) {
    if (prevStatus === '已成交') {
      q.status = '已成交';
      const order = q.dealOrderId ? _orderById(q.dealOrderId) : null;
      if (order) {
        const v = q.versions[q.versions.length - 1];
        order.amount = _versionTotal(v);
        order.note = '报价 ' + q.no + ' 调价至 v' + v.v + '，订单金额已同步。';
      }
    } else {
      q.status = '已发送';
      if (!q.validUntil) {
        const d = new Date(DB.today + 'T00:00:00');
        d.setDate(d.getDate() + 15);
        q.validUntil = d.toISOString().slice(0, 10);
      }
    }
  } else {
    q.status = '已驳回';
    q.rejectReason = (reason || '').trim();
  }
  q.updatedAt = DB.today;
  _cloudSync("quotes", "upsert", q);
  _cloudSync("quotes", "upsert", q);
  return { code: 0, data: _quoteView(q) };
}

/* 标记成交：自动生成订单（调研表：报价转订单闭环） */
// TODO: replace with fetch('POST /api/quotes/:id/deal')
/* 报价备注里的 [导入文件]名称|url 标记：解析出导入源文件（展示在报价抽屉、并随成交带入订单附件） */
function _splitImportNote(note) {
  const files = []; const text = [];
  String(note || '').split('\n').forEach(l => {
    const m = l.match(/^\[导入文件\](.+)\|(.+)$/);
    if (m) files.push({ name: m[1], url: m[2], path: '', size: 0, mime: '' });
    else text.push(l);
  });
  return { text: text.join('\n'), files };
}

async function markQuoteDeal(id) {
  await delay(520);
  const q = _quoteById(id);
  if (!q) return { code: 1, msg: '报价单不存在' };
  if (_effectiveQuoteStatus(q, DB.today) !== '已发送') {
    return { code: 1, msg: '仅「已发送」的报价可标记成交（草稿请先提交审批）' };
  }
  q.status = '已成交';
  q.updatedAt = DB.today;
  let order = q.dealOrderId ? _orderById(q.dealOrderId) : null;
  if (!order) {
    const v = q.versions[q.versions.length - 1];
    const d = new Date(DB.today + 'T00:00:00');
    d.setDate(d.getDate() + 20);
    const dd = new Date(DB.today + 'T00:00:00');
    dd.setDate(dd.getDate() + 25);
    order = {
      id: _uid(), no: _nextOrderNo(), customerId: q.customerId, quoteNo: q.no,
      owner: q.owner, amount: _versionTotal(v), paid: 0, status: '已下单',
      orderDate: DB.today, paymentDue: d.toISOString().slice(0, 10),
      dueDate: dd.toISOString().slice(0, 10),
      stageDates: { ordered: DB.today }, files: _splitImportNote(q.note).files,
      note: '由报价 ' + q.no + ' 转入，按报价明细 v' + v.v + ' 执行。',
    };
    DB.orders.push(order);
    q.dealOrderId = order.id;
  }
  _syncCustomerStage(q.customerId);
  return { code: 0, data: { quote: (_cloudSync("quotes", "upsert", q), _quoteView(q)), order: _orderView(order) } };
}

// TODO: replace with fetch('POST /api/quotes/:id/void')
async function voidQuote(id) {
  await delay(360);
  const q = _quoteById(id);
  if (!q) return { code: 1, msg: '报价单不存在' };
  if (q.status === '已成交') return { code: 1, msg: '已成交报价请走订单流程作废' };
  q.status = '已作废';
  q.approval = null;
  q.updatedAt = DB.today;
  _cloudSync("quotes", "upsert", q);
  _cloudSync("quotes", "upsert", q);
  return { code: 0, data: _quoteView(q) };
}

/* ============================================================
   订单
   ============================================================ */

// TODO: replace with fetch('GET /api/orders?status=&keyword=&owner=')
async function fetchOrders(filters) {
  await delay(380);
  const f = filters || {};
  let list = DB.orders.slice();
  if (f.status) list = list.filter(o => o.status === f.status);
  if (f.owner) list = list.filter(o => o.owner === f.owner);
  if (f.keyword) {
    const k = f.keyword.trim();
    list = list.filter(o => o.no.includes(k) || (_customerById(o.customerId) || {}).name.includes(k));
  }
  list.sort((a, b) => String(b.orderDate || '').localeCompare(String(a.orderDate || '')));
  return { code: 0, data: list.map(_orderView) };
}

// TODO: replace with fetch('GET /api/orders/:id')
async function fetchOrderDetail(id) {
  await delay(320);
  const o = _orderById(id);
  if (!o) return { code: 1, msg: '订单不存在' };
  const q = DB.quotes.find(x => x.no === o.quoteNo);
  return {
    code: 0,
    data: {
      ..._orderView(o),
      customer: _customerById(o.customerId) || {},
      quoteTotal: q ? _quoteTotal(q) : null,
      payments: DB.payments.filter(p => p.orderId === id).sort((a, b) => b.date.localeCompare(a.date)),
    },
  };
}

/* 订单推进：已下单 → 生产中 → 已发货 → 已收款
   发货前校验定金比例（settings.depositPct），老板可 force 越过 */
/* 总经理/超管专属：直接修改订单（金额、状态、日期、付款进度等任何字段） */
async function adminUpdateOrder(id, patch) {
  await delay(420);
  const o = _orderById(id);
  if (!o) return { code: 1, msg: '订单不存在' };
  if (patch.amount != null) o.amount = Number(patch.amount);
  if (patch.paid != null) o.paid = Number(patch.paid);
  if (patch.status && ORDER_FLOW.includes(patch.status)) o.status = patch.status;
  if (patch.dueDate) o.dueDate = patch.dueDate;
  if (patch.paymentDue) o.paymentDue = patch.paymentDue;
  if (patch.note != null) o.note = patch.note;
  if (patch.owner) o.owner = patch.owner;
  if (patch.customerId) o.customerId = patch.customerId;
  if (patch.quoteNo) o.quoteNo = patch.quoteNo;
  if (patch.stageDates) o.stageDates = Object.assign({}, o.stageDates || {}, patch.stageDates);
  _syncCustomerStage(o.customerId);
  _cloudSync("orders", "upsert", o);
  _cloudSync("orders", "upsert", o);
  return { code: 0, data: _orderView(o) };
}

async function adminDeleteOrder(id) {
  await delay(360);
  const i = DB.orders.findIndex(o => o.id === id);
  if (i < 0) return { code: 1, msg: '订单不存在' };
  DB.orders.splice(i, 1);
  /* 同步删除关联回款 */
  for (let j = DB.payments.length - 1; j >= 0; j--) {
    if (DB.payments[j].orderId === id) DB.payments.splice(j, 1);
  }
  return { code: 0 };
}

/* 总经理专属：直接修改客户（任何字段） */
async function adminUpdateCustomer(id, patch) {
  await delay(420);
  const c = _customerById(id);
  if (!c) return { code: 1, msg: '客户不存在' };
  const ownerChanged = patch.owner && patch.owner !== c.owner;
  ['name', 'contact', 'phone', 'address', 'industry', 'owner', 'note'].forEach(k => {
    if (patch[k] != null) c[k] = patch[k];
  });
  if (patch.stage && DB.stages.includes(patch.stage)) c.stage = patch.stage;
  _cloudSync("customers", "upsert", c);
  /* 换业务员：该客户名下的报价 / 订单一并转移给新业务员（并同步云端） */
  if (ownerChanged) {
    DB.quotes.forEach(q => {
      if (q.customerId === id && q.owner !== patch.owner) { q.owner = patch.owner; _cloudSync("quotes", "upsert", q); }
    });
    DB.orders.forEach(o => {
      if (o.customerId === id && o.owner !== patch.owner) { o.owner = patch.owner; _cloudSync("orders", "upsert", o); }
    });
  }
  return { code: 0, data: _customerView(c) };
}

async function adminDeleteCustomer(id) {
  await delay(360);
  const i = DB.customers.findIndex(c => c.id === id);
  if (i < 0) return { code: 1, msg: '客户不存在' };
  DB.customers.splice(i, 1);
  return { code: 0 };
}

/* 总经理专属：直接修改报价（任何字段） */
async function adminUpdateQuote(id, patch) {
  await delay(420);
  const q = _quoteById(id);
  if (!q) return { code: 1, msg: '报价不存在' };
  if (patch.status && ['草稿', '待审批', '已发送', '已成交', '已作废', '已驳回'].includes(patch.status)) q.status = patch.status;
  if (patch.validUntil != null) q.validUntil = patch.validUntil;
  if (patch.note != null) q.note = patch.note;
  if (patch.owner) q.owner = patch.owner;
  if (patch.items) q.versions[q.versions.length - 1].items = patch.items;
  _cloudSync("quotes", "upsert", q);
  _cloudSync("quotes", "upsert", q);
  return { code: 0, data: _quoteView(q) };
}

async function adminDeleteQuote(id) {
  await delay(360);
  const i = DB.quotes.findIndex(q => q.id === id);
  if (i < 0) return { code: 1, msg: '报价不存在' };
  DB.quotes.splice(i, 1);
  return { code: 0 };
}

/* 订单推进：已下单 → 生产中 → 已发货 → 已收款
   发货前校验定金比例（settings.depositPct），老板可 force 越过 */
async function advanceOrderStage(id, opts) {
  await delay(500);
  const o = _orderById(id);
  if (!o) return { code: 1, msg: '订单不存在' };
  const i = ORDER_FLOW.indexOf(o.status);
  if (i < 0 || i >= ORDER_FLOW.length - 1) return { code: 1, msg: '已是最终阶段' };
  if (o.status === '已发货' && _orderBalance(o) > 0) {
    return { code: 1, msg: '还有尾款 ¥' + _orderBalance(o).toLocaleString() + ' 未收齐，收齐后自动结案' };
  }
  if (o.status === '生产中' && !(opts && opts.force)) {
    const pct = DB.settings.depositPct || 0;
    const need = o.amount * pct / 100;
    if (o.paid < need - 0.001) {
      return {
        code: 2, /* 2 = 需要老板确认 */
        msg: '定金未达 ' + pct + '%（已收 ¥' + o.paid.toLocaleString() + ' / 需 ¥' + Math.round(need).toLocaleString() + '），发货需老板确认',
        data: { need, paid: o.paid },
      };
    }
  }
  o.status = ORDER_FLOW[i + 1];
  const map = { '生产中': 'production', '已发货': 'ship', '已收款': 'done' };
  o.stageDates[map[o.status]] = DB.today;
  _syncCustomerStage(o.customerId);
  _cloudSync("orders", "upsert", o);
  _cloudSync("orders", "upsert", o);
  return { code: 0, data: _orderView(o) };
}

/* 生产进度看板（订单页第二视图） */
// TODO: replace with fetch('GET /api/production-kanban')
async function fetchProductionKanban() {
  await delay(380);
  const today = DB.today;
  const cols = ['已下单', '生产中', '已发货'].map(st => {
    let cards = DB.orders.filter(o => o.status === st).map(o => {
      const v = _orderView(o);
      return {
        id: v.id, no: v.no, customerName: v.customerName, ownerName: v.ownerName,
        amount: v.amount, balance: v.balance, paymentDue: v.paymentDue || '',
        orderDate: v.orderDate, overdueDays: v.overdueDays,
        productionPct: v.productionPct,
        steps: o.production ? o.production.steps : [],
        productionNo: o.production ? o.production.no : '',
        depositPending: o.paid === 0,
      };
    });
    if (st === '已下单') cards.sort((a, b) => (b.depositPending - a.depositPending) || a.paymentDue.localeCompare(b.paymentDue));
    if (st === '生产中') cards.sort((a, b) => (b.productionPct || 0) - (a.productionPct || 0));
    if (st === '已发货') cards.sort((a, b) => b.overdueDays - a.overdueDays || b.balance - a.balance);
    return { stage: st, count: cards.length, amount: cards.reduce((s, c) => s + c.amount, 0), cards };
  });
  const doneOs = DB.orders.filter(o => o.status === '已收款');
  return {
    code: 0,
    data: {
      cols,
      done: { count: doneOs.length, amount: doneOs.reduce((s, o) => s + o.amount, 0) },
    },
  };
}

/* ============================================================
   回款 / 应收
   ============================================================ */

// TODO: replace with fetch('GET /api/receivables')
async function fetchReceivables() {
  await delay(400);
  const today = DB.today;
  const rows = DB.orders
    .filter(o => _orderBalance(o) > 0)
    .map(o => {
      const c = _customerById(o.customerId) || {};
      const pays = DB.payments.filter(p => p.orderId === o.id);
      return {
        orderId: o.id, no: o.no, customerId: o.customerId, customerName: c.name || '',
        ownerId: o.owner, ownerName: (_userById(o.owner) || {}).name || '',
        amount: o.amount, paid: o.paid, balance: _orderBalance(o),
        orderDate: o.orderDate, paymentDue: o.paymentDue || '',
        overdueDays: _orderOverdueDays(o, today),
        lastPayDate: pays.length ? pays[pays.length - 1].date : '',
        status: o.status, productionPct: _productionPct(o),
      };
    })
    .sort((a, b) => b.overdueDays - a.overdueDays || b.balance - a.balance);

  const overdueTotal = rows.filter(r => r.overdueDays > 0).reduce((s, r) => s + r.balance, 0);
  const monthPayment = DB.payments.filter(p => _monthOf(p.date) === today.slice(0, 7)).reduce((s, p) => s + p.amount, 0);
  const depositPending = rows.filter(r => r.status === '已下单' && r.paid === 0).reduce((s, r) => s + r.balance, 0);

  return {
    code: 0,
    data: {
      kpis: {
        receivableTotal: rows.reduce((s, r) => s + r.balance, 0),
        receivableCount: rows.length,
        overdueTotal,
        overdueCount: rows.filter(r => r.overdueDays > 0).length,
        monthPayment,
        depositPending,
      },
      rows,
    },
  };
}

// TODO: replace with fetch('GET /api/payments?month=&keyword=')
async function fetchPayments(filters) {
  await delay(340);
  const f = filters || {};
  let list = DB.payments.slice();
  if (f.month) list = list.filter(p => _monthOf(p.date) === f.month);
  if (f.keyword) {
    const k = f.keyword.trim();
    list = list.filter(p =>
      (_customerById(p.customerId) || {}).name.includes(k) ||
      (DB.orders.find(o => o.id === p.orderId) || { no: '' }).no.includes(k));
  }
  if (f.owner) {
    list = list.filter(p => ((_customerById(p.customerId) || {}).owner || '') === f.owner);
  }
  return {
    code: 0,
    data: list.sort((a, b) => b.date.localeCompare(a.date)).map(p => ({
      ...p,
      customerName: (_customerById(p.customerId) || {}).name || '',
      orderNo: (DB.orders.find(o => o.id === p.orderId) || { no: '—' }).no,
      recorderName: (_userById(p.recorder) || {}).name || '',
    })),
  };
}

// TODO: replace with fetch('POST /api/payments', payload)
async function savePayment(payload) {
  await delay(540);
  const o = _orderById(payload.orderId);
  if (!o) return { code: 1, msg: '请选择订单' };
  const amount = Number(payload.amount);
  if (!amount || amount <= 0) return { code: 1, msg: '请填写正确的回款金额' };
  if (amount > _orderBalance(o) + 0.001) {
    return { code: 1, msg: '回款金额不能超过应收余额 ¥' + _orderBalance(o).toLocaleString() };
  }
  const p = {
    id: _uid(), date: payload.date || DB.today, orderId: o.id, customerId: o.customerId,
    type: payload.type || (o.paid === 0 ? '定金' : '尾款'),
    amount, method: payload.method || '对公转账',
    recorder: payload.recorder || 'u4', note: payload.note || '',
  };
  DB.payments.push(p);
  o.paid += amount;
  const settled = o.paid >= o.amount - 0.001;
  if (settled && o.status === '已发货') {
    o.status = '已收款';
    o.stageDates.done = p.date;
  }
  _cloudSync("orders", "upsert", o);   /* o.paid/o.status 是属性赋值，必须显式同步 */
  _syncCustomerStage(o.customerId);
  return { code: 0, data: { payment: p, settled } };
}

/* ============================================================
   提醒（四类：跟进 follow / 收款 payment / 报价到期 quote / 异常预警 alert）
   ============================================================ */

// TODO: replace with fetch('GET /api/reminders?type=&owner=')
async function fetchReminders(filters) {
  await delay(360);
  const f = filters || {};
  let list = DB.reminders.slice();
  if (f.type && f.type !== '全部') list = list.filter(r => r.type === f.type);
  if (f.owner) list = list.filter(r => r.owner === f.owner);
  const today = DB.today;
  const refName = r => {
    if (r.type === 'quote') { const q = _quoteById(r.refId); return q ? q.no : ''; }
    if (r.type === 'payment') { const o = _orderById(r.refId); return o ? o.no : ''; }
    const c = _customerById(r.refId);
    return c ? c.name : '';
  };
  return {
    code: 0,
    data: list
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map(r => ({
        ...r,
        ownerName: (_userById(r.owner) || {}).name || '',
        refName: refName(r),
        dueInDays: _days(r.dueDate, today),
      })),
  };
}

// TODO: replace with fetch('GET /api/reminders/counts')
async function markReminderRead(id, isRead) {
  await delay(260);
  const r = DB.reminders.find(x => x.id === id);
  if (!r) return { code: 1, msg: '提醒不存在' };
  r.isRead = isRead !== false;
  try { _cloudSync('reminders', 'upsert', { id: r.id, type: r.type, ref_id: r.refId || r.ref_id || '', title: r.title, detail: r.detail, due_date: r.dueDate || r.due_date || null, owner: r.owner, status: r.status, is_read: r.isRead }); } catch (e) { /* ignore */ }
  return { code: 0, data: r };
}

async function fetchReminderCounts() {
  await delay(200);
  const pending = DB.reminders.filter(r => r.status === 'pending');
  const unread = pending.filter(r => r.isRead !== true).length;
  return {
    code: 0,
    data: {
      total: pending.length,
      unread,
      follow: pending.filter(r => r.type === 'follow').length,
      payment: pending.filter(r => r.type === 'payment').length,
      quote: pending.filter(r => r.type === 'quote').length,
      alert: pending.filter(r => r.type === 'alert').length,
    },
  };
}

// TODO: replace with fetch('POST /api/reminders/:id/resolve')
async function resolveReminder(id) {
  await delay(380);
  const r = DB.reminders.find(x => x.id === id);
  if (!r) return { code: 1, msg: '提醒不存在' };
  if (r.status === 'done') return { code: 1, msg: '该提醒已处理过' };
  r.status = 'done';
  _cloudSync("reminders", "upsert", r);
  return { code: 0, data: r };
}

/* ============================================================
   登录 / 会话（演示版：本地校验，密码统一 123456）
   ============================================================ */

// TODO: replace with fetch('POST /api/login')
/* scopes 为空/未配置时的兜底：总经理全量；其他岗位默认开放常用模块（避免新账号登录后什么都看不到） */
const DEFAULT_SCOPES = ['dashboard', 'customers', 'quotes', 'orders', 'payments', 'purchase', 'reminders'];
function userScopes(u) {
  if (!u) return [];
  if (u.position === '总经理') return ['*'];
  /* 总经理在设置里配置的「岗位权限」优先于单个账号的 scopes */
  const ov = DB.settings && DB.settings.positionScopes ? DB.settings.positionScopes[u.position] : null;
  if (Array.isArray(ov) && ov.length) return ov.slice();
  return (Array.isArray(u.scopes) && u.scopes.length) ? u.scopes : DEFAULT_SCOPES;
}
async function login(userId, pwd) {
  await delay(600);
  /* 云模式：直接从云端 users 表校验（确保新增账号能登） */
  if (App.dbMode && App.dbMode() === 'cloud' && App.dbList) {
    const list = await App.dbList('users');
    if (list && list.length) {
      const u = list.find(x => x.id === userId || x.user_name === userId || x.userName === userId);
      if (!u) return { code: 1, msg: '账号不存在（云端共 ' + list.length + ' 个账号）' };
      if (u.active === false) return { code: 1, msg: '该账号已停用，请联系总经理' };
      if ((u.pwd || '123456') !== pwd) return { code: 1, msg: '密码不正确' };
      const s = { userId: u.id, name: u.name, position: u.position, initial: u.initial, loginAt: DB.today, userName: (u.user_name || u.userName), scopes: userScopes(u), active: u.active };
      localStorage.setItem('lh-crm-session', JSON.stringify(s));
      return { code: 0, data: s };
    }
  }
  /* 本地模式 — 但如果 db.js 已加载 supabase-js，硬编码默认凭证走云端（让员工首次就能登） */
  if (App.dbList && App.saveCfg) {
    try {
      let cfg = App.getCfg ? App.getCfg() : null;
      if (!cfg || !cfg.SUPABASE_URL) {
        /* 用 hardcoded 默认凭证 */
        App.saveCfg({ SUPABASE_URL: 'https://ddqrpofltnlerjodewxm.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_pjMAv7pz5IELDihL5mQ9Qg_F0Y5ulMd' });
        cfg = App.getCfg();
      }
      if (cfg && cfg.SUPABASE_URL) {
        const list = await App.dbList('users');
        if (list && list.length) {
          const u = list.find(x => x.id === userId || x.user_name === userId || x.userName === userId);
          if (!u) return { code: 1, msg: '账号不存在（云端共 ' + list.length + ' 个账号）' };
          if (u.active === false) return { code: 1, msg: '该账号已停用' };
          if ((u.pwd || '123456') !== pwd) return { code: 1, msg: '密码不正确' };
          const s = { userId: u.id, name: u.name, position: u.position, initial: u.initial, loginAt: DB.today, userName: (u.user_name || u.userName), scopes: userScopes(u), active: u.active };
          localStorage.setItem('lh-crm-session', JSON.stringify(s));
          return { code: 0, data: s };
        }
      }
    } catch (e) { /* fall through to local */ }
  }
  /* 真·本地模式（仅 1 个 admin 账号） */
  const u = DB.users.find(x => x.id === userId || x.userName === userId);
  if (!u) return { code: 1, msg: '账号不存在' };
  if ((u.pwd || '123456') !== pwd) return { code: 1, msg: '密码不正确（演示密码 123456）' };
  if (u.active === false) return { code: 1, msg: '该账号已停用，请联系总经理' };
  const s = { userId: u.id, name: u.name, position: u.position, initial: u.initial, loginAt: DB.today, userName: u.userName, scopes: userScopes(u), active: u.active };
  localStorage.setItem('lh-crm-session', JSON.stringify(s));
  return { code: 0, data: s };
}

function logout() {
  localStorage.removeItem('lh-crm-session');
}

function fetchSession() {
  try {
    const s = JSON.parse(localStorage.getItem('lh-crm-session') || 'null');
    if (!s) return null;
    if (s.active === false) { localStorage.removeItem('lh-crm-session'); return null; }
    /* 云模式：会话在登录时已按云端校验过；页面刚加载时 DB.users 还是空壳（云端数据未拉回），
       此时用本地 users 表判活会把非 admin 的会话误删（表现为登录后闪退回登录页） */
    if (App.dbMode && App.dbMode() === 'cloud' && typeof App.dbList === 'function') return s;
    if (_userById(s.userId)) return s;
  } catch (e) { /* ignore */ }
  localStorage.removeItem('lh-crm-session');
  return null;
}

/* ============================================================
   系统设置（老板专属）
   ============================================================ */

// TODO: replace with fetch('GET/PUT /api/settings')
async function fetchSettings() {
  await delay(240);
  return { code: 0, data: { ...DB.settings, users: DB.users.map(u => ({ ...u, pwd: undefined })) } };
}

async function saveSettings(patch) {
  await delay(460);
  if (patch.depositPct != null) {
    const pct = Number(patch.depositPct);
    if (!(pct >= 0 && pct <= 100)) return { code: 1, msg: '定金比例需在 0~100 之间' };
    DB.settings.depositPct = Math.round(pct);
  }
  if (patch.followupGrant != null && Array.isArray(patch.followupGrant)) {
    DB.settings.followupGrant = patch.followupGrant.filter(id => _userById(id));
  }
  if (patch.positionScopes != null && typeof patch.positionScopes === 'object') {
    const KEYS = ['dashboard', 'customers', 'quotes', 'orders', 'payments', 'purchase', 'finance', 'reminders', 'payroll'];
    const clean = {};
    Object.keys(patch.positionScopes).forEach(pos => {
      if (!Array.isArray(patch.positionScopes[pos])) return;
      clean[pos] = patch.positionScopes[pos].filter(k => KEYS.includes(k));
    });
    DB.settings.positionScopes = clean;
  }
  /* settings 单行同步云端（position_scopes 列需已执行 ALTER SQL；未执行时同步失败静默，不影响本地） */
  try { _cloudSync('settings', 'upsert', { id: 1, depositPct: DB.settings.depositPct, positionScopes: DB.settings.positionScopes }); } catch (e) { /* ignore */ }
  return { code: 0, data: { ...DB.settings } };
}

/* 待审批汇总（总经理首页徽标/提醒用） */
async function fetchPendingApprovals() {
  await delay(200);
  return {
    code: 0,
    data: {
      quotes: DB.quotes.filter(q => q.status === '待审批').map(q => ({
        id: q.id, no: q.no, owner: (_userById(q.owner) || {}).name || '', createdAt: q.createdAt || q.created_at || '',
      })),
      purchases: DB.purchases.filter(x => x.status === '待审批').map(x => ({
        id: x.id, no: x.no, title: x.title, requester: (_userById(x.requester) || {}).name || '', createdAt: x.createdAt || x.created_at || '',
      })),
    },
  };
}

/* ============================================================
   采购（申请 → 老板审批 → 财务付款 → 入库）
   ============================================================ */

const PURCHASE_FLOW = ['待审批', '已审批', '已付款', '已入库'];

function _purchaseTotal(p) { return p.items.reduce((s, i) => s + i.qty * i.price, 0); }

function _purchaseView(p) {
  return {
    ...p,
    supplierName: (DB.suppliers.find(s => s.id === p.supplierId) || {}).name || '',
    requesterName: (_userById(p.requester) || {}).name || '',
    amount: _purchaseTotal(p),
    stageIndex: PURCHASE_FLOW.indexOf(p.status),
    orderNo: p.orderId ? ((_orderById(p.orderId) || {}).no || '') : '',
    customerName: p.orderId ? ((_customerById((_orderById(p.orderId) || {}).customerId) || {}).name || '') : '',
  };
}

// TODO: replace with fetch('GET /api/purchases?status=&keyword=')
async function fetchPurchases(filters) {
  await delay(380);
  const f = filters || {};
  let list = DB.purchases.slice();
  if (f.status) list = list.filter(p => p.status === f.status);
  if (f.keyword) {
    const k = f.keyword.trim();
    list = list.filter(p => p.no.includes(k) || p.title.includes(k) ||
      (DB.suppliers.find(s => s.id === p.supplierId) || { name: '' }).name.includes(k));
  }
  return { code: 0, data: list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(_purchaseView) };
}

// TODO: replace with fetch('POST /api/purchases', payload)
async function savePurchase(payload) {
  await delay(540);
  if (!payload.title || !payload.title.trim()) return { code: 1, msg: '请填写采购标题' };
  if (!payload.supplierId) return { code: 1, msg: '请选择供应商' };
  const items = (payload.items || []).filter(i => i.name && i.qty > 0);
  if (!items.length) return { code: 1, msg: '请至少添加一行采购明细' };
  const max = DB.purchases.reduce((m, p) => Math.max(m, parseInt(p.no.slice(7), 10) || 0), 0);
  const p = {
    id: _uid(), no: 'PO2026-' + String(max + 1).padStart(3, '0'),
    title: payload.title.trim(), supplierId: payload.supplierId, orderId: payload.orderId || '',
    requester: payload.requester || 'u1', status: '待审批', createdAt: DB.today,
    approveDate: '', payDate: '', receiveDate: '', note: payload.note || '',
    items: items.map(i => ({ name: i.name, spec: i.spec || '', unit: i.unit || '件', qty: Number(i.qty), price: Number(i.price) || 0 })),
  };
  /* 总经理发起的采购无需自审批，直接进入「已审批」 */
  if (App.isBoss && App.isBoss()) {
    p.status = '已审批';
    p.approveDate = DB.today;
  }
  DB.purchases.unshift(p);
  return { code: 0, data: _purchaseView(p) };
}

/* 采购推进：approve（老板）/ pay（财务、老板）/ receive */
// TODO: replace with fetch('POST /api/purchases/:id/advance')
async function advancePurchase(id, step) {
  await delay(460);
  const p = DB.purchases.find(x => x.id === id);
  if (!p) return { code: 1, msg: '采购单不存在' };
  const next = { approve: '已审批', pay: '已付款', receive: '已入库' }[step];
  if (!next) return { code: 1, msg: '未知操作' };
  const i = PURCHASE_FLOW.indexOf(p.status);
  if (PURCHASE_FLOW.indexOf(next) !== i + 1) {
    return { code: 1, msg: '当前「' + p.status + '」，不能直接变为「' + next + '」' };
  }
  p.status = next;
  if (step === 'approve') p.approveDate = DB.today;
  if (step === 'pay') p.payDate = DB.today;
  if (step === 'receive') p.receiveDate = DB.today;
  _cloudSync("purchases", "upsert", p);
  return { code: 0, data: _purchaseView(p) };
}

/* 驳回采购申请（老板）：需填原因；驳回后申请人可改后重新提交，总经理亦可直接编辑 */
async function rejectPurchase(id, reason) {
  await delay(420);
  const p = DB.purchases.find(x => x.id === id);
  if (!p) return { code: 1, msg: '采购单不存在' };
  if (p.status !== '待审批') return { code: 1, msg: '仅「待审批」的采购可以驳回' };
  if (!reason || !reason.trim() || reason.trim().length < 4) return { code: 1, msg: '请填写驳回原因（至少 4 个字）' };
  p.status = '已驳回';
  p.rejectReason = reason.trim();
  _cloudSync("purchases", "upsert", p);
  return { code: 0, data: _purchaseView(p) };
}

/* 总经理：编辑采购单（任意字段 + 明细） */
async function adminUpdatePurchase(id, patch) {
  await delay(460);
  const p = DB.purchases.find(x => x.id === id);
  if (!p) return { code: 1, msg: '采购单不存在' };
  if (patch.title != null && patch.title.trim()) p.title = patch.title.trim();
  if (patch.supplierId) p.supplierId = patch.supplierId;
  if (patch.orderId != null) p.orderId = patch.orderId;
  if (patch.note != null) p.note = patch.note;
  if (patch.status && ['待审批', '已审批', '已付款', '已入库', '已驳回'].includes(patch.status)) {
    p.status = patch.status;
    if (patch.status === '已审批' && !p.approveDate) p.approveDate = DB.today;
    if (patch.status === '已付款' && !p.payDate) p.payDate = DB.today;
    if (patch.status === '已入库' && !p.receiveDate) p.receiveDate = DB.today;
  }
  if (Array.isArray(patch.items) && patch.items.length) {
    p.items = patch.items.filter(i => i.name && i.qty > 0)
      .map(i => ({ name: i.name, spec: i.spec || '', unit: i.unit || '件', qty: Number(i.qty), price: Number(i.price) || 0 }));
  }
  _cloudSync("purchases", "upsert", p);
  return { code: 0, data: _purchaseView(p) };
}

/* 总经理：删除采购单（已付款的会同时影响记账支出，UI 二次确认提示） */
async function adminDeletePurchase(id) {
  await delay(380);
  const i = DB.purchases.findIndex(x => x.id === id);
  if (i < 0) return { code: 1, msg: '采购单不存在' };
  DB.purchases.splice(i, 1);
  return { code: 0 };
}

/* 总经理：修改回款记录（订单已收金额自动重算） */
async function updatePayment(id, patch) {
  await delay(420);
  const p = DB.payments.find(x => x.id === id);
  if (!p) return { code: 1, msg: '回款记录不存在' };
  const amount = Number(patch.amount);
  if (!amount || amount <= 0) return { code: 1, msg: '请填写正确的金额' };
  if (patch.date) p.date = patch.date;
  if (patch.type) p.type = patch.type;
  if (patch.method) p.method = patch.method;
  if (patch.note != null) p.note = patch.note;
  p.amount = amount;
  const o = _orderById(p.orderId);
  if (o) {
    o.paid = DB.payments.filter(x => x.orderId === o.id).reduce((s, x) => s + x.amount, 0);
    const settled = o.paid >= o.amount - 0.001;
    if (settled && o.status === '已发货') { o.status = '已收款'; if (!o.stageDates) o.stageDates = {}; o.stageDates.done = p.date; }
    else if (!settled && o.status === '已收款') { o.status = '已发货'; if (o.stageDates) delete o.stageDates.done; }
    _cloudSync("orders", "upsert", o);
  }
  _cloudSync("payments", "upsert", p);
  return { code: 0, data: p };
}

/* 总经理：删除回款记录（订单已收金额自动重算） */
async function deletePayment(id) {
  await delay(380);
  const p = DB.payments.find(x => x.id === id);
  if (!p) return { code: 1, msg: '回款记录不存在' };
  const i = DB.payments.findIndex(x => x.id === id);
  if (i >= 0) DB.payments.splice(i, 1);
  const o = _orderById(p.orderId);
  if (o) {
    o.paid = DB.payments.filter(x => x.orderId === o.id).reduce((s, x) => s + x.amount, 0);
    const settled = o.paid >= o.amount - 0.001;
    if (!settled && o.status === '已收款') { o.status = '已发货'; if (o.stageDates) delete o.stageDates.done; }
    _cloudSync("orders", "upsert", o);
  }
  return { code: 0 };
}

/* ============================================================
   财务记账（收入自动来自回款流水；支出 = 采购付款 + 手工账）
   ============================================================ */

// TODO: replace with fetch('GET /api/finance/ledgers?month=&type=&category=')
async function fetchLedgers(filters) {
  await delay(380);
  const f = filters || {};
  /* 收入行：由回款流水派生，不重复落库 */
  const income = DB.payments.map(p => ({
    id: 'in-' + p.id, date: p.date, type: '收入', category: '回款',
    amount: p.amount, recorder: p.recorder,
    refNo: (DB.orders.find(o => o.id === p.orderId) || { no: '' }).no,
    customerName: (_customerById(p.customerId) || {}).name || '',
    note: p.note || (p.type + ' · ' + (p.method || '')),
  }));
  /* 支出行：已付款采购 + 手工账 */
  const purchasePay = DB.purchases.filter(p => p.payDate).map(p => ({
    id: 'po-' + p.id, date: p.payDate, type: '支出', category: '采购',
    amount: _purchaseTotal(p), recorder: 'u4',
    refNo: p.no, customerName: '',
    note: p.title + '（' + ((DB.suppliers.find(s => s.id === p.supplierId) || {}).name || '') + '）',
  }));
  const manual = DB.manualLedgers.map(l => {
    const dec = _ledgerNoteDecode(l);
    const isPayroll = l.category === '工资' && (dec.refNo || '').indexOf('PAY-') === 0;
    return { ...l, refNo: dec.refNo, note: dec.note, customerName: '', src: isPayroll ? 'payroll' : 'manual' };
  });
  let list = income.concat(purchasePay, manual);
  if (f.month) list = list.filter(l => _monthOf(l.date) === f.month);
  if (f.type && f.type !== '全部') list = list.filter(l => l.type === f.type);
  if (f.category && f.category !== '全部') list = list.filter(l => l.category === f.category);
  list.sort((a, b) => b.date.localeCompare(a.date));
  return { code: 0, data: list };
}

// TODO: replace with fetch('GET /api/finance/summary')
async function fetchFinanceSummary() {
  await delay(420);
  const month = DB.today.slice(0, 7);
  const income = DB.payments.filter(p => _monthOf(p.date) === month).reduce((s, p) => s + p.amount, 0);
  const expensePurchase = DB.purchases.filter(p => p.payDate && _monthOf(p.payDate) === month).reduce((s, p) => s + _purchaseTotal(p), 0);
  const expenseManual = DB.manualLedgers.filter(l => _monthOf(l.date) === month).reduce((s, l) => s + l.amount, 0);
  const expense = expensePurchase + expenseManual;

  /* 近 6 个月收支 */
  const trend = TREND_MONTHS.map(m => ({
    m,
    income: DB.payments.filter(p => _monthOf(p.date) === m).reduce((s, p) => s + p.amount, 0),
    expense: DB.purchases.filter(p => p.payDate && _monthOf(p.payDate) === m).reduce((s, p) => s + _purchaseTotal(p), 0)
      + DB.manualLedgers.filter(l => _monthOf(l.date) === m).reduce((s, l) => s + l.amount, 0),
  }));

  /* 应付：已审批未付款采购 */
  const payables = DB.purchases.filter(p => ['已审批', '待审批'].includes(p.status))
    .map(_purchaseView).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  /* 应收汇总（复用口径） */
  const openOrders = DB.orders.filter(o => _orderBalance(o) > 0);

  /* 支出分类（本月） */
  const catMap = {};
  DB.purchases.filter(p => p.payDate && _monthOf(p.payDate) === month)
    .forEach(p => { catMap['采购'] = (catMap['采购'] || 0) + _purchaseTotal(p); });
  DB.manualLedgers.filter(l => _monthOf(l.date) === month)
    .forEach(l => { catMap[l.category] = (catMap[l.category] || 0) + l.amount; });

  /* 逐月支出构成（近 12 个月，含空月，供「支出构成」按月查看） */
  const catByMonth = {};
  const _touchCat = (m, cat, amt) => {
    catByMonth[m] = catByMonth[m] || {};
    catByMonth[m][cat || '其他'] = (catByMonth[m][cat || '其他'] || 0) + amt;
  };
  DB.purchases.filter(p => p.payDate).forEach(p => _touchCat(_monthOf(p.payDate), '采购', _purchaseTotal(p)));
  DB.manualLedgers.forEach(l => _touchCat(_monthOf(l.date), l.category, l.amount));
  {
    const d = new Date();
    for (let i = 0; i < 12; i++) {
      const m = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      catByMonth[m] = catByMonth[m] || {};
      d.setMonth(d.getMonth() - 1);
    }
  }

  /* 工资口径：已发放（工资流水，已计入支出）/ 应发放（草稿合计，未计入） */
  const salaryPaid = DB.manualLedgers.filter(l => l.category === '工资' && _monthOf(l.date) === month).reduce((s, l) => s + l.amount, 0);
  const salaryPending = (DB.payrolls || []).filter(x => x.month === month && x.status !== '已删除' && x.status !== '已发放').reduce((s, x) => s + (Number(x.net_pay) || 0), 0);

  return {
    code: 0,
    data: {
      month,
      kpis: {
        income, expense, net: income - expense,
        receivableTotal: openOrders.reduce((s, o) => s + _orderBalance(o), 0),
        payableTotal: payables.reduce((s, p) => s + p.amount, 0),
      },
      salaryPaid: Math.round(salaryPaid * 100) / 100,
      salaryPending: Math.round(salaryPending * 100) / 100,
      trend,
      payables,
      expenseCats: Object.keys(catMap).map(k => ({ name: k, value: catMap[k] })).sort((a, b) => b.value - a.value),
      catByMonth,
      catMonths: Object.keys(catByMonth).sort().reverse(),
    },
  };
}

// TODO: replace with fetch('POST /api/finance/ledgers')
/* 手工账的关联单号借 note 字段存储（【单号】+说明），读取时解析回 refNo —— 免改表结构 */
function _ledgerNoteEncode(refNo, note) { return refNo ? '【' + refNo.trim() + '】' + (note || '') : (note || ''); }
function _ledgerNoteDecode(l) {
  const m = (l.note || '').match(/^【([^】]*)】/);
  return { refNo: m ? m[1] : '', note: m ? l.note.slice(m[0].length) : (l.note || '') };
}

async function saveManualLedger(payload) {
  await delay(480);
  const amount = Number(payload.amount);
  if (!amount || amount <= 0) return { code: 1, msg: '请填写正确的金额' };
  if (!payload.category) return { code: 1, msg: '请选择支出科目' };
  if (!payload.date) return { code: 1, msg: '请选择日期' };
  const l = {
    id: _uid(), date: payload.date, type: '支出', category: payload.category,
    amount, recorder: payload.recorder || 'u4', note: _ledgerNoteEncode(payload.refNo, payload.note),
  };
  DB.manualLedgers.push(l);
  const dec = _ledgerNoteDecode(l);
  return { code: 0, data: { ...l, refNo: dec.refNo, note: dec.note, customerName: '' } };
}

async function updateManualLedger(id, payload) {
  await delay(420);
  const l = DB.manualLedgers.find(x => x.id === id);
  if (!l) return { code: 1, msg: '账目不存在（回款与采购付款生成的流水不可改）' };
  const amount = Number(payload.amount);
  if (!amount || amount <= 0) return { code: 1, msg: '请填写正确的金额' };
  l.date = payload.date || l.date;
  l.category = payload.category || l.category;
  l.amount = amount;
  l.note = _ledgerNoteEncode(payload.refNo, payload.note);
  _cloudSync("manualLedgers", "upsert", l);
  const dec = _ledgerNoteDecode(l);
  return { code: 0, data: { ...l, refNo: dec.refNo, note: dec.note, customerName: '' } };
}

async function deleteManualLedger(id) {
  await delay(360);
  const i = DB.manualLedgers.findIndex(x => x.id === id);
  if (i < 0) return { code: 1, msg: '账目不存在（回款与采购付款生成的流水不可删）' };
  DB.manualLedgers.splice(i, 1);
  return { code: 0 };
}

/* ============================================================
   供应商 CRUD
   ============================================================ */
async function fetchSuppliers() {
  await delay(160);
  return { code: 0, data: DB.suppliers.slice() };
}

async function saveSupplier(payload) {
  await delay(360);
  if (!payload.name || !payload.name.trim()) return { code: 1, msg: '请填写供应商名称' };
  const dup = DB.suppliers.find(s => s.name === payload.name.trim() && s.id !== payload.id);
  if (dup) return { code: 1, msg: '已有同名供应商' };
  if (payload.id) {
    const s = DB.suppliers.find(x => x.id === payload.id);
    if (!s) return { code: 1, msg: '供应商不存在' };
    s.name = payload.name.trim();
    s.contact = payload.contact || '';
    s.phone = payload.phone || '';
    s.category = payload.category || '其他';
    _cloudSync("suppliers", "upsert", s);
    return { code: 0, data: s };
  }
  const s = { id: 'sup-' + Date.now().toString(36), name: payload.name.trim(), contact: payload.contact || '', phone: payload.phone || '', category: payload.category || '其他' };
  DB.suppliers.push(s);
  return { code: 0, data: s };
}

async function deleteSupplier(id) {
  await delay(280);
  const i = DB.suppliers.findIndex(s => s.id === id);
  if (i < 0) return { code: 1, msg: '供应商不存在' };
  const inUse = DB.purchases.find(p => p.supplierId === id);
  if (inUse) return { code: 1, msg: '该供应商已被采购单使用，不能删除' };
  DB.suppliers.splice(i, 1);
  return { code: 0 };
}

/* ---------- 启动钩子：拉云端数据到 DB ---------- */
async function bootstrapFromCloud() {
  if (typeof App === 'undefined' || !App.dbInit) return;
  if (App.dbMode && App.dbMode() !== 'cloud') return;
  const r = await App.dbInit();
  if (r && r.ok) {
    _ensurePatched();
    console.log('[云同步] 启动加载成功，模式 = ' + r.mode);
  } else {
    console.warn('[云同步] 启动加载失败：' + (r && r.msg));
  }
}

/* ---------- 暴露：让 app.js 在登录后调用 ---------- */
function _attachBootstrap() {
  if (typeof App !== 'undefined' && App) { App.bootstrapFromCloud = bootstrapFromCloud; return true; }
  return false;
}
if (!_attachBootstrap()) {
  let n = 0;
  const t = setInterval(() => { if (_attachBootstrap() || ++n > 200) clearInterval(t); }, 5);
}
document.addEventListener('DOMContentLoaded', _attachBootstrap);


/* ============================================================
   工资核算（payroll）：财务 / 总经理专用
   应发 = 基本工资 + 加班费（25 元/小时 × 加班小时） + 奖金 − 其他扣款
   支持系统外员工（user_id 以 ext: 开头，姓名直接存 name 字段）
   新月份无数据时自动从最近月份结转员工与基本工资
   ============================================================ */
const PAYROLL_RULES = { OT_HOURLY: 25 };
function _payrollNet(r) {
  /* 工资 = 基本工资 ÷ 30 × 出勤天数 + 加班费 + 奖金/补贴 − 其他扣款 */
  const basePart = Math.round((Number(r.base_salary) || 0) / 30 * (Number(r.attend_days) || 0) * 100) / 100;
  return Math.round((basePart + (Number(r.overtime_pay) || 0) + (Number(r.bonus) || 0) - (Number(r.other_deduction) || 0)) * 100) / 100;
}

/* 工资发放 → 记账流水同步（收付实现制）：
   该月全部行已发放 → 生成/更新一笔「工资」科目支出流水（计入本月支出）；
   该月仍有草稿（或无人已发放）→ 移除该月工资流水（不计入支出）。
   流水 refNo = PAY-<月份>，只读不可改删（来源标记 payroll）。 */
function _syncPayrollLedger(month) {
  try {
    const alive = (DB.payrolls || []).filter(x => x.month === month && x.status !== '已删除');
    const paid = alive.filter(x => x.status === '已发放');
    const paidSum = Math.round(paid.reduce((s2, x) => s2 + (Number(x.net_pay) || 0), 0) * 100) / 100;
    const draftExists = alive.some(x => x.status !== '已发放');
    const refNo = 'PAY-' + month;
    const idx = DB.manualLedgers.findIndex(l => l.category === '工资' && _ledgerNoteDecode(l).refNo === refNo);
    if (paid.length && !draftExists && paidSum > 0) {
      const date = paid.map(x => x.pay_date).filter(Boolean).sort().pop() || DB.today;
      if (idx >= 0) {
        const l = DB.manualLedgers[idx];
        if (Number(l.amount) !== paidSum || l.date !== date) {
          l.amount = paidSum; l.date = date;
          _cloudSync('manualLedgers', 'upsert', l);
        }
      } else {
        let sess = null;
        try { sess = JSON.parse(localStorage.getItem('lh-crm-session') || 'null'); } catch (e) {}
        const l = {
          id: _uid(), date, type: '支出', category: '工资', amount: paidSum,
          recorder: (sess && sess.userId) || 'u1',
          note: _ledgerNoteEncode(refNo, '工资自动生成（' + paid.length + ' 人）'),
        };
        DB.manualLedgers.push(l);
        _cloudSync('manualLedgers', 'upsert', l);
      }
    } else if (idx >= 0) {
      const l = DB.manualLedgers[idx];
      DB.manualLedgers.splice(idx, 1);
      _cloudSync('manualLedgers', 'delete', l);
    }
  } catch (e) { console.warn('[工资流水同步]', e && e.message); }
}

async function fetchPayroll(month) {
  await delay(360);
  const _nowM = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); })();
  const allM = DB.payrolls.filter(x => x.month === month);
  let rows = allM.filter(x => x.status !== '已删除');
  /* 未来月份不自动结转（防止查看未来月份时凭空生成员工占位数据）；
     已删除的墓碑行会阻断结转——删光某月后该月保持为空，不会从更早月份复活 */
  if (!allM.length && month <= _nowM) {
    const prevMonths = [...new Set(DB.payrolls.filter(x => x.status !== '已删除').map(x => x.month))].filter(m => m < month).sort().reverse();
    if (prevMonths.length) {
      for (const p of DB.payrolls.filter(x => x.month === prevMonths[0] && x.status !== '已删除')) {
        const nr = { id: _uid(), user_id: p.user_id, name: p.name, month, base_salary: p.base_salary, attend_days: 0, overtime_hours: 0, overtime_pay: 0, bonus: p.bonus || 0, other_deduction: p.other_deduction || 0, status: '草稿', note: '' };
        nr.net_pay = _payrollNet(nr);
        DB.payrolls.push(nr);
        _cloudSync('payrolls', 'upsert', nr);
      }
      rows = DB.payrolls.filter(x => x.month === month && x.status !== '已删除');
    }
  }
  const data = rows.map(r => {
    const isExt = String(r.user_id || '').indexOf('ext:') === 0;
    const u = isExt ? {} : (_userById(r.user_id) || {});
    const nm = r.name || (isExt ? r.user_id.slice(4) : '') || u.name || '';
    return { ...r, userName: nm, position: u.position || '' };
  }).sort((a, b) => (b.net_pay || 0) - (a.net_pay || 0));
  return { code: 0, data };
}

async function savePayrollRow(payload) {
  await delay(420);
  const _nowM = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); })();
  if (payload.month && payload.month > _nowM) return { code: 1, msg: payload.month + ' 尚未开始，到达该月后才能登记工资' };
  const name = String(payload.name || '').trim();
  let user_id = payload.user_id;
  if (!user_id) user_id = name ? 'ext:' + name : '';
  if (!user_id) return { code: 1, msg: '请填写员工姓名' };
  if (!payload.month) return { code: 1, msg: '缺少月份' };
  const num = x => Math.round((Number(x) || 0) * 100) / 100;
  let r = DB.payrolls.find(x => x.user_id === user_id && x.month === payload.month);
  if (!r) { r = { id: _uid(), user_id, month: payload.month }; DB.payrolls.push(r); }
  if (name) r.name = name;
  ['base_salary', 'attend_days', 'overtime_hours', 'overtime_pay', 'bonus', 'other_deduction'].forEach(k => {
    if (payload[k] != null) r[k] = num(payload[k]);
  });
  if (payload.status) r.status = payload.status;
  if (payload.pay_date != null) r.pay_date = payload.pay_date;
  if (payload.note != null) r.note = payload.note;
  r.net_pay = _payrollNet(r);
  const _row = Object.assign({}, r); delete _row.name; delete _row.userName; delete _row.position;
  _cloudSync('payrolls', 'upsert', _row);
  _syncPayrollLedger(payload.month);   /* 发放状态变化 → 同步记账工资流水 */
  return { code: 0, data: { ...r, userName: r.name } };
}

async function importPayrollRows(items, month) {
  await delay(600);
  const _nowM = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); })();
  if (month > _nowM) return { code: 1, msg: month + ' 尚未开始，到达该月后才能导入工资' };
  const created = [], updated = [], skipped = [];
  const num = x => Math.round((Number(x) || 0) * 100) / 100;
  for (const it of items || []) {
    const name = String(it.name || '').trim();
    if (!name) continue;
    /* 兜底：模板的示例/说明行不入库（页面解析层已过滤，这里防其他路径） */
    if (/^示例|^说明|合计|平均|汇总/.test(name)) continue;
    const u = DB.users.find(x => x.name === name && x.active !== false);
    const user_id = u ? u.id : 'ext:' + name;
    let r = DB.payrolls.find(x => x.user_id === user_id && x.month === month);
    const isNew = !r;
    if (!r) { r = { id: _uid(), user_id, month }; DB.payrolls.push(r); }
    r.name = u ? u.name : name;
    r.base_salary = num(it.base_salary);
    r.attend_days = num(it.attend_days);
    r.overtime_hours = num(it.overtime_hours);
    r.overtime_pay = Math.round(num(it.overtime_hours) * PAYROLL_RULES.OT_HOURLY * 100) / 100;
    r.bonus = num(it.bonus);
    r.other_deduction = num(it.other_deduction);
    if (it.note != null) r.note = it.note;
    if (r.status !== '已发放') r.status = '草稿';
    r.net_pay = _payrollNet(r);
    const _row = Object.assign({}, r); delete _row.name; delete _row.userName; delete _row.position;
    _cloudSync('payrolls', 'upsert', _row);
    (isNew ? created : updated).push(r.name);
    if (!u) skipped.push({ name, reason: '系统外员工，已按外部人员登记' });
  }
  _syncPayrollLedger(month);
  return { code: 0, data: { created, updated, skipped } };
}

async function deletePayrollRow(id) {
  await delay(300);
  const r = DB.payrolls.find(x => x.id === id);
  if (!r) return { code: 1, msg: '记录不存在' };
  /* 软删除：保留云端墓碑行，防止"自动结转"把删掉的月份复活；显示/统计均过滤已删除。
     这样删除任意月份都独立生效，不必从最早月份开始删。 */
  r.status = '已删除';
  const _row = Object.assign({}, r); delete _row.name; delete _row.userName; delete _row.position;
  _cloudSync('payrolls', 'upsert', _row);
  _syncPayrollLedger(r.month);
  return { code: 0 };
}
