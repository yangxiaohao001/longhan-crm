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

const PRE_DEAL_STAGES = ['初步接触', '需求确认', '已报价', '打样中', '商务谈判'];
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
  if (os.some(o => o.status === '已发货')) c.stage = '已发货';
  else if (os.some(o => o.status === '生产中')) c.stage = '生产中';
  else if (os.some(o => o.status === '已下单')) c.stage = '已下单';
  else if (os.every(o => o.status === '已收款')) c.stage = '已收款';
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
      orders: _customerOrders(id).map(_orderView).sort((a, b) => b.orderDate.localeCompare(a.orderDate)),
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
  if (!payload.contact || !payload.contact.trim()) return { code: 1, msg: '请填写联系人' };
  if (!payload.phone || !payload.phone.trim()) return { code: 1, msg: '请填写联系电话' };
  if (DB.customers.some(c => c.name === payload.name.trim())) return { code: 1, msg: '已有同名客户，请勿重复建档' };
  const c = {
    id: _uid(),
    name: payload.name.trim(), contact: payload.contact.trim(), phone: payload.phone.trim(),
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
    return { code: 1, msg: '商务谈判后的阶段由「报价成交」自动推进' };
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
  c.stage = '商务谈判';
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
  const items = (payload.items || []).filter(i => i.productId && i.qty > 0);
  if (!items.length) return { code: 1, msg: '请至少添加一行有效产品' };
  const seq = String(DB.quotes.length + 94).padStart(3, '0');
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
  const items = (payload.items || []).filter(i => i.productId && i.qty > 0);
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
  _cloudSync("quotes", "upsert", q);
  return { code: 0, data: _quoteView(q) };
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
      stageDates: { ordered: DB.today }, files: [],
      note: '由报价 ' + q.no + ' 转入，按报价明细 v' + v.v + ' 执行。',
    };
    DB.orders.push(order);
    q.dealOrderId = order.id;
  }
  _syncCustomerStage(q.customerId);
  return { code: 0, data: { quote: _quoteView(q), order: _orderView(order) } };
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
  list.sort((a, b) => b.orderDate.localeCompare(a.orderDate));
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
  ['name', 'contact', 'phone', 'address', 'industry', 'owner', 'note'].forEach(k => {
    if (patch[k] != null) c[k] = patch[k];
  });
  if (patch.stage && DB.stages.includes(patch.stage)) c.stage = patch.stage;
  _cloudSync("customers", "upsert", c);
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
async function fetchReminderCounts() {
  await delay(200);
  const pending = DB.reminders.filter(r => r.status === 'pending');
  return {
    code: 0,
    data: {
      total: pending.length,
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
  return { code: 0, data: r };
}

/* ============================================================
   登录 / 会话（演示版：本地校验，密码统一 123456）
   ============================================================ */

// TODO: replace with fetch('POST /api/login')
async function login(userId, pwd) {
  await delay(600);
  const u = DB.users.find(x => x.id === userId || x.userName === userId);
  if (!u) return { code: 1, msg: '账号不存在' };
  if ((u.pwd || '123456') !== pwd) return { code: 1, msg: '密码不正确（演示密码 123456）' };
  if (u.active === false) return { code: 1, msg: '该账号已停用，请联系总经理' };
  const s = { userId: u.id, name: u.name, position: u.position, initial: u.initial, loginAt: DB.today, userName: u.userName, scopes: u.scopes, active: u.active };
  localStorage.setItem('lh-crm-session', JSON.stringify(s));
  return { code: 0, data: s };
}

function logout() {
  localStorage.removeItem('lh-crm-session');
}

function fetchSession() {
  try {
    const s = JSON.parse(localStorage.getItem('lh-crm-session') || 'null');
    if (s && _userById(s.userId)) return s;
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
  return { code: 0, data: { ...DB.settings } };
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
  return { code: 0, data: _purchaseView(p) };
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
  const manual = DB.manualLedgers.map(l => ({ ...l, refNo: '', customerName: '' }));
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

  return {
    code: 0,
    data: {
      month,
      kpis: {
        income, expense, net: income - expense,
        receivableTotal: openOrders.reduce((s, o) => s + _orderBalance(o), 0),
        payableTotal: payables.reduce((s, p) => s + p.amount, 0),
      },
      trend,
      payables,
      expenseCats: Object.keys(catMap).map(k => ({ name: k, value: catMap[k] })).sort((a, b) => b.value - a.value),
    },
  };
}

// TODO: replace with fetch('POST /api/finance/ledgers')
async function saveManualLedger(payload) {
  await delay(480);
  const amount = Number(payload.amount);
  if (!amount || amount <= 0) return { code: 1, msg: '请填写正确的金额' };
  if (!payload.category) return { code: 1, msg: '请选择支出科目' };
  if (!payload.date) return { code: 1, msg: '请选择日期' };
  const l = {
    id: _uid(), date: payload.date, type: '支出', category: payload.category,
    amount, recorder: payload.recorder || 'u4', note: payload.note || '',
  };
  DB.manualLedgers.push(l);
  return { code: 0, data: { ...l, refNo: '', customerName: '' } };
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
