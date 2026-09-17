/* ============================================================
   app.js — 外壳逻辑（会话版）
   登录会话 / 权限守卫 / 侧栏与底部导航渲染 / 抽屉·弹窗·Toast
   页面脚本在 app.js + perm.js 之后加载，直接使用全局 App。
   ============================================================ */

/* ---------- 内联 SVG 图标注册表（唯一图标来源，零外部依赖） ---------- */
const ICONS = {
  'menu': '<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>',
  'layout-dashboard': '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'user': '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  'clipboard-list': '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  'wallet': '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
  'bell': '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  'factory': '<path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M17 18h1"/><path d="M12 18h1"/><path d="M7 18h1"/>',
  'receipt': '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'check': '<path d="M20 6 9 17l-5-5"/>',
  'check-circle': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  'ban': '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  'copy': '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  'columns-2': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'phone': '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  'phone-call': '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/><path d="M14.05 2a9 9 0 0 1 8 7.94"/><path d="M14.05 6A5 5 0 0 1 18 10"/>',
  'calendar': '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  'clock': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'alert-triangle': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'alert-circle': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  'map-pin': '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  'building-2': '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
  'briefcase': '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  'truck': '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35a1 1 0 0 0-.78-.38H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  'package': '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  'banknote': '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  'circle-dollar-sign': '<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/>',
  'trending-up': '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  'trending-down': '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
  'pencil': '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  'trash-2': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  'message-square': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  'filter': '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  'history': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  'send': '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  'list-checks': '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  'paperclip': '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  'coins': '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
  'file-spreadsheet': '<path d="M14 2v6a2 2 0 0 1-2 2H4"/><path d="M4 22h14a2 2 0 0 0 2-2V8l-6-6H4a2 2 0 0 0-2 2v4"/><path d="M14 2v6a2 2 0 0 1-2 2H4"/><rect width="8" height="8" x="8" y="14" rx="2"/>',
  'target': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  'award': '<path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/>',
  'inbox': '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  'flag': '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  'hex-nut': '<path d="M12 2.5 20.2 7v10L12 21.5 3.8 17V7Z"/><circle cx="12" cy="12" r="3.4"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 22 11 16 5"/><line x1="22" x2="9" y1="11" y2="11"/>',
  'lock': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'bar-chart': '<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>',
  'settings': '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  'help-circle': '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/>',
  'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  'moon': '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  'upload': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  'file': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  'image': '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
};

