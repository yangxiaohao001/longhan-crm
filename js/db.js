/* ============================================================
   db.js — 数据后端适配层（云端 / 本地 自动切换）
   设计：
   · dbMode()    : 'cloud' | 'local'
   · dbInit()     : 启动时从云端拉所有表到 window.DB（云模式）
   · dbSync(table, op, payload)  : 增/改/删 单行同步到云（云模式）
   · dbList(table) : 拉取整张表（云模式）
   · dbUpload / dbRemove : 附件（云模式走 Supabase Storage）
   ============================================================ */
'use strict';

const DB_CFG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
};
function _loadCfg() { try { Object.assign(DB_CFG, JSON.parse(localStorage.getItem('lh-crm-cfg') || '{}')); } catch (e) {} }
function _saveCfg() { localStorage.setItem('lh-crm-cfg', JSON.stringify(DB_CFG)); }
_loadCfg();

let _supa = null;
let _cacheInited = false;
function _getSupa() {
  if (_supa) return _supa;
  if (!DB_CFG.SUPABASE_URL || !DB_CFG.SUPABASE_ANON_KEY) return null;
  if (typeof supabase === 'undefined') return null;
  _supa = supabase.createClient(DB_CFG.SUPABASE_URL, DB_CFG.SUPABASE_ANON_KEY);
  return _supa;
}

function dbMode() { return _getSupa() ? 'cloud' : 'local'; }

/* 列与云端表名的对应 */
const TABLES = {
  customers: 'customers',
  quotes: 'quotes',
  orders: 'orders',
  payments: 'payments',
  followups: 'followups',
  reminders: 'reminders',
  purchases: 'purchases',
  manualLedgers: 'manual_ledgers',
  suppliers: 'suppliers',
  users: 'users',
  products: 'products',
  settings: 'settings',
  meta: 'meta',
};

/* 启动时从云拉所有表填到 window.DB；返回是否成功（云模式失败时返回 false） */
/* 字段映射：云端 snake_case → 内存 camelCase（读取时用；与 _toRow 互为逆操作） */
function _fromRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const out = {};
  for (const k of Object.keys(row)) {
    out[k.indexOf('_') < 0 ? k : k.replace(/_([a-z0-9])/g, (m, c) => c.toUpperCase())] = row[k];
  }
  return out;
}

async function dbInit() {
  const c = _getSupa();
  if (!c) { _cacheInited = true; return { ok: true, mode: 'local' }; }
  try {
    const res = await Promise.all([
      c.from('customers').select('*'),
      c.from('quotes').select('*'),
      c.from('orders').select('*'),
      c.from('payments').select('*'),
      c.from('followups').select('*'),
      c.from('reminders').select('*'),
      c.from('purchases').select('*'),
      c.from('manual_ledgers').select('*'),
      c.from('suppliers').select('*'),
      c.from('users').select('*'),
      c.from('products').select('*'),
      c.from('settings').select('*').maybeSingle(),
      c.from('meta').select('*').maybeSingle(),
    ]);
    const TBL = ['customers', 'quotes', 'orders', 'payments', 'followups', 'reminders', 'purchases', 'manual_ledgers', 'suppliers', 'users', 'products'];
    for (let i = 0; i < res.length; i++) {
      const r = res[i];
      if (r.error) {
        console.warn('[dbInit] 表 ' + (TBL[i] || 'meta/settings') + ' 拉取失败：' + r.error.message);
        if (i === 0) return { ok: false, msg: r.error.message };
        continue;
      }
    }
    if (res[0].error) return { ok: false, msg: res[0].error.message };
    if (typeof DB !== 'undefined' && DB) {
      const M = arr => (arr || []).map(_fromRow);
      DB.customers = M(res[0].data);
      DB.quotes = M(res[1].data);
      DB.orders = M(res[2].data);
      DB.payments = M(res[3].data);
      DB.followups = M(res[4].data);
      DB.reminders = M(res[5].data);
      DB.purchases = M(res[6].data);
      DB.manualLedgers = M(res[7].data);
      DB.suppliers = M(res[8].data);
      DB.users = M(res[9].data);
      DB.products = M(res[10].data);
      if (res[11].data) DB.settings = _fromRow(res[11].data);
      if (res[12].data) DB.meta = _fromRow(res[12].data);
    }
    _cacheInited = true;
    return { ok: true, mode: 'cloud' };
  } catch (e) {
    console.warn('[dbInit] 异常：' + String(e));
    return { ok: false, msg: String(e) };
  }
}

