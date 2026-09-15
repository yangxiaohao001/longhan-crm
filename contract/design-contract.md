# Design Contract — 龙翰金属 CRM MVP v2（全面重构版）

> 唯一设计事实源。所有页面必须遵守；子代理不得发明样式、不得改导航。
> 技术栈：纯静态 HTML/CSS/JS（无构建、零外部依赖、双击 index.html 离线可开）。
> 图标：全部通过 `app.js` 的 `App.icon()` / `data-icon` 内联 SVG 注册表渲染，禁止 emoji 图标、禁止 CDN。

## 1. 风格定位「钢厂调度室」

- aesthetic: 深钢墨侧栏 + 浅灰内容区 + 工业钢蓝主色 + 琥珀警示；描边卡片、等宽数字、蓝图网格底纹
- tone: 沉稳 / 高信息密度 / 数字直给 / 克制不花哨
- 受众：金属制品厂老板（45+）、业务员、财务；电脑基础操作水平 → 大按钮、清晰标签、操作有反馈
- 反廉价三原则：① 数字一律 mono + tabular-nums；② 状态一律徽标+颜色，不靠闪烁动画；③ 留白有度，卡片描边 1px 实线 + 极浅阴影

## 2. Design Tokens（styles.css :root，唯一取值来源）

```css
--primary: #2158a8;        /* 工业钢蓝 */
--primary-strong: #1a4788;
--primary-weak: #eaf1fa;
--bg: #eef1f5;
--surface: #ffffff;
--surface-2: #f7f9fb;
--border: #e2e7ee;
--border-strong: #c9d2dc;
--ink: #182430;
--ink-sub: #5a6878;
--ink-faint: #93a0ae;
--success: #15803d;  --success-bg: #ecfdf3;
--warning: #b45309;  --warning-bg: #fff8ea;
--danger: #b42318;   --danger-bg: #fdf0ee;
--nav-bg: #131e2a;         /* 侧栏深钢墨 */
--nav-ink: #97a8ba;
--nav-active-bg: #1d2f42;
--sidebar-w: 232px;
--radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px;
--shadow-sm: 0 1px 2px rgba(24,36,48,.05);
--shadow-md: 0 8px 24px rgba(24,36,48,.10);
--font-body: "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;
--font-mono: "Cascadia Code","JetBrains Mono",Consolas,monospace;
/* 字号 12/13/14/16/18/22/26；间距 4 的倍数；≤3 主色系 */
```

- 页面加载编排：`.page > *` 依次 rise 入场（nth-child 递增 delay），悬停仅卡片 translateY(-2px)+shadow。
- 背景氛围：body 极淡蓝图网格（linear-gradient 24px 网格，rgba(33,88,168,.045)）。

## 3. App Shell（逐字节冻结，每页仅 4 处不同）