/* ---------- 全局 App ---------- */
const App = {

  today: DB.meta.today,

  /* ---------- 会话 ---------- */
  session() { return fetchSession(); },

  requireLogin() {
    if (!App.session()) { location.replace('login.html'); return false; }
    return true;
  },

  logout() {
    logout();
    location.replace('login.html');
  },

  /* ---------- 导航定义（侧栏/底部导航统一由这里渲染） ---------- */
  NAV: [
    { key: 'dashboard', file: 'index.html',     icon: 'layout-dashboard', label: '驾驶舱' },
    { key: 'customers', file: 'customers.html', icon: 'users',            label: '客户' },
    { key: 'quotes',    file: 'quotes.html',    icon: 'file-text',        label: '报价' },
    { key: 'orders',    file: 'orders.html',    icon: 'clipboard-list',   label: '订单' },
    { key: 'payments',  file: 'payments.html',  icon: 'wallet',           label: '回款' },
    { key: 'purchase',  file: 'purchase.html',  icon: 'truck',            label: '采购' },
    { key: 'finance',   file: 'finance.html',   icon: 'bar-chart',        label: '记账' },
    { key: 'payroll',   file: 'payroll.html',   icon: 'banknote',         label: '工资核算' },
    { key: 'reminders', file: 'reminders.html', icon: 'bell',             label: '提醒' },
    { key: 'help',      file: 'help.html',      icon: 'help-circle',      label: '帮助' },
    { key: 'settings',  file: 'settings.html',  icon: 'settings',         label: '设置' },
  ],

  renderNav() {
    const s = App.session();
    const page = document.body.dataset.page;
    const items = App.NAV.filter(n => {
      if (n.key === 'settings') return App.isBoss();
      if (n.key === 'help') return true;
      return App.canRoute(n.key);
    });
    const badge = n => {
      if (n.key === 'reminders') return '<i class="nav-badge red" data-badge="reminders"></i>';
      if (App.isBoss() && (n.key === 'quotes' || n.key === 'purchase')) return '<i class="nav-badge" data-badge="' + n.key + '"></i>';
      return '';
    };
    const link = n =>
      '<a class="nav-item' + (n.key === page ? ' active' : '') + '" href="' + n.file + '" data-nav="' + n.key + '">' +
      '<span class="nav-ico" data-icon="' + n.icon + '"></span><span>' + n.label + '</span>' + badge(n) + '</a>';

    const nav = document.getElementById('appNav');
    if (nav) {
      nav.innerHTML =
        '<div class="nav-brand"><span class="nav-brand-logo" data-icon="hex-nut"></span>' +
        '<div class="nav-brand-txt"><b>龙瀚 CRM</b><i>LONGHAN · 拉弯智控</i></div></div>' +
        '<nav class="nav-links">' + items.map(link).join('') + '</nav>' +
        '<div class="nav-user">' +
        '<span class="nav-avatar">' + (s ? s.initial : '?') + '</span>' +
        '<div class="nav-user-meta"><b id="navUserName">' + (s ? s.name : '') + '</b><i id="navUserRole">' + (s ? (s.position || '') : '') + '</i></div>' +
        '<button class="nav-logout" id="navLogout" title="退出登录"><span data-icon="log-out"></span></button>' +
        '</div>';
      const lo = nav.querySelector('#navLogout');
      if (lo) lo.addEventListener('click', () => App.confirm({
        title: '退出登录', html: '确定要退出当前账号吗？', okText: '退出', danger: true, onOk: () => App.logout(),
      }));
    }
    const bn = document.getElementById('bottomNav');
    if (bn) {
      bn.innerHTML = items.filter(n => n.key !== 'help' && n.key !== 'settings').slice(0, 5).map(n =>
        '<a class="bn-item' + (n.key === page ? ' active' : '') + '" href="' + n.file + '">' +
        '<span data-icon="' + n.icon + '"></span><i>' + n.label + '</i>' +
        ((App.isBoss() && (n.key === 'quotes' || n.key === 'purchase')) ? '<b class="bn-badge" data-badge="' + n.key + '"></b>' : '') +
        '</a>').join('');
    }
  },

  /* ---------- 主题切换（暗/亮） ---------- */
  theme: (function () { try { return localStorage.getItem('lh-crm-theme') || 'dark'; } catch (e) { return 'dark'; } })(),
  applyTheme(theme) {
    App.theme = theme === 'light' ? 'light' : 'dark';
    try { localStorage.setItem('lh-crm-theme', App.theme); } catch (e) {}
    document.documentElement.dataset.theme = App.theme;
  },
  toggleTheme() { App.applyTheme(App.theme === 'dark' ? 'light' : 'dark'); return App.theme; },
  themeIcon() { return App.theme === 'light' ? 'moon' : 'sun'; },
  themeLabel() { return App.theme === 'light' ? '切到暗色' : '切到亮色'; },

  /* ---------- 状态 → 徽标 ---------- */
  stageMeta: {
    '初步接触': '', '已报价': 'badge-info',
    '已下单': 'badge-info', '生产中': 'badge-warn', '已发货': 'badge-info',
    '已收款': 'badge-success', '已流失': 'badge-danger',
  },
  quoteStatusMeta: {
    '草稿': '', '待审批': 'badge-warn', '已发送': 'badge-info', '已成交': 'badge-success',
    '已过期': 'badge-danger', '已作废': '', '已驳回': 'badge-danger',
  },
  orderStatusMeta: {
    '已下单': 'badge-info', '生产中': 'badge-warn', '已发货': 'badge-info', '已收款': 'badge-success',
  },
  purchaseStatusMeta: {
    '待审批': 'badge-warn', '已审批': 'badge-info', '已付款': 'badge-info', '已入库': 'badge-success', '已驳回': 'badge-danger',
  },
  payTypeMeta: { '定金': 'badge-info', '尾款': 'badge-success', '部分尾款': 'badge-warn' },
  remindTypeMeta: {
    follow:  { label: '待跟进',   icon: 'phone-call',         cls: 'follow' },
    payment: { label: '该收款',   icon: 'circle-dollar-sign', cls: 'payment' },
    quote:   { label: '报价到期', icon: 'clock',              cls: 'quote' },
    alert:   { label: '异常预警', icon: 'alert-triangle',     cls: 'alert' },
  },

  /* ---------- 图标 ---------- */
  icon(name) {
    const body = ICONS[name];
    if (!body) return '';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  },

  /* 列表批量选择：绑定全选/行选/浮动操作条。opts.onDelete(ids) 由页面提供 */
  bindBatch(root, opts) {
    let bar = document.getElementById('batchBar');
    if (bar) bar.remove();
    const ids = () => [...root.querySelectorAll('.row-chk:checked')].map(c => c.dataset.id);
    const update = () => {
      const list = ids();
      let b = document.getElementById('batchBar');
      if (!list.length) { if (b) b.remove(); return; }
      if (!b) {
        b = document.createElement('div');
        b.id = 'batchBar';
        b.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:95;display:flex;align-items:center;gap:12px;padding:10px 16px;background:var(--surface-solid);border:1px solid var(--border-strong);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.4)';
        b.innerHTML = '<span class="batch-count" style="font-size:13px;color:var(--ink)"></span>' +
          '<button class="btn btn-sm btn-danger batch-del"><span data-icon="trash-2"></span>批量删除</button>' +
          '<button class="btn btn-sm batch-cancel">取消</button>';
        document.body.appendChild(b);
        b.querySelector('.batch-cancel').addEventListener('click', () => {
          root.querySelectorAll('.row-chk:checked').forEach(c => { c.checked = false; });
          const all = root.querySelector('.chk-all'); if (all) all.checked = false;
          update();
        });
        b.querySelector('.batch-del').addEventListener('click', async () => {
          const delIds = ids();
          if (!delIds.length || !opts || !opts.onDelete) return;
          const btn = b.querySelector('.batch-del');
          btn.disabled = true;
          try { await opts.onDelete(delIds); } catch (e) { App.toast('批量操作失败：' + e.message, 'danger'); }
          const b2 = document.getElementById('batchBar');
          if (b2) { const btn2 = b2.querySelector('.batch-del'); if (btn2) btn2.disabled = false; }
        });
        App.mountIcons(b);
      }
      b.querySelector('.batch-count').textContent = '已选择 ' + list.length + ' 项';
    };
    const all = root.querySelector('.chk-all');
    if (all) all.addEventListener('change', () => {
      root.querySelectorAll('.row-chk').forEach(c => { c.checked = all.checked; });
      update();
    });
    root.querySelectorAll('.row-chk').forEach(c => c.addEventListener('change', update));
  },

  mountIcons(root) {
    (root || document).querySelectorAll('[data-icon]').forEach(el => {
      const name = el.getAttribute('data-icon');
      const svg = App.icon(name);
      if (svg) { el.innerHTML = svg; el.classList.add('icon'); el.removeAttribute('data-icon'); }
    });
  },

  /* ---------- DOM / 格式化工具 ---------- */
  el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  },

  escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  fmtMoney(n, withSign) {
    if (n == null || isNaN(n)) return '—';
    const v = Math.round(n * 100) / 100;
    const s = v.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return (withSign === false ? '' : '¥') + s;
  },

  fmtWan(n) {
    if (n == null || isNaN(n)) return '—';
    return (Math.round(n / 10000 * 10) / 10).toLocaleString('zh-CN') + ' 万';
  },

  fmtDate(iso) { return iso || '—'; },

  relDays(n) {
    if (n == null) return '—';
    if (n === 0) return '今天';
    if (n === 1) return '明天';
    if (n === -1) return '昨天';
    if (n > 0) return n + ' 天后';
    return '逾期 ' + Math.abs(n) + ' 天';
  },

  daysBetween(fromIso, toIso) {
    const a = new Date(fromIso + 'T00:00:00'), b = new Date(toIso + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  },

  userById(id) { return DB.users.find(u => u.id === id) || { name: '—', initial: '?' }; },
  customerById(id) { return DB.customers.find(c => c.id === id) || null; },

  badge(text, cls) { return '<span class="badge ' + (cls || '') + '">' + App.escapeHtml(text) + '</span>'; },

  /* KPI 迷你趋势（内联 SVG 折线，霓虹描边由 CSS 控制） */
  sparkline(values) {
    if (!values || values.length < 2) return '';
    const w = 72, h = 26;
    const min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    const range = (max - min) || 1;
    const stepX = w / (values.length - 1);
    const pts = values.map((v, i) => {
      const x = (i * stepX).toFixed(1);
      const y = (h - 3 - (v - min) / range * (h - 6)).toFixed(1);
      return x + ',' + y;
    }).join(' ');
    return '<svg class="kpi-spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + pts + '"/></svg>';
  },

  /* 数字滚动（600ms，requestAnimationFrame，旧电脑也流畅） */
  countUp(el, target, formatter) {
    if (!el) return;
    const fmt = formatter || (v => App.fmtMoney(v));
    const dur = 600, t0 = performance.now();
    const from = 0;
    const step = now => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3); /* ease-out */
      el.textContent = fmt(from + (target - from) * e);
      if (p < 1) requestAnimationFrame(step); else el.textContent = fmt(target);
    };
    requestAnimationFrame(step);
  },

  /* ---------- 表单校验 ---------- */
  formError(input, msg) {
    input.classList.add('err');
    const field = input.closest('.field, .form-item');
    const err = field ? field.querySelector('.form-error') : null;
    if (err) { err.textContent = msg || ''; err.classList.add('show'); }
  },
  formClear(input) {
    input.classList.remove('err');
    const field = input.closest('.field, .form-item');
    const err = field ? field.querySelector('.form-error') : null;
    if (err) err.classList.remove('show');
  },

  btnLoading(btn) { btn.classList.add('is-loading'); btn.disabled = true; },
  btnDone(btn) { btn.classList.remove('is-loading'); btn.disabled = false; },

  /* ---------- 确认弹窗（危险操作统一入口） ---------- */
  confirm(opts) {
    App.openModal({
      title: opts.title || '确认操作',
      html: '<div style="font-size:13.5px;line-height:1.7;color:var(--ink-sub)">' + (opts.html || '') + '</div>',
      foot:
        '<button class="btn" data-act="cancel">' + (opts.cancelText || '取消') + '</button>' +
        '<button class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" data-act="ok">' + (opts.okText || '确认') + '</button>',
      onMount(box) {
        box.querySelector('[data-act="cancel"]').addEventListener('click', () => App.closeModal());
        box.querySelector('[data-act="ok"]').addEventListener('click', () => {
          App.closeModal();
          if (opts.onOk) opts.onOk();
        });
      },
    });
  },

  /* ---------- 抽屉 ---------- */
  _drawerRoot: null,
  openDrawer(opts) {
    if (!App._drawerRoot) {
      const mask = App.el('<div class="drawer-mask" id="drawerMask"></div>');
      const box = App.el('<div class="drawer" id="drawerBox" role="dialog" aria-modal="true"></div>');
      document.body.append(mask, box);
      mask.addEventListener('click', App.closeDrawer);
      App._drawerRoot = box; App._drawerMask = mask;
    }
    App._drawerRoot.className = 'drawer' + (opts.wide ? ' wide' : '');
    App._drawerRoot.innerHTML =
      '<div class="drawer-head"><div class="drawer-title">' + opts.title + '</div>' +
      '<button class="drawer-close" aria-label="关闭"><span data-icon="x"></span></button></div>' +
      '<div class="drawer-body">' + opts.html + '</div>';
    App._drawerRoot.querySelector('.drawer-close').addEventListener('click', App.closeDrawer);
    App._drawerRoot.classList.add('open');
    App._drawerMask.classList.add('open');
    document.body.style.overflow = 'hidden';
    App.mountIcons(App._drawerRoot);
    if (opts.onMount) opts.onMount(App._drawerRoot);
  },
  closeDrawer() {
    if (!App._drawerRoot) return;
    App._drawerRoot.classList.remove('open');
    App._drawerMask.classList.remove('open');
    document.body.style.overflow = '';
  },

  /* ---------- 弹窗 ---------- */
  _modalRoot: null,
  openModal(opts) {
    if (!App._modalRoot) {
      const mask = App.el('<div class="modal-mask" id="modalMask"></div>');
      const box = App.el('<div class="modal" id="modalBox" role="dialog" aria-modal="true"></div>');
      mask.append(box);
      document.body.append(mask);
      mask.addEventListener('click', e => { if (e.target === mask) App.closeModal(); });
      App._modalRoot = mask; App._modalBox = box;
    }
    App._modalBox.className = 'modal' + (opts.wide ? ' wide' : '');
    App._modalBox.innerHTML =
      '<div class="modal-head"><div class="modal-title">' + opts.title + '</div>' +
      '<button class="drawer-close" aria-label="关闭"><span data-icon="x"></span></button></div>' +
      '<div class="modal-body">' + opts.html + '</div>' +
      (opts.foot ? '<div class="modal-foot">' + opts.foot + '</div>' : '');
    App._modalBox.querySelector('.drawer-close').addEventListener('click', App.closeModal);
    App._modalRoot.classList.add('open');
    document.body.style.overflow = 'hidden';
    App.mountIcons(App._modalBox);
    if (opts.onMount) opts.onMount(App._modalBox);
  },
  closeModal() {
    if (!App._modalRoot) return;
    App._modalRoot.classList.remove('open');
    document.body.style.overflow = '';
  },

  /* ---------- Toast ---------- */
  _toastRoot: null,
  toast(msg, type) {
    if (!App._toastRoot) {
      App._toastRoot = App.el('<div class="toast-root"></div>');
      document.body.append(App._toastRoot);
    }
    const iconName = type === 'danger' || type === 'info' ? 'alert-circle' : 'check-circle';
    const t = App.el('<div class="toast toast--' + (type || 'success') + '"><span data-icon="' + iconName + '"></span><span>' + App.escapeHtml(msg) + '</span></div>');
    App._toastRoot.append(t);
    App.mountIcons(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, 2600);
  },
};

