/* ============================================================
   perm.js — 权限矩阵（v2：基于 scopes 配置）
   总经理默认 scopes:['*'] 拥有所有权限；
   其他岗位由总经理在「设置」里勾选可见范围（最多 9 个模块）。
   系统对所有账号一视同仁地支持增/删/改；总经理额外可访问设置页。
   ============================================================ */
'use strict';
/* 注意：app.js 已有一份顶层 const PERM（本文件历史上曾与其冲突导致整文件未执行）。
   这里整体包进 IIFE，作用域内再声明一份同名常量，不再污染全局。 */
(function () {
const PERM = {
  modules: [
    { key: 'dashboard', name: '驾驶舱' },
    { key: 'customers', name: '客户' },
    { key: 'quotes',    name: '报价' },
    { key: 'orders',    name: '订单' },
    { key: 'payments',  name: '回款' },
    { key: 'purchase',  name: '采购' },
    { key: 'finance',   name: '记账' },
    { key: 'reminders', name: '提醒' },
    { key: 'payroll',   name: '工资核算' },
  ],
  actions: {
    'quote.approve':      ['总经理'],
    'quote.edit':         ['总经理', '业务员', '内勤', '跟单'],
    'customer.edit':      ['总经理', '业务员', '内勤'],
    'customer.lost':      ['总经理', '业务员', '内勤'],
    'order.advance':      ['总经理', '财务', '内勤', '跟单', '业务员'],
    'payment.edit':       ['总经理', '财务'],
    'purchase.request':   ['总经理', '业务员', '内勤'],
    'purchase.approve':   ['总经理'],
    'purchase.pay':       ['总经理', '财务'],
    'ledger.edit':        ['总经理', '财务'],
    'payroll.edit':       ['总经理', '财务'],
    'settings.edit':      ['总经理'],
  },
};

function attachPerm() {
  if (typeof App === 'undefined' || App.canRoute) return;
  const u = () => App.session();
  App.canRoute = function (route) {
    const s = u(); if (!s || s.active === false) return false;
    if (s.position === '总经理') return true;
    if (route === 'payroll' && s.position === '财务') return true;  /* 工资核算：财务按岗位放行 */
    return (s.scopes || []).includes(route);
  };
  App.can = function (action) {
    const s = u(); if (!s || s.active === false) return false;
    if (s.position === '总经理') return true;
    return (PERM.actions[action] || []).includes(s.position);
  };
  App.isBoss = function () { const s = u(); return !!(s && s.position === '总经理'); };
  App.seeAll = function () {
    const s = u();
    if (!s) return false;
    if (s.position === '总经理' || s.position === '财务') return true;
    return s.position === '跟单' || s.position === '内勤';
  };
  App.actionable = function (action, ownerId) {
    const s = u();
    if (!s) return false;
    if (App.isBoss()) return true;
    if (App.can(action)) return true;
    if (ownerId && s.id === ownerId) return true;
    return false;
  };
  App.modules = function () { return PERM.modules.slice(); };
  App.positions = function () { return ['总经理', '业务员', '财务', '内勤', '跟单', '车间']; };
}
/* 同步 attach（perm.js 现在在 app.js 之后加载，App 必然已定义） */
if (typeof App !== 'undefined') attachPerm();
})();
