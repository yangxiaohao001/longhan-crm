/* help.js — 内嵌操作手册（分步、按角色） */
'use strict';
(function () {
  const root = document.getElementById('pageRoot');
  const SECTIONS = [
    {
      icon: 'log-out', title: '登录与日常使用',
      steps: [
        '打开系统网址（部署后由公司提供），输入登录名或手机号 + 密码 → 登录。',
        '演示阶段密码统一为 <b>123456</b>。登录后右上角会显示你的姓名和岗位。',
        '界面右上角小图标可一键切换 <b>亮 / 暗</b> 主题，下次进入会记住你的选择。',
      ],
    },
    {
      icon: 'users', title: '客户管理',
      steps: [
        '在「客户」页顶部按 阶段 / 行业 筛选；右侧搜索框可按公司名 / 联系人 / 电话快速找到客户。',
        '点击客户名进入详情抽屉：可查看累计成交、当前欠款、跟进记录、报价、订单、回款。',
        '点击「记一笔跟进」即可记下电话 / 微信 / 拜访内容；丢单需点「标记流失」并填写原因。',
        '新增客户：右上角「+ 新建客户」，至少填公司名、联系人、电话。',
      ],
    },
    {
      icon: 'file-text', title: '询价 → 报价 → 验单 → 订单',
      steps: [
        '<b>询价</b>：业务员收到客户询价后，先在「客户」页建档（若没有），再进入「报价」页。',
        '<b>报价</b>：点「+ 新建报价」选客户、选产品、填数量 → 保存为草稿 → 提交审批。',
        '<b>审批</b>：总经理（账号 position=总经理）在「报价」页顶部「待你审批」点「通过并发送」或「驳回」。通过后自动 +15 天有效期。',
        '<b>脱单</b>：业务员在报价详情点「标记成交」即按当前版本金额自动生成「已下单」订单。',
        '<b>验单</b>：订单默认是「已下单」状态，由业务员登记定金后推进到「生产中」。',
        '<b>调价</b>：客户要求降价时，点「调价」新增一个版本（自动进入审批流）。',
      ],
    },
    {
      icon: 'clipboard-list', title: '订单全生命周期',
      steps: [
        '订单有 4 段：<b>已下单 → 生产中 → 已发货 → 已收款</b>，由业务员 / 内勤推进。',
        '每张订单在抽屉里都有全生命周期时间轴，能清楚看到卡在哪一步。',
        '发货前若 <b>定金 &lt; 设置比例（默认 30%）</b>，必须由总经理在弹窗里「老板确认发货」才能推进。',
        '生产看板（订单页右上角按钮）用三列泳道展示在制订单，按完工进度自动排序。',
        '<b>附件</b>：在订单详情抽屉最下方点「上传附件」，支持合同 / 技术协议 / 图纸 / 现场照片（PDF / Word / 图片）。',
      ],
    },
    {
      icon: 'wallet', title: '回款与应收',
      steps: [
        '财务 / 总经理在「回款」页点「登记回款」可记一笔到账（定金 / 尾款 / 部分尾款）。',
        '欠款明细按 逾期天数 倒序排，超期订单会光脉冲提示。',
        '尾款收齐后订单自动结案为「已收款」。',
      ],
    },
    {
      icon: 'truck', title: '采购',
      steps: [
        '业务员 / 总经理可发起采购申请（可关联某个订单，作为备料）。',
        '总经理在「采购」页点「审批通过」进入下一阶段，财务登记付款，仓管确认入库。',
      ],
    },
    {
      icon: 'bar-chart', title: '记账',
      steps: [
        '「记账」页自动汇总本月的 收入（来自回款）和 支出（来自采购付款 + 手工账）。',
        '「+ 记一笔支出」可补录工资 / 运费 / 维修 / 水电等日常支出。',
      ],
    },
    {
      icon: 'bell', title: '提醒中心',
      steps: [
        '系统按四类提醒你：<b>待跟进 / 该收款 / 报价到期 / 异常预警</b>。',
        '点「去处理」直接跳到对应单据；点「标记已处理」表示已完成。',
        '侧栏上方的数字 = 当前你账号的待处理提醒数。',
      ],
    },
    {
      icon: 'settings', title: '总经理专属：账号与设置',
      steps: [
        '「设置」页可：① 增 / 删 / 改所有账号（姓名、登录名、电话、岗位、可见模块、启用状态、密码）。',
        '② 调整发货前最低定金比例；③ 配置云端（Supabase）连接，启用跨设备同步 + 真附件云存储。',
        '<b>岗位说明</b>：总经理（你本人）= 全权；业务员 / 内勤 / 跟单 默认只看到自己负责的；财务看全部 + 记账。',
        '添加新员工时：登录名 + 密码默认 123456，让员工首次登录后由你在设置页帮他改密码。',
      ],
    },
    {
      icon: 'upload', title: '常用问题',
      steps: [
        '<b>忘记密码？</b> 总经理在「设置 → 账号」里点对应账号的「重置」即可（演示版统一重置为 123456）。',
        '<b>员工离职？</b> 在账号列表把「启用」关掉，该账号立即无法登录；数据保留。',
        '<b>数据怎么备份？</b> 本地演示模式数据存浏览器，云端模式数据存 Supabase。建议每月导出一次对账单。',
        '<b>手机能用吗？</b> 响应式布局，自动切到移动视图 + 底部 5 按钮导航。',
      ],
    },
  ];

  const nav = [
    { icon: 'layout-dashboard', label: '返回驾驶舱', href: 'index.html' },
    { icon: 'settings', label: '打开设置', href: 'settings.html' },
  ];

  root.innerHTML =
    '<div class="view-banner" style="margin-top:0">' +
    '<span data-icon="help-circle"></span>本手册给总经理专享；按下方目录顺序读一遍，5 分钟即可上手使用系统。' +
    '</div>' +

    '<div class="card" style="margin-bottom:16px"><div class="card-head"><div class="card-title">快速入口</div></div>' +
    '<div class="card-body quick-grid">' +
    nav.map(n => '<a class="quick-btn" href="' + n.href + '"><span data-icon="' + n.icon + '"></span><b>' + n.label + '</b><i>系统其它页面</i></a>').join('') +
    '<button class="quick-btn" id="printBtn"><span data-icon="copy"></span><b>打印 / 另存 PDF</b><i>支持浏览器打印</i></button>' +
    '<button class="quick-btn" id="topBtn"><span data-icon="trending-up"></span><b>回到顶部</b><i>共 ' + SECTIONS.length + ' 章</i></button>' +
    '</div></div>' +

    SECTIONS.map((s, i) =>
      '<div class="card" id="sec' + i + '"><div class="card-head">' +
      '<span class="nav-avatar" style="width:32px;height:32px"><span data-icon="' + s.icon + '"></span></span>' +
      '<div><div class="card-title">' + (i + 1) + '. ' + s.title + '</div></div>' +
      '</div><div class="card-body"><ol style="padding-left:20px;line-height:1.95;font-size:13.5px">' +
      s.steps.map(t => '<li style="margin-bottom:6px">' + t + '</li>').join('') +
      '</ol></div></div>').join('') +

    '<div class="card" style="margin-top:16px"><div class="card-body" style="text-align:center;color:var(--ink-faint)">河北龙瀚金属制品有限公司 · CRM v1.0</div></div>';

  document.getElementById('printBtn').addEventListener('click', () => window.print());
  document.getElementById('topBtn').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  App.mountIcons(root);

  document.addEventListener('DOMContentLoaded', async () => { if (!App.requireLogin()) return; if (App.bootstrapFromCloud) await App.bootstrapFromCloud(); });
})();