/* ---------- 权限挂载（内联，确保 App 定义后立即可用，避免脚本顺序问题） ---------- */
const PERM = {
  modules: [
    { key: 'dashboard', name: '驾驶舱' },
    { key: 'customers', name: '客户' },
    { key: 'quotes',    name: '报价' },
    { key: 'orders',    name: '订单' },
    { key: 'payments',  name: '回款' },
    { key: 'purchase',  name: '采购' },
    { key: 'finance',   name: '记账' },
    { key: 'payroll',   name: '工资核算' },
    { key: 'reminders', name: '提醒' },
  ],
  actions: {
    'quote.approve':    ['总经理'],
    'quote.edit':       ['总经理', '业务员', '内勤', '跟单'],
    'customer.edit':    ['总经理', '业务员', '内勤'],
    'customer.lost':    ['总经理', '业务员', '内勤'],
    'order.advance':    ['总经理', '财务', '内勤', '跟单', '业务员'],
    'payment.edit':     ['总经理', '财务'],
    'purchase.request': ['总经理', '业务员', '内勤'],
    'purchase.approve': ['总经理'],
    'purchase.pay':     ['总经理', '财务'],
    'ledger.edit':      ['总经理', '财务'],
    'settings.edit':    ['总经理'],
  },
};
App.canRoute = function (route) {
  const s = App.session(); if (!s || s.active === false) return false;
  if (s.position === '总经理') return true;
  return (s.scopes || []).includes(route);
};
App.can = function (action) {
  const s = App.session(); if (!s || s.active === false) return false;
  if (s.position === '总经理') return true;
  return (PERM.actions[action] || []).includes(s.position);
};
App.isBoss = function () { const s = App.session(); return !!(s && s.position === '总经理'); };
App.seeAll = function () {
  const s = App.session();
  if (!s) return false;
  if (s.position === '总经理' || s.position === '财务') return true;
  return s.position === '跟单' || s.position === '内勤';
};
/* 跟单授权：总经理/全局视角恒有；普通业务员看 settings.followupGrant 名单（此前缺失导致业务员客户页/订单页崩溃） */
App.hasFollowup = function () {
  const s = App.session();
  if (!s) return false;
  if (App.isBoss() || App.seeAll()) return true;
  try {
    const g = (typeof DB !== 'undefined' && DB.settings && DB.settings.followupGrant) || [];
    return g.includes(s.userId);
  } catch (e) { return false; }
};
App.modules = function () { return PERM.modules.slice(); };
App.positions = function () { return ['总经理', '业务员', '财务', '内勤', '跟单', '车间']; };