每页仅允许不同：① `<title>`；② `body[data-page]`；③ `topbar-title` 文本；④ 末尾页面脚本 src。其余必须与下例逐字节一致：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>PAGETITLE · 龙翰CRM</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body data-page="PAGEKEY">
  <div class="app">
    <div class="drawer-mask nav-mask" id="navMask"></div>
    <aside class="app-nav" id="appNav" aria-label="主导航">
      <div class="nav-brand">
        <span class="brand-mark" data-icon="hex-nut"></span>
        <div class="brand-text">
          <div class="brand-name">龙翰 CRM</div>
          <div class="brand-sub">金属制品 · 客户管理</div>
        </div>
      </div>
      <nav class="nav-list">
        <a class="nav-item" data-nav="dashboard" href="index.html"><span class="nav-ico" data-icon="layout-dashboard"></span><span>工作台</span></a>
        <a class="nav-item" data-nav="customers" href="customers.html"><span class="nav-ico" data-icon="users"></span><span>客户管理</span></a>
        <a class="nav-item" data-nav="quotes" href="quotes.html"><span class="nav-ico" data-icon="file-text"></span><span>报价管理</span><span class="nav-badge" id="navApprovalBadge"></span></a>
        <a class="nav-item" data-nav="orders" href="orders.html"><span class="nav-ico" data-icon="clipboard-list"></span><span>订单管理</span></a>
        <a class="nav-item" data-nav="payments" href="payments.html"><span class="nav-ico" data-icon="wallet"></span><span>回款与应收</span></a>
        <a class="nav-item" data-nav="reminders" href="reminders.html"><span class="nav-ico" data-icon="bell"></span><span>提醒中心</span><span class="nav-badge" id="navRemindBadge"></span></a>
      </nav>
      <div class="nav-group-title">二期规划</div>
      <nav class="nav-list">
        <a class="nav-item nav-item--soon" href="#"><span class="nav-ico" data-icon="factory"></span><span>生产 · 采购</span><span class="soon-tag">二期</span></a>
        <a class="nav-item nav-item--soon" href="#"><span class="nav-ico" data-icon="receipt"></span><span>开票 · 财务记账</span><span class="soon-tag">二期</span></a>
      </nav>
      <div class="nav-foot">
        <div class="nav-user">
          <div class="avatar avatar--sm" id="navAvatar">王</div>
          <div class="nav-user-meta">
            <div class="nav-user-name" id="navUserName">王建国</div>
            <div class="nav-user-role" id="navUserRole">总经理</div>
          </div>
        </div>
      </div>
    </aside>
    <div class="app-main">
      <header class="topbar">
        <button class="nav-toggle" id="navToggle" aria-label="打开菜单"><span data-icon="menu"></span></button>
        <h1 class="topbar-title">PAGETITLE</h1>
        <div class="topbar-actions">
          <div class="role-switch" id="roleSwitch">
            <button type="button" data-role="boss">老板</button>
            <button type="button" data-role="sales">业务员</button>
            <button type="button" data-role="finance">财务</button>
          </div>
          <span class="topbar-date" id="topbarDate">2026-09-10 · 周四</span>
        </div>
      </header>
      <main class="page" id="page">
        <!-- 仅此处放页面内容 -->
      </main>
    </div>
    <nav class="bottom-nav" id="bottomNav" aria-label="底部导航">
      <a data-nav="dashboard" href="index.html"><span data-icon="layout-dashboard"></span><span>工作台</span></a>
      <a data-nav="customers" href="customers.html"><span data-icon="users"></span><span>客户</span></a>
      <a data-nav="quotes" href="quotes.html"><span data-icon="file-text"></span><span>报价</span></a>
      <a data-nav="orders" href="orders.html"><span data-icon="clipboard-list"></span><span>订单</span></a>
      <a data-nav="reminders" href="reminders.html"><span data-icon="bell"></span><span>提醒</span><i class="bottom-badge" id="bottomRemindBadge"></i></a>
    </nav>
  </div>
  <script src="js/mock.js"></script>
  <script src="js/api.js"></script>
  <script src="js/app.js"></script>
  <script src="js/PAGESCRIPT.js"></script>
</body>
</html>
```

- 激活规则（唯一机制）：app.js 读取 `body[data-page]`，为侧栏 `a[data-nav]` 与底部导航 `a[data-nav]` 加 `.active`。
- `.nav-item--soon` 由 app.js 拦截点击 → preventDefault + toast。
- 角色切换：topbar `#roleSwitch`；切换后更新侧栏用户卡 + 调用 `window.onRoleChange?.(role)`（页面必须实现该钩子重渲染）。
- 徽标：`#navRemindBadge`（提醒数）、`#navApprovalBadge`（待审批报价数）、`#bottomRemindBadge` 均由 app.js 异步填充，值为 0 时隐藏。

## 4. 页面清单与 data-page / PAGETITLE / PAGESCRIPT

| 文件 | data-page | 标题 | 脚本 |
|---|---|---|---|
| index.html | dashboard | 工作台 | js/dashboard.js |
| customers.html | customers | 客户管理 | js/customers.js |
| quotes.html | quotes | 报价管理 | js/quotes.js |
| orders.html | orders | 订单管理 | js/orders.js |
| payments.html | payments | 回款与应收 | js/payments.js |
| reminders.html | reminders | 提醒中心 | js/reminders.js |

## 5. API 层（js/api.js 已冻结，页面只调用不自算）

全部返回 `{ code, data }` 或 `{ code:1, msg }`，均带 delay：

