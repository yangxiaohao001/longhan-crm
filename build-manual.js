/* 龙瀚 CRM 操作手册 — 生成 Word 文档 */
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, PageOrientation } = require('docx');
const fs = require('fs');

const C = '#0d9488';          // 主色
const SUB = '#54657c';
const LIGHT_BG = 'F4F6FB';

// 通用：段落（中文 1.3 倍行距 + 2 字符首行缩进）
const P = (text, opts = {}) => new Paragraph({
  spacing: { line: 312, before: 40, after: 60 },
  alignment: AlignmentType.JUSTIFIED,
  ...opts,
  children: [new TextRun({ text, size: 22, font: 'Microsoft YaHei', ...(opts.run || {}) })],
});

const H1 = (text) => new Paragraph({
  text, heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 160 },
  children: [new TextRun({ text, size: 32, bold: true, color: C, font: 'Microsoft YaHei' })],
});
const H2 = (text) => new Paragraph({
  text, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 },
  children: [new TextRun({ text, size: 26, bold: true, color: C, font: 'Microsoft YaHei' })],
});
const H3 = (text) => new Paragraph({
  text, heading: HeadingLevel.HEADING_3, spacing: { before: 180, after: 90 },
  children: [new TextRun({ text, size: 23, bold: true, color: '0f1a2a', font: 'Microsoft YaHei' })],
});

/* 编号步骤块 */
const step = (n, text) => new Paragraph({
  spacing: { line: 312, before: 30, after: 50 },
  children: [
    new TextRun({ text: `${n}. `, bold: true, color: C, size: 22, font: 'Microsoft YaHei' }),
    new TextRun({ text, size: 22, font: 'Microsoft YaHei' }),
  ],
});

/* 小提示（蓝底） */
const tip = (label, text) => new Paragraph({
  spacing: { before: 80, after: 80 },
  shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'E6F4F1' },
  children: [
    new TextRun({ text: `【${label}】 `, bold: true, color: C, size: 22, font: 'Microsoft YaHei' }),
    new TextRun({ text, size: 22, font: 'Microsoft YaHei' }),
  ],
});

/* 警示（黄底） */
const warn = (text) => new Paragraph({
  spacing: { before: 80, after: 80 },
  shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FFF7E6' },
  children: [new TextRun({ text: '⚠ ' + text, size: 22, font: 'Microsoft YaHei', color: '8a4b00' })],
});

/* 表格 */
const t = (headers, rows) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: {
    top: { style: BorderStyle.SINGLE, size: 6, color: 'cccccc' },
    bottom: { style: BorderStyle.SINGLE, size: 6, color: 'cccccc' },
    left: { style: BorderStyle.NONE, size: 0 },
    right: { style: BorderStyle.NONE, size: 0 },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'dddddd' },
    insideVertical: { style: BorderStyle.NONE, size: 0 },
  },
  rows: [
    new TableRow({
      tableHeader: true,
      children: headers.map(h => new TableCell({
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: C },
        children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: 'ffffff', size: 22, font: 'Microsoft YaHei' })] })],
      })),
    }),
    ...rows.map((row, i) => new TableRow({
      children: row.map(c => new TableCell({
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: i % 2 ? LIGHT_BG : 'ffffff' },
        children: [new Paragraph({ children: [new TextRun({ text: c, size: 22, font: 'Microsoft YaHei' })] })],
      })),
    })),
  ],
});

