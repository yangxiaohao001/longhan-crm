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
  payrolls: 'payroll',
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
      c.from('payroll').select('*'),
      c.from('settings').select('*').maybeSingle(),
      c.from('meta').select('*').maybeSingle(),
    ]);
    const TBL = ['customers', 'quotes', 'orders', 'payments', 'followups', 'reminders', 'purchases', 'manual_ledgers', 'suppliers', 'users', 'products', 'payroll'];
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
      /* payroll 行保持 snake_case（base_salary/net_pay...），api.js/payroll.js 全按 snake 读写；
         若走 _fromRow 转成驼峰会导致刷新后数值全部显示为空 */
      DB.payrolls = (res[11].data || []);
      if (res[12].data) DB.settings = _fromRow(res[12].data);
      if (res[13].data) DB.meta = _fromRow(res[13].data);
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

/* 文件上传。注意：Supabase Storage 的 key 不接受中文等非 ASCII 字符，
   存储路径一律用时间戳+随机码+英文扩展名；原始文件名只存在元数据 name 里用于展示 */
async function dbUpload(orderId, file) {
  const c = _getSupa();
  if (c) {
    const dot = file.name.lastIndexOf('.');
    const ext = dot >= 0 ? file.name.slice(dot + 1).replace(/[^A-Za-z0-9]/g, '').toLowerCase() : '';
    const path = 'orders/' + orderId + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + (ext ? '.' + ext : '.bin');
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

/* ============================================================
   云端每日备份（存 Supabase Storage 的 attachments/backup/ 下，保留最近 30 份）
   ============================================================ */
const _BACKUP_TABLES = ['customers', 'quotes', 'orders', 'payments', 'followups', 'reminders',
  'purchases', 'manual_ledgers', 'suppliers', 'users', 'products', 'payroll', 'settings', 'meta'];

async function backupToCloud() {
  const c = _getSupa();
  if (!c) return { ok: false, msg: '未配置云端' };
  const dump = { created_at: new Date().toISOString(), app: 'longhan-crm', tables: {} };
  for (const t of _BACKUP_TABLES) {
    const r = await c.from(t).select('*');
    dump.tables[t] = r.error ? [] : (r.data || []);
  }
  const tableCount = Object.keys(dump.tables).filter(k => (dump.tables[k] || []).length).length;
  const rowCount = Object.keys(dump.tables).reduce((s, k) => s + (dump.tables[k] || []).length, 0);
  const name = 'backup/crm-' + dump.created_at.replace(/[:T]/g, '-').slice(0, 19) + '.json';
  const { error } = await c.storage.from('attachments').upload(name, JSON.stringify(dump), { contentType: 'application/json', upsert: false });
  if (error) return { ok: false, msg: error.message };
  /* 保留最近 30 份，旧的自动清理 */
  try {
    const list = await c.storage.from('attachments').list('backup', { sortBy: { column: 'created_at', order: 'desc' } });
    const old = (list.data || []).filter(f => f.name.endsWith('.json')).slice(30);
    if (old.length) await c.storage.from('attachments').remove(old.map(f => 'backup/' + f.name));
  } catch (e) { /* 清理失败不影响备份结果 */ }
  return { ok: true, file: name, name, tableCount, rowCount };
}

async function listCloudBackups() {
  const c = _getSupa();
  if (!c) return { ok: false, msg: '未配置云端' };
  const list = await c.storage.from('attachments').list('backup', { sortBy: { column: 'created_at', order: 'desc' } });
  if (list.error) return { ok: false, msg: list.error.message };
  return {
    ok: true,
    items: (list.data || []).filter(f => f.name.endsWith('.json')).map(f => ({
      name: 'backup/' + f.name, file: f.name,
      created: f.created_at, size: f.metadata ? f.metadata.size : 0,
    })),
  };
}

function backupPublicUrl(name) {
  const c = _getSupa();
  return c ? c.storage.from('attachments').getPublicUrl(name).data.publicUrl : '#';
}

/* 恢复：用备份整包覆盖云端（先删除备份中没有的行，再 upsert 备份行） */
async function restoreFromCloudBackup(name) {
  const c = _getSupa();
  if (!c) return { ok: false, msg: '未配置云端' };
  const url = c.storage.from('attachments').getPublicUrl(name).data.publicUrl;
  const res = await fetch(url);
  if (!res.ok) return { ok: false, msg: '备份文件下载失败（HTTP ' + res.status + '）' };
  const dump = await res.json();
  const tables = dump.tables || {};
  const done = [];
  for (const t of Object.keys(tables)) {
    const rows = tables[t] || [];
    const ids = rows.map(r => r.id).filter(x => x != null);
    const cur = await c.from(t).select('id');
    if (!cur.error) {
      const gone = (cur.data || []).map(r => r.id).filter(id => !ids.includes(id));
      for (let i = 0; i < gone.length; i += 50) {
        await c.from(t).delete().in('id', gone.slice(i, i + 50));
      }
    }
    for (let i = 0; i < rows.length; i += 100) {
      await c.from(t).upsert(rows.slice(i, i + 100));
    }
    done.push(t + '(' + rows.length + ')');
  }
  return { ok: true, detail: done.join('、') };
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
  App.backupToCloud = backupToCloud;
  App.listCloudBackups = listCloudBackups;
  App.backupPublicUrl = backupPublicUrl;
  App.restoreFromCloudBackup = restoreFromCloudBackup;
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