- `fetchMeta()` → stages / preDealStages / industries / products / users / plannedModules / today
- `fetchDashboardSummary()` → kpis{monthDealAmount, monthDealDeltaPct, monthOrderCount, newCustomerCount, receivableTotal, receivableCount, overdueTotal, overdueCount, monthPayment} + spark{deal[],payment[],orders[],newCust[],receivable[]} + trend{labels,deal,payment} + ranking[] + ownerStats{uid→{...}} + stageDist[] + dueFollows[] + overdueFollows[] + receivables[] + reminderCounts{}
- `fetchCustomers({keyword, industry, stage, owner, excludeLost})` → 客户视图[]（含 stageIndex/isPreDeal/nextFollowIn/daysSinceLastFollow/overdueOrderCount/balance/totalDeal/lostReason/ownerName）
- `fetchCustomerDetail(id)` → customer + stageProgress{full,index,preDeal} + quotes[] + orders[] + payments[] + followups[]
- `saveCustomer(payload)` / `addFollowup(payload)`
- `advanceCustomerStage(id)`（商机 5 段内推进）/ `markCustomerLost(id, reason)`（必填原因）/ `reactivateCustomer(id)`
- `fetchQuotes({status, keyword, owner})` / `fetchQuoteDetail(id)`（含 versions[]（total 已算）+ delta + approval）
- `saveQuote(payload)` / `createQuoteVersion(id, payload)` / `submitQuote(id)` / `approveQuote(id, pass, reason)` / `markQuoteDeal(id)`（成交自动生成订单）/ `voidQuote(id)`
- `fetchOrders({status, keyword, owner})` / `fetchOrderDetail(id)` / `advanceOrderStage(id)` / `fetchProductionKanban()`
- `fetchReceivables()` → kpis{receivableTotal, receivableCount, overdueTotal, overdueCount, monthPayment, depositPending} + rows[]
- `fetchPayments({month, keyword, owner})` / `savePayment(payload)`
- `fetchReminders({type, owner})` / `fetchReminderCounts()` / `resolveReminder(id)`

核心业务规则（已实现于 api.js，页面照用）：
- 客户阶段：商机 5 段（初步接触→需求确认→已报价→打样中→商务谈判）手动推进；已下单/生产中/已发货/已收款由订单状态自动同步；已流失终态需记录原因，可重新激活。
- 报价流：草稿 →(提交审批)→ 待审批 →(老板通过=已发送, 默认有效期15天 / 驳回=已驳回可改版重提)→ 已发送 →(标记成交=自动生成订单)→ 已成交；已发送过有效期视为已过期；已成交报价不可作废。
- 订单流：已下单 → 生产中 → 已发货 → 已收款；已发货未收齐尾款不可结案（提示先登记回款）。

## 6. 组件与交互规则（强约束）

### 6.1 必须复用的 CSS 组件（styles.css 已冻结，类名不可改）

- 布局：`.page` `.grid` `.grid-2` `.grid-3` `.card` `.card-head` `.card-title` `.card-sub` `.card-foot`
- KPI：`.kpi-grid` `.kpi` `.kpi-label` `.kpi-value` `.kpi-delta`（.up/.down）`.kpi-sub` `.sparkline`（内联 SVG 折线，页面生成）
- 按钮：`.btn` `.btn-primary` `.btn-ghost` `.btn-danger` `.btn-warn` `.btn-sm` `.btn-block` `.is-loading`
- 表单：`.field` `.label` `.input` `.select` `.textarea` `.form-row`（两列）`.form-error` `.req`（必填星）
- 表格：`.table-wrap` `.table`（thead 吸顶在 .table-wrap 内）`.cell-money`
- 徽标：`.badge` `.badge-info` `.badge-warn` `.badge-success` `.badge-danger`（配色映射见 app.js `App.stageMeta` 等）
- 筛选：`.chip`（含 .active）`.search-bar`（图标+输入）
- 浮层：`.drawer`（.wide）`.drawer-head` `.drawer-title` `.drawer-close` `.drawer-body`；`.modal`（.wide）`.modal-head` `.modal-body` `.modal-foot`；`.toast`（由 App 统一）
- 阶段条：`.stage-bar`（10 段客户阶段横向进度）`.stage-dot`（.done/.current/.lost）`.stage-name`
- 时间线：`.timeline` `.tl-item`（.done/.current）`.tl-dot` `.tl-date`
- 看板：`.kanban` `.kan-col` `.kan-col-head` `.kcard`
- 进度：`.progress`（.progress-bar 按内联 width%）`.steps`（工序横条 .step .step-done）
- 其他：`.rank-row` `.empty` `.skeleton`（.sk-card/.sk-line）`.file-chip` `.avatar` `.money`（mono）`.alert-strip`（角色提示条）`.version-tag` `.kv`（标签值对）`.num`