/* ---------- 外壳初始化 ---------- */
function shellInit() {
  App.applyTheme(App.theme);
  if (document.body.dataset.page !== 'login') {
    if (!App.requireLogin()) return;
    const s = App.session();
    const pageKey = document.body.dataset.page;
    /* 总经理恒通过；help/settings 恒通过；其他走 canRoute */
    const ok = s.position === '总经理' || pageKey === 'help'
      || (pageKey === 'settings' && s.position === '总经理')
      || (typeof App.canRoute === 'function' && App.canRoute(pageKey));
    if (!ok) {
      /* 无 dashboard 权限时自动跳到第一个有权限的页面（否则登录后一片空白） */
      if (pageKey === 'dashboard') {
        const first = App.NAV.find(n => n.key !== 'help' && n.key !== 'settings' && App.canRoute(n.key));
        if (first) { location.replace(first.file); return; }
      }
      const page = document.querySelector('.page');
      if (page) {
        page.dataset.blocked = '1';
        page.innerHTML =
          '<div class="empty"><span data-icon="shield-check"></span><p>当前账号没有该页面的访问权限</p></div>';
      }
      const block = new MutationObserver(() => {
        if (page && !page.innerHTML.includes('当前账号没有该页面')) {
          page.innerHTML = '<div class="empty"><span data-icon="shield-check"></span><p>当前账号没有该页面的访问权限</p></div>';
        }
      });
      if (page) block.observe(page, { childList: true, characterData: true, subtree: true });
      /* 关键：被拦截也要渲染导航/顶栏/退出按钮，否则用户被困死在空白页 */
      shellRun();
      return;
    }
  }
  shellRun();
}

