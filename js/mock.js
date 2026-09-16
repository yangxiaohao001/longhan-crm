/* ============================================================
   mock.js — 龙瀚 CRM 数据源
   正式环境：保留 1 个示例客户 + 1 个示例报价 + 1 个示例订单，
   总经理可随时删除示例、录入真实数据。
   ============================================================ */
'use strict';

const DB = {
  meta: {
    company: '河北龙瀚金属制品有限公司',
  },

  /* 账号：仅 1 个总经理（超管），上线后由总经理在「设置」里添加员工 */
  users: [
    { id: 'u1', name: '总经理', userName: 'admin', phone: '', position: '总经理', initial: '总', pwd: 'admin123', scopes: ['*'], active: true },
  ],

  settings: {
    depositPct: 30,            /* 发货前最低定金比例（%） */
  },

  stages: ['初步接触', '已报价', '已下单', '生产中', '已发货', '已收款', '已流失'],

  /* 客户：空（云模式从云端拉；本地模式总经理录第一条） */
  customers: [],

  /* 产品库（报价时调用） */
  products: [
    { id: 'p001', name: '镀锌角钢', spec: '50×50×5mm Q235B', unit: '吨', price: 4200 },
    { id: 'p002', name: '热轧卷板', spec: '3.0×1250mm Q235B', unit: '吨', price: 3640 },
    { id: 'p003', name: '镀锌圆钢', spec: 'Φ20mm Q235B',       unit: '吨', price: 3980 },
    { id: 'p004', name: '不锈钢法兰', spec: 'DN50 PN16 · 304',   unit: '件', price: 148 },
    { id: 'p005', name: '高强螺栓连接副', spec: 'M20×60 · 10.9级', unit: '套', price: 18 },
    { id: 'p006', name: '镀锌方管', spec: '60×60×3mm',          unit: '根', price: 85 },
    { id: 'p007', name: '中厚板', spec: '10mm Q345B',           unit: '吨', price: 3850 },
    { id: 'p008', name: '金属波纹管', spec: 'DN200 补偿器',      unit: '个', price: 320 },
  ],

  quotes: [],   /* 空：总经理录入第一条报价 */

  orders: [],   /* 空：总经理录入第一条订单 */

  payments: [],
  followups: [],
  reminders: [],

  suppliers: [
    { id: 's1', name: '【示例供应商】河北某钢材贸易公司', contact: '示例', phone: '139 0000 0001', category: '钢材' },
  ],

  purchases: [],
  manualLedgers: [],
};

/* 把"今天"作为新数据的默认值（运行时取真实当前日期） */
function _today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
DB.today = _today();