### 6.2 交互铁律

1. 所有动态渲染后必须调用 `App.mountIcons()`。
2. 浮层一律 `App.openDrawer / App.openModal / App.toast`，不自写。
3. 表单：必填校验（红框 `.input.err` + `.form-error` 文案）、提交 loading（App.btnLoading 600ms+）、成功 toast + 列表刷新；api 返回 `{code:1}` 必须 toast msg 并保持表单。
4. 首次进入出 `.skeleton`（api delay 期间），列表空态出 `.empty`（附图标+文案+操作按钮）。
5. 所有金额用 `App.fmtMoney()`（¥ 千分位）且外层 `.money`；大额可同时给 `.kpi-sub`「≈xxx 万」。
6. 日期统一 `YYYY-MM-DD`；相对天数用 `App.relDays()`；逾期天数>0 时红色强调。
7. 角色差异（必须实现 `window.onRoleChange`）：
   - sales=李成峰：客户页只看我的客户（顶部 `.alert-strip`「业务员视角：仅显示我负责的客户」）；工作台 KPI 换「我的业绩」（ownerStats['u2']）+ 排名卡换成「我在组内第 x」；报价/订单/应收/提醒默认按 owner 过滤（可关）；「待审批」仅老板可见操作。
   - finance=孙晓梅：回款页默认全量，「登记回款」按钮高亮 .btn-primary；工作台突出应收/回款 KPI；提醒中心只看收款类。
   - boss=王建国：全量数据 + 审批操作 + 业绩排名。
8. 危险操作（作废/标记流失/驳回）必须二次确认（App.openModal 确认框），流失/驳回必填原因。
9. 阶段推进类按钮文案写清去向（如「推进到 · 需求确认」），失败 toast 原因。
10. 响应式：≤860px 侧栏抽屉化 + 显示 `.bottom-nav`（fixed 底部 5 项）；KPI 2 列；表格容器横向滚动；抽屉全宽；桌面 ≥1024 不塌。
11. 禁止：外部 CDN/字体/图标库、emoji 图标、紫色渐变、lorem 占位、TODO 残留、死链（soon 项除外）。
12. 中文文案像金属制品厂真实口吻（跟单、催尾款、账期、对公转账、承兑汇票、排产、镀锌）。

## 7. 各页交互规格（v2 新增/修改点）

### 工作台 dashboard.js
- 5 张 KPI 卡（本月成交额、本月订单、新增客户、应收欠款、本月回款），每卡右上角 6 点 sparkline（SVG polyline，stroke var(--primary)，应收卡警示琥珀色）；应收卡 sub 行「逾期 n 笔 ¥xxx」红色。
- 趋势卡：6 个月成交/回款双色柱状（div 高度图，非 SVG 库），hover 显示数值。
- 业绩排名卡（老板）：rank-row 前三名奖牌样式；sales 视角换「我的业绩」卡（我的成交/回款/新增/应收 4 数 + 组内排名）。
- 订单阶段分布卡：4 段横向比例条（已下单/生产中/已发货/已收款）。
- 待跟进卡（7 天内，含今天逾期置顶红色）+ 超期未跟进卡（>14 天，琥珀警示）——两卡合并为「今天该做的事」：逾期>今天>7 天内分组。
- 应收明细卡（前 6，逾期行红点 + 逾期天数），点击行跳订单抽屉不可用则只展示。
- reminderCounts 汇总条：四类提醒 chip，点击跳 reminders.html。

### 客户管理 customers.js
- 工具栏：搜索（名称/联系人/电话）+ 行业下拉 + 阶段下拉 + 负责人下拉（老板）+ 「新增客户」主按钮。
- 列表表格列：客户（名称+联系人+电话）/ 行业 / 阶段（badge）/ 负责人 / 累计成交 / 当前欠款（>0 琥珀，逾期红）/ 下次跟进（逾期红）/ 操作（查看）。
- 行点击开抽屉：顶部客户名+阶段徽标+负责人；`.stage-bar` 10 段阶段条（商机段可推进：`.btn-sm`「推进到 · 下一段」；已流失显示原因 + 「重新激活」；订单段显示「由订单自动推进」灰字）。
- 抽屉 4 tab：跟进动态（时间线+「添加跟进」）、报价记录（单号/版本/金额/状态）、订单回款（订单+余额+生产进度%）、客户档案（基本信息+流失原因如有）。
- 新增客户 modal 仅 7 字段：公司名称*、联系人*、电话*、行业、地址、备注、下次跟进日期（调研表要求精简）。
- 添加跟进 modal：方式（电话/微信/拜访/其他）+ 内容* + 下一步计划；拜访自动计次。
- 标记流失：确认 modal + 必填丢单原因（textarea ≥4 字）。