/* 守卫和导航只跑一次（守卫通过后） */
function shellRun() {
  // 1. 图标 + 导航
  App.mountIcons(document);
  App.renderNav();
  App.mountIcons(document);

  // 2. 顶栏日期（实时当前时间 + 钟点） + 顶栏用户 + 主题切换
  const s = App.session();
  const updateClock = () => {
    const dateEl = document.getElementById('topbarDate');
    if (!dateEl) return;
    const now = new Date();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
    const h = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    dateEl.textContent = y + '-' + mo + '-' + d + ' · ' + wd + ' · ' + h + ':' + mi;
  };
  updateClock();
  if (window.__clockTimer) clearInterval(window.__clockTimer);
  window.__clockTimer = setInterval(updateClock, 30000);
  const tu = document.getElementById('topbarUser');
  if (tu && s) tu.innerHTML = '<span class="nav-avatar sm">' + s.initial + '</span>' + s.name + ' · ' + (s.position || '');
  const themeBtn = document.getElementById('topbarTheme');
  if (themeBtn) {
    themeBtn.innerHTML = '<span data-icon="' + App.themeIcon() + '"></span>';
    themeBtn.title = App.themeLabel();
    themeBtn.onclick = () => {
      const t = App.toggleTheme();
      themeBtn.innerHTML = '<span data-icon="' + App.themeIcon() + '"></span>';
      themeBtn.title = App.themeLabel();
      App.mountIcons(themeBtn);
      App.toast('已切换到' + (t === 'light' ? '亮色' : '暗色') + '主题', 'info');
    };
    App.mountIcons(themeBtn);
  }

  // 3. 移动端侧栏
  const nav = document.getElementById('appNav');
  const navMask = document.getElementById('navMask');
  const toggle = document.getElementById('navToggle');
  const closeNav = () => { nav.classList.remove('open'); navMask.classList.remove('open'); };
  if (toggle && nav && navMask) {
    toggle.addEventListener('click', () => {
      nav.classList.add('open'); navMask.classList.add('open');
    });
    navMask.addEventListener('click', closeNav);
    nav.addEventListener('click', e => { if (e.target.closest('a')) closeNav(); });
  }

  // 4. 侧栏徽标（只在数值真正变化时写 DOM，避免 0 写 0 触发重排闪动）
  /* 4.5 拉云端数据（如已配 Supabase）—— 等数据拉完 + 子页面渲染完，再 reload 让 UI 用云端数据 */
  if (App.bootstrapFromCloud) {
    App.bootstrapFromCloud().then(r => {
      if (r && r.ok && r.mode === 'cloud') {
        const ts = parseInt(sessionStorage.getItem('lh-crm-cloud-init') || '0', 10);
        if (!ts) {
          sessionStorage.setItem('lh-crm-cloud-init', '1');
          /* 给子页面 IIFE 充足的时间画完（customers / orders 等都是先 await fetch 后渲染） */
          setTimeout(() => location.reload(), 3000);
        }
      }
    });
  }
  function _setBadge(b, n) {
    if (!b) return;
    const cur = b.textContent;
    const want = n > 0 ? String(n) : '';
    if (cur === want && (n > 0 ? b.style.display !== 'none' : b.style.display === 'none')) return;
    b.textContent = want;
    b.style.display = n > 0 ? '' : 'none';
  }
  if (App.canRoute('reminders')) {
    fetchReminderCounts().then(res => {
      if (res.code !== 0) return;
      document.querySelectorAll('[data-badge="reminders"]').forEach(el => _setBadge(el, res.data.unread != null ? res.data.unread : res.data.total));
    });
  }
  if (App.isBoss()) {
    fetchPendingApprovals().then(res => {
      if (res.code !== 0) return;
      const qn = res.data.quotes.length, pn = res.data.purchases.length;
      document.querySelectorAll('[data-badge="quotes"]').forEach(el => _setBadge(el, qn));
      document.querySelectorAll('[data-badge="purchase"]').forEach(el => _setBadge(el, pn));
      const total = qn + pn;
      if (total > 0) {
        const tk = 'lh-approval-toast-' + new Date().toDateString();
        if (!sessionStorage.getItem(tk)) {
          try { sessionStorage.setItem(tk, '1'); } catch (e) {}
          App.toast('您有 ' + (qn ? qn + ' 笔报价' : '') + (qn && pn ? '、' : '') + (pn ? pn + ' 笔采购' : '') + '待审批', 'warn');
        }
      }
    }).catch(() => {});
  }

  // 5. Esc 关闭浮层
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { App.closeDrawer(); App.closeModal(); }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(shellInit, 0));
} else {
  setTimeout(shellInit, 0);
}