/* 通用：单行同步到云。op = 'upsert' | 'delete' */
async function dbSync(table, op, payload) {
  const c = _getSupa();
  if (!c) return { ok: true };   /* 本地模式：不操作 */
  const t = TABLES[table];
  if (!t) return { ok: true };
  try {
    if (op === 'delete') {
      const { error } = await c.from(t).delete().eq('id', payload.id);
      if (error) return { ok: false, msg: error.message };
    } else {
      /* 字段映射：手动把 camelCase 键转成 snake_case 列名 */
      const row = _toRow(table, payload);
      const { error } = await c.from(t).upsert(row);
      if (error) return { ok: false, msg: error.message };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: String(e) };
  }
}

/* 字段映射：DB 里用驼峰，云端用 snake_case；空串/空值过滤 */
const _DATE_FIELDS = new Set(['next_follow', 'last_follow', 'created_at', 'order_date', 'payment_due', 'due_date', 'approve_date', 'pay_date', 'receive_date', 'date', 'due_date', 'valid_until']);
function _toRow(table, obj) {
  if (!obj) return obj;
  const out = {};
  for (const k of Object.keys(obj)) {
    const sk = k.replace(/([A-Z])/g, '_$1').toLowerCase();
    let v = obj[k];
    /* 空日期字符串不发送（让云端用默认） */
    if (_DATE_FIELDS.has(sk) && (v === '' || v == null)) continue;
    out[sk] = v;
  }
  return out;
}

/* 拉取整张表（云模式） */
async function dbList(table) {
  const c = _getSupa();
  if (!c) return window.DB && window.DB[table] ? window.DB[table] : [];
  const t = TABLES[table];
  if (!t) return [];
  const { data, error } = await c.from(t).select('*');
  if (error) return [];
  return (data || []).map(_fromRow);
}

/* 文件上传 */
async function dbUpload(orderId, file) {
  const c = _getSupa();
  if (c) {
    const path = 'orders/' + orderId + '/' + Date.now() + '_' + file.name;
    const { error } = await c.storage.from('attachments').upload(path, file);
    if (error) return { ok: false, msg: error.message };
    const { data: pub } = c.storage.from('attachments').getPublicUrl(path);
    return { ok: true, path, url: pub.publicUrl, name: file.name, size: file.size, mime: file.type };
  }
  return new Promise(resolve => {
    const r = new FileReader();
    r.onload = () => resolve({ ok: true, url: r.result, name: file.name, size: file.size, mime: file.type, local: true });
    r.onerror = () => resolve({ ok: false, msg: '读取失败' });
    r.readAsDataURL(file);
  });
}

async function dbRemoveFile(file) {
  const c = _getSupa();
  if (c && file.path) { await c.storage.from('attachments').remove([file.path]); return { ok: true }; }
  return { ok: true };
}

/* App 挂载：db.js 在 app.js 之前加载，所以轮询等待 + 强兜底轮询 */
function _attach() {
  if (typeof App === 'undefined' || !App) return false;
  if (App.dbMode) return true;
  App.dbMode = dbMode;
  App.dbInit = dbInit;
  App.dbSync = dbSync;
  App.dbList = dbList;
  App.dbUpload = dbUpload;
  App.dbRemove = dbRemoveFile;
  App.getCfg = () => ({ ...DB_CFG });
  App.saveCfg = (patch) => { Object.assign(DB_CFG, patch); _saveCfg(); _supa = null; };
  App.testCloud = async () => {
    const c = _getSupa();
    if (!c) return { ok: false, msg: '未配置或 supabase-js 未加载' };
    const { data, error } = await c.from('meta').select('*').limit(1);
    if (error) return { ok: false, msg: error.message };
    return { ok: true, rows: data ? data.length : 0 };
  };
  return true;
}
/* 多重挂载：轮询（每 50ms 检查一次，共 5s） */
(function waitApp() {
  if (_attach()) return;
  let n = 0;
  const t = setInterval(() => {
    if (_attach() || ++n > 100) clearInterval(t);
  }, 50);
})();
document.addEventListener('DOMContentLoaded', _attach);
window.addEventListener('load', _attach);
/* 兜底：即使上面都失败，5s 后再试 */
setTimeout(_attach, 200);
setTimeout(_attach, 1000);
setTimeout(_attach, 3000);
setTimeout(_attach, 5000);