### 报价管理 quotes.js
- 状态 chips：全部/待审批/已发送/草稿/已成交/已过期/已作废；搜索（单号/客户）。
- 列表列：单号+版本 / 客户 / 金额 / 状态 / 有效期（倒计时「n 天后到期」/「已过期 n 天」琥珀红）/ 更新时间 / 操作。
- 待审批行首琥珀左边条 + 老板可见「通过 / 驳回」按钮（驳回必填原因）。
- 行点击开抽屉：头部单号+状态+客户+金额；版本 tab（v1/v2/v3 可切换查看明细表：产品/规格/单位/数量/单价/小计）+「版本对比」视图（两版并排 diff：增删行、数量单价变化、差额% 琥珀/绿色）。
- 操作按状态：草稿→「提交审批」「调整新版本」「作废」；已驳回→「调整新版本」（重提）；已发送→「标记成交」「调整新版本」（改价重新审批）「作废」；成交→查看关联订单号。
- 新建报价 modal：客户下拉* + 产品行（产品下拉带单价自动带出、数量、单价可改、行小计实时算、+增行/删行）+ 备注 + 底部合计大字。
- 标记成交确认后 toast「已生成订单 SO2026-xxx」并提示去订单页。

### 订单管理 orders.js
- 顶部 tab：订单列表 / 生产进度看板。
- 列表列：单号 / 客户 / 金额 / 已付/欠款 / 状态 badge / 账期（逾期红「逾期 n 天」）/ 生产进度%（mini progress）/ 操作「推进」。
- 推进按钮按订单状态显示下一阶段名；已发货未收齐尾款点击推进 → toast 拒绝原因（提示先登记回款）。
- 看板 3 列（已下单/生产中/已发货）：kcard 含单号、客户、金额、负责人；生产中卡显示 6 工序 mini steps + 总进度%；已下单卡显示「定金待收 ¥xx」或「已付定金」；已发货卡显示余额+账期逾期红。列头显示单数与总额。
- 订单抽屉：阶段时间线（stageDates 4 节点）+ 生产工序 progress（若有）+ 回款记录 + 合同附件 file-chip + 操作（推进阶段/登记回款）。

### 回款与应收 payments.js
- KPI 4 卡：应收总额（含笔数）、逾期金额（红，含笔数）、本月回款、待收定金。
- tab：应收明细 / 回款流水。
- 应收列：订单号/客户/负责人/订单额/已收/欠款/账期/逾期天数/状态/操作「登记回款」；逾期行整行浅红底。
- 流水列：日期/客户/订单号/类型（定金 info 尾款 success）/金额/方式/录入人。
- 登记回款 modal：订单下拉（仅未结清）带欠款余额显示、金额*（校验≤欠款，行内错误）、日期默认今天、方式（对公转账/银行承兑/现金/微信）、类型自动（首笔定金）。

### 提醒中心 reminders.js
- 分类 chips：全部 / 待跟进 / 该收款 / 报价到期 / 异常预警（附各自计数）。
- 提醒卡：类型图标色条 + 标题 + 详情 + 到期（今天/明天/n 天后/逾期 n 天 红）+ 负责人 + 「去处理」（跳对应页面）+「标记完成」。
- 已完成置灰移到底部或过滤开关「显示已处理」。
- sales 视角只看 owner=自己；finance 视角默认收款类。

## 8. 验收（主代理统一执行）

静态走查：shell 逐字节 diff、链接/资源存在、无未定义引用、渲染后 mountIcons 已调、api 均接线、空/加载态齐、角色钩子齐、响应式断点齐、账本数字跨页对账一致（应收 1,773,386 / 9 月成交 1,186,988 / 逾期 2 笔）。