const children = [
  /* 封面 */
  new Paragraph({ spacing: { before: 2000 }, children: [] }),
  new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [new TextRun({ text: '龙瀚 CRM', size: 80, bold: true, color: C, font: 'Microsoft YaHei' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 120 },
    children: [new TextRun({ text: '操 作 手 册', size: 44, color: '0f1a2a', font: 'Microsoft YaHei' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 800 },
    children: [new TextRun({ text: '河北龙瀚金属制品有限公司', size: 26, color: SUB, font: 'Microsoft YaHei' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: '总经理专享 · 一页通读上手', size: 22, color: SUB, font: 'Microsoft YaHei' })],
  }),
  new Paragraph({ children: [new PageBreak()] }),

  /* 目录 */
  H1('一、目录'),
  step('1', '账号与登录'),
  step('2', '客户管理（建档、跟进、丢单）'),
  step('3', '报价管理（询价 → 调价 → 成交）'),
  step('4', '订单管理（建单 → 推进 → 编辑 → 删除）'),
  step('5', '回款登记（定金 / 尾款）'),
  step('6', '采购管理（申请 → 审批 → 付款 → 入库）'),
  step('7', '记账（月度收支、应付、流水）'),
  step('8', '提醒中心（4 类提醒、去处理）'),
  step('9', '总经理专属（账号、设置、Supabase 云端）'),
  step('10', '常见问题'),
  new Paragraph({ children: [new PageBreak()] }),

  /* 一、登录 */
  H1('一、账号与登录'),
  P('每个员工有独立的登录名 + 密码，登录后只能看到自己岗位需要的页面。系统会自动记住登录状态，刷新不退出。'),
  H2('1. 打开系统'),
  step(1, '电脑 / 手机浏览器，输入公司发的网址（如 https://crm.你的域名.com）'),
  step(2, '默认账号：' ),
  P('  · 总经理：admin   密码：admin123（首次登录后请到「设置」改密码）', { run: { bold: true, color: C } }),
  P('  · 业务员 / 财务 / 内勤：由总经理在「设置 → 账号管理」添加后会拿到自己的账号', {}),
  H2('2. 切换暗 / 亮主题'),
  step(1, '点击顶栏右上角小图标，可在「暗色（科技感）」与「亮色（商务感）」之间切换'),
  step(2, '系统记住你的选择，下次进来仍是上次的主题'),
  H2('3. 退出登录'),
  step(1, '左侧栏底部，点击「退出」按钮（红色闸刀图标）'),
  new Paragraph({ children: [new PageBreak()] }),

  /* 二、客户 */
  H1('二、客户管理'),
  P('「客户」页是销售工作台：在这里建档、记跟进、推阶段、催回款。'),
  H2('1. 新建客户'),
  step(1, '点击列表右上角「+ 新建客户」按钮'),
  step(2, '必填：公司名称、联系人、联系电话；选填：行业、地址、备注'),
  step(3, '点击「建档」，客户默认进入「初步接触」阶段'),
  H2('2. 查找客户'),
  step(1, '列表顶部「阶段」可一键切换：初步接触 / 需求确认 / 已报价 / 打样中 / 商务谈判 / 已下单 / 生产中 / 已发货 / 已收款 / 已流失'),
  step(2, '列表顶部「行业」可筛选机械制造 / 电气设备 / 钢结构等'),
  step(3, '右侧搜索框：输入公司名、联系人、电话任意关键字，回车即可'),
  H2('3. 客户详情抽屉'),
  step(1, '点击客户名进入抽屉，顶部 4 个数字卡：当前阶段 / 累计成交 / 当前欠款 / 跟进次数'),
  step(2, '下方「阶段条」显示客户处于整个销售流程的哪一步'),
  H2('4. 记一笔跟进'),
  step(1, '在客户详情抽屉点「记一笔跟进」'),
  step(2, '选方式（电话 / 微信 / 拜访），填内容（聊了什么），可填「下一步」'),
  step(3, '保存后跟进时间自动更新，侧栏提醒自动刷新'),
  H2('5. 推进客户阶段'),
  step(1, '在客户详情抽屉点「推进到下一阶段」'),
  step(2, '系统会从「初步接触 → 需求确认 → 已报价 → 打样中 → 商务谈判」依次推进'),
  step(3, '「已下单」之后的阶段由订单状态自动同步，不需要手动推进'),
  H2('6. 标记流失（丢单）'),
  step(1, '在客户详情抽屉点「标记流失」'),
  step(2, '必须填写「丢单原因」至少 4 个字（用于复盘）'),
  step(3, '客户进入「已流失」状态，可随时「重新激活」'),
  H2('7. 总经理专属：编辑 / 删除任何客户'),
  step(1, '打开客户详情抽屉，右上角有「编辑」「删除」按钮'),
  step(2, '可改任何字段：名称、联系人、电话、地址、行业、业务员、阶段'),
  step(3, '删除会同时删除该客户的报价、订单、回款、跟进记录（请谨慎）'),
  new Paragraph({ children: [new PageBreak()] }),

  /* 三、报价 */
  H1('三、报价管理'),
  P('从询价到成交，完整流程：建草稿 → 提交审批 → 老板通过 → 标记成交自动生成订单。'),
  H2('1. 新建报价（草稿）'),
  step(1, '进入「报价」页，点右上角「+ 新建报价」'),
  step(2, '选客户 → 选产品（系统预置 8 种常用钢材：镀锌角钢、热轧卷板、中厚板、不锈钢法兰等）→ 填数量'),
  step(3, '保存为「草稿」状态，可继续编辑'),
  H2('2. 提交审批'),
  step(1, '打开报价 → 抽屉右下角点「提交审批」'),
  step(2, '状态变为「待审批」；总经理会在自己页面顶部「待你审批」里看到红点'),
  H2('3. 总经理审批'),
  step(1, '总经理在「报价」页顶部「待你审批」表格里点「通过并发送」'),
  step(2, '系统自动加 15 天有效期（可在设置里调）→ 报价发给客户'),
  step(3, '若驳回：填原因，状态变为「已驳回」'),
  H2('4. 调价（追加新版本）'),
  step(1, '客户要求降价时，在已发送的报价详情点「调价」'),
  step(2, '改单价或数量 → 提交'),
  step(3, '系统自动生成新版本（v2、v3…），若原状态是「已发送/已成交」会自动回到「待审批」由总经理批复'),
  H2('5. 标记成交（自动生成订单）'),
  step(1, '客户同意后，在报价详情点「标记成交」'),
  step(2, '系统按当前版本的金额自动生成「已下单」订单，金额自动同步'),
  step(3, '客户阶段自动从「商务谈判」推到「已下单」'),
  tip('脱单', '「标记成交」= 脱单。点完后系统自动转成订单，业务员不用手动建单。'),
  H2('6. 总经理专属：编辑 / 删除报价'),
  step(1, '打开报价详情抽屉，右上角有「编辑」/「删除」'),
  step(2, '可改状态（草稿/已发送/已成交）、有效期、备注'),
  new Paragraph({ children: [new PageBreak()] }),

  /* 四、订单 */
  H1('四、订单管理'),
  P('订单全生命周期 4 段：已下单 → 生产中 → 已发货 → 已收款。每段都有明确时间点，可一眼看出卡在哪。'),
  H2('1. 新建订单'),
  step(1, '通常是「从报价 → 标记成交」自动生成（推荐）；也可在「订单」页直接新建'),
  step(2, '手动新建：点「订单」页右上角「+ 新建订单」，填客户、金额、定金比例'),
  H2('2. 订单状态推进'),
  P('在订单详情抽屉右下角有「→ 推进到下一阶段」按钮：'),
  step(1, '已下单 → 生产中：登记定金到账后推进'),
  step(2, '生产中 → 已发货：需要定金 ≥ 设置的比例（默认 30%）'),
  step(3, '已发货 → 已收款：尾款收齐后系统自动结案'),
  tip('发货卡住？', '如果定金还没收够，发货按钮会提示「定金不足」。业务员会被拦截，必须由总经理点「老板确认发货」才能强行推进。'),
  H2('3. 登记回款'),
  step(1, '在订单详情抽屉点「登记回款」'),
  step(2, '选类型（定金 / 尾款 / 部分尾款）→ 填金额 → 选支付方式（对公转账/银行承兑/微信）→ 保存'),
  step(3, '系统自动更新订单已收款、欠款，回款流水进「回款」页'),
  H2('4. 订单附件（合同/技术协议/图纸/现场照片）'),
  step(1, '在订单详情抽屉底部点「上传附件」'),
  step(2, '支持 PDF / Word / Excel / 图片（DWG 图纸也支持）'),
  step(3, '已上传的附件在抽屉显示，点击直接预览/下载；总经理可删除附件'),
  tip('云存储', '配置 Supabase 后附件自动存云；未配置时存本机浏览器，建议尽快配置。'),
  H2('5. 生产进度看板'),
  step(1, '在「订单」页右上角点「生产看板」切换视图'),
  step(2, '三列泳道：已下单（待排产）→ 生产中（按完工率排序）→ 已发货（按逾期天数排）'),
  step(3, '点击任意卡片 = 打开订单详情'),
  H2('6. 总经理专属：编辑 / 删除订单'),
  step(1, '在订单详情抽屉右下角点「编辑订单」'),
  step(2, '可改：金额、已收款、状态、订单日期、交期、约定付款日、业务员、关联报价单号、备注'),
  step(3, '可「删除」订单（会同时删除关联回款）'),
  warn('改金额不会自动补回款流水。如有差异，请去「回款」页调整。'),
  new Paragraph({ children: [new PageBreak()] }),

  /* 五、回款 */
  H1('五、回款登记'),
  P('「回款」页是财务管理的主入口：应收欠款明细 + 回款流水 + 一键登记。'),
  H2('1. 登记回款'),
  step(1, '在「回款」页顶部点「登记回款」'),
  step(2, '选订单（自动显示剩余应收）→ 填金额（不能超过剩余）→ 选类型、方式、日期 → 保存'),
  step(3, '若尾款已结清，订单自动结案为「已收款」'),
  H2('2. 应收欠款明细'),
  P('列表按「逾期天数」倒序排，超期订单有红色光脉冲标签。点击订单号进入订单详情。'),
  H2('3. 回款流水'),
  P('所有回款自动按时间倒序列出，可按月份筛选。导出对账单建议每月月底做一次。'),
  new Paragraph({ children: [new PageBreak()] }),

  /* 六、采购 */
  H1('六、采购管理'),
  P('流程：业务员 / 老板发起 → 老板审批 → 财务付款 → 仓管确认入库。'),
  H2('1. 发起采购申请'),
  step(1, '进入「采购」页，点「+ 发起采购申请」'),
  step(2, '填标题（如「SO2026-058 冲压件批次备料」）、选供应商、加明细（品名/规格/数量/单价）'),
  step(3, '可选「关联订单」表示这次采购是给哪个订单备的料'),
  step(4, '提交后状态为「待审批」'),
  H2('2. 老板审批'),
  step(1, '在「采购」页「待审批」单子点「审批通过」'),
  step(2, '状态变为「已审批」，等财务付款'),
  H2('3. 财务付款'),
  step(1, '财务 / 总经理在「已审批」单子点「登记付款」'),
  step(2, '状态变为「已付款」'),
  H2('4. 仓管确认入库'),
  step(1, '在「已付款」单子点「确认入库」'),
  step(2, '状态变为「已入库」，流程结束'),
  H2('5. 供应商档案'),
  P('「采购」页底部有供应商档案：钢材 / 镀锌外协 / 辅料 / 物流四类。后续可加更多。'),
  new Paragraph({ children: [new PageBreak()] }),

  /* 七、记账 */
  H1('七、财务记账'),
  P('「记账」页是「看钱」的入口：收入（自动来自回款） + 支出（采购付款 + 手工账）= 净流入。'),
  H2('1. 月度概览'),
  P('顶部 5 个数字：收入 / 支出 / 净流入 / 应收欠款 / 应付采购款'),
  H2('2. 收支趋势'),
  P('近 6 个月柱状图：左收右支，一眼看清每月是赚是亏。'),
  H2('3. 支出构成'),
  P('本月支出按科目（采购 / 钢材 / 辅料 / 运费 / 工资 / 维修）拆分。'),
  H2('4. 应付采购款'),
  P('显示所有「已审批 / 待审批」还没付款的采购单。'),
  H2('5. 记一笔支出'),
  step(1, '点「+ 记一笔支出」（财务 / 总经理可见）'),
  step(2, '选科目、填金额、选日期、填用途 → 保存'),
  step(3, '工资、运费、水电等日常支出都从这里录'),
  new Paragraph({ children: [new PageBreak()] }),

  /* 八、提醒 */
  H1('八、提醒中心'),
  P('系统按 4 类自动生成提醒：'),
  H2('1. 四类提醒'),
  t(['类型', '示例'], [
    ['待跟进', '该给「衡水北方」打电话了（自动按「下次跟进」时间）'],
    ['该收款', '尾款 ¥156,794 已逾期 14 天'],
    ['报价到期', 'Q2026-072 报价还剩 3 天到期'],
    ['异常预警', '客户「邢台恒信」19 天没跟进了'],
  ]),
  H2('2. 处理提醒'),
  step(1, '进入「提醒」页，按类型筛选'),
  step(2, '点「去处理」= 直接跳到对应单据'),
  step(3, '点「标记已处理」= 任务完成（不会删除，只是标记）'),
  H2('3. 侧栏数字'),
  P('侧栏「提醒」旁的红点数字 = 你账号下所有未处理的提醒数。'),
  new Paragraph({ children: [new PageBreak()] }),

  /* 九、总经理 */
  H1('九、总经理专属'),
  P('总经理（admin）= 超级管理员：能改能删任何单据、能配置系统、能切换云端。'),
  H2('1. 账号管理'),
  step(1, '进「设置」→「账号管理」可看到所有员工'),
  step(2, '点「+ 新增账号」填姓名 / 登录名 / 电话 / 岗位 / 勾选可见模块 → 创建'),
  step(3, '点「编辑」可改任何字段；点「重置密码」可帮员工重置（演示版统一 123456）'),
  step(4, '员工离职：点「停用」即可，该员工立即无法登录，数据保留'),
  H2('2. 业务规则'),
  step(1, '「发货前最低定金比例」：默认 30%。可改成 0~100 任何值'),
  step(2, '该比例影响所有订单的「生产中 → 已发货」校验：定金不足时业务员无法发货，需总经理确认'),
  H2('3. 主题外观'),
  P('员工可在顶栏独立切换暗 / 亮主题。系统不会强加设置。'),
  H2('4. 配置云端（Supabase）—— 启用跨设备同步'),
  P('未配置时：所有数据存本机浏览器（localStorage），不同设备不共享。'),
  P('配置后：数据存 Supabase 云库，所有员工在不同电脑 / 手机打开同一网址都看到一样的数据。'),
  step(1, '去 supabase.com 注册一个免费账号（够 5-15 人用）'),
  step(2, '建一个 Project，把根目录 supabase-init.sql 整个粘到 SQL Editor → Run'),
  step(3, '建一个名为 attachments 的 Public Storage bucket'),
  step(4, '在 Project Settings → API 复制 Project URL 和 anon public key'),
  step(5, '回到 CRM「设置 → 云端」粘贴 URL + key → 测试连接（绿勾）→ 保存'),
  step(6, '刷新页面，所有数据自动上云'),
  H2('5. 数据迁移（从 Excel 导入老客户）'),
  step(1, '在 Supabase 后台 SQL Editor 跑：'),
  P('  INSERT INTO customers (id, name, contact, phone, address, industry, owner, stage, note) VALUES', { run: { font: 'Consolas', size: 20 } }),
  P("  ('c001', 'XX 钢铁', '张总', '139...', '石家庄...', '机械制造', 'u1', '已下单', '老客户');", { run: { font: 'Consolas', size: 20 } }),
  P('  重复更多行，完成后刷新 CRM 即可看到所有客户。', {}),
  new Paragraph({ children: [new PageBreak()] }),

  /* 十、常见问题 */
  H1('十、常见问题'),
  H2('Q1：打开页面一直白屏？'),
  P('A：刷新一次即可。首次加载要从云端拉数据，网络慢会等几秒。如果一直白屏，检查浏览器控制台是否有红色错误。'),
  H2('Q2：忘记密码？'),
  P('A：总经理去「设置 → 账号」点对应账号的「重置密码」，演示版统一重置为 123456。'),
  H2('Q3：员工离职了怎么办？'),
  P('A：去「设置 → 账号」把该员工「启用」关掉，该员工立即无法登录；他的历史数据（客户/订单/回款）保留，不会丢失。'),
  H2('Q4：客户资料能批量导入吗？'),
  P('A：能。把 Excel 整理成 (name, contact, phone, address, industry, owner, stage) 格式，在 Supabase SQL Editor 跑 INSERT 语句。'),
  H2('Q5：手机能用吗？'),
  P('A：能。系统响应式布局，手机访问会自动切换到移动视图（侧栏变底部 5 按钮）。'),
  H2('Q6：数据会不会丢？'),
  P('A：'),
  P('  · 本地演示模式：数据存浏览器，清理浏览器缓存会丢。建议尽快配置 Supabase。'),
  P('  · 云端模式：数据在 Supabase 云库，自动每日备份，比 Excel 安全得多。'),
  H2('Q7：报价改价后旧版本还在吗？'),
  P('A：在的。「报价详情」→ 「版本历史」可看到所有改过的版本，每个版本的金额、明细、时间都保留。'),
  H2('Q8：怎么换公司域名？'),
  P('A：'),
  P('  · Vercel 部署：在 Vercel 项目 → Settings → Domains 添加「crm.你的域名.com」'),
  P('  · 服务器部署：把 crm-mvp 文件夹放到任意 nginx/apache 静态站点即可'),
  H2('Q9：总经理能看到所有人的数据吗？'),
  P('A：能。总经理 = 超级管理员，所有客户的报价、订单、回款都能看能改能删。'),
  H2('Q10：怎么联系技术支持？'),
  P('A：本系统由 ZCode 团队为河北龙瀚金属制品有限公司定制开发。如遇问题，先看本手册；仍无法解决请截图反馈。'),
  new Paragraph({ children: [new PageBreak()] }),

  /* 封底 */
  new Paragraph({ spacing: { before: 2000 }, children: [] }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: '— 操作手册完 —', size: 24, color: SUB, font: 'Microsoft YaHei' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 200 },
    children: [new TextRun({ text: '河北龙瀚金属制品有限公司 · 龙瀚 CRM', size: 22, color: SUB, font: 'Microsoft YaHei' })],
  }),
];

const doc = new Document({
  creator: '龙瀚 CRM',
  title: '龙瀚 CRM 操作手册',
  description: '河北龙瀚金属制品有限公司 CRM 系统操作手册',
  styles: {
    default: {
      document: { run: { font: 'Microsoft YaHei', size: 22 } },
    },
  },
  sections: [{
    properties: {
      page: {
        size: { orientation: PageOrientation.PORTRAIT },
        margin: { top: 1200, right: 1200, bottom: 1200, left: 1200 },
      },
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('D:/Trae solo Demo  01/crm-mvp/龙瀚CRM操作手册.docx', buf);
  console.log('ok,', buf.length, 'bytes');
});
