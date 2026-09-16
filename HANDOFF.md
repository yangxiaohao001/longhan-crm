# 龙瀚 CRM 项目交接文档（给 WorkBuddy）

> 写给下一个接手的 AI 助手。请通读本文档后再动代码。最后更新：2026-09-16 第五轮（采购驳回/总经理全域增删改/回款改删，见「第五轮记录」）

---

## ⚡ 第五轮记录（2026-09-16 中午，用户实测 3 项 + 自查补充）

1. ✅ **采购驳回** —— 待审批的采购，总经理行内多一个「驳回」按钮（其他角色看不到），强制填驳回原因（≥4字）；状态「已驳回」红色徽章 + 筛选 chip + 抽屉展示驳回原因。驳回后总经理可直接编辑改回状态，申请人也可改后重新发起。
2. ✅ **总经理编辑/删除采购单** —— 采购抽屉底部总经理可见「编辑采购单 / 删除采购单」。编辑弹窗可改标题/供应商/状态/关联订单/备注/**明细增删改**（合计实时算）；删除已付款的单会红色提示影响记账。
3. ✅ **回款记录总经理可编辑/删除** —— 回款流水每行（总经理/财务）带编辑/删除；保存后**订单已收金额自动重算**，若不再结清状态自动退回「已发货」；删除同样回滚。已付款采购删除时提示影响记账。
4. ✅ **总经理全域权限盘点结果**：客户(编辑/删除✓)、报价(调价/删除✓)、订单(编辑✓ adminUpdateOrder/editOrderModal 已挂接)、采购(本轮补齐)、回款(本轮补齐)、记账(编辑/删除✓)、供应商(✓)、产品库(✓)、账号(✓)。`adminUpdateQuote`（报价整单编辑）api 已有但未接 UI——报价已有调价+删除，暂未接，需要时把 adminUpdateQuote 挂到报价抽屉即可。

**回归**：final_sweep.js 36 项全过，新增六组：业务员建采购→GM驳回（原因落库）→GM编辑（状态+明细）→GM删除；回款 建→GM改（订单 paid 重算 250）→GM删（回滚 0）。**测试注意**：savePayment 返回 `{payment, settled}` 不是扁平对象；_cloudSync 是 fire-and-forget，REST 断言前要等 2.5s。

---

## ⚡ 第四轮记录（2026-09-16 中午，用户实测 6 项反馈）

1. ✅ **新账号登录闪退** —— 根因：`fetchSession()` 用本地 DB.users 判活，但页面刚加载时云端数据未拉回（mock 只有 admin），非 admin 会话被误删踢回登录页。修复：云模式下信任会话（登录时已按云端校验）。
2. ✅ **供应商可输可选** —— 采购弹窗供应商改为输入框+datalist：可输拼音下拉选，输入不存在的名称保存时**自动建档**（不再有「+新增供应商…」跳走重填的破交互）。总经理提交按钮文案区分「自动通过审批」。
3. ✅ **供应商档案改表格** —— 原 field-grid 分类卡片布局（乱）改为标准表格：供应商/分类/联系人/电话/编辑/删除，页面内直接操作。
4. ✅ **记账支出补关联单号 + 总经理可改删** —— 弹窗加「关联单号」输入；手工账行加编辑/删除按钮（回款与采购付款派生的流水仍只读，标注"自动生成"）。技术上单号借 note 字段【】前缀编码存储，免改表结构；若以后可跑 DDL，建议 `ALTER TABLE manual_ledgers ADD COLUMN ref_no text` 并简化 _ledgerNoteEncode/Decode。
5. ✅ **客户阶段 9→6** —— 砍掉 需求确认/打样中/商务谈判。新阶段：初步接触→已报价→已下单→生产中→已发货→已收款（+已流失）。云数据已迁移（打样中→已报价）。涉及 mock.js stages、api.js PRE_DEAL_STAGES、reactivateCustomer 落点、app.js stageMeta、customers.js 推进按钮条件。
6. ✅ **客户换业务员联动** —— adminUpdateCustomer 检测 owner 变更，名下**报价和订单的 owner 一并转移**并逐条同步云端。注：采购与客户无归属关系，不受影响。

**回归**：final_sweep.js 29 项全过（新增：新账号登录后进首页不被闪退、业务员首页正常渲染）；记账 建→改→删 含单号全链路 OK；供应商自动建档+GM采购 OK。测试数据已清理（杂乱测试供应商 111/222/333/444 已删）。

---

## ⚡ 第三轮记录（2026-09-16 上午，用户实测 6 项反馈 + 全系统走查）

1. ✅ **搜索框 UI 一体化**：styles.css 重做 .search-box（图标+输入+按钮一组，flex、聚焦高亮），五个页面统一生效；追加精致化细节（按钮微投影/hover 上浮、表格数字等宽、滚动条、chip 毛玻璃）。
2. ✅ **新账号无法登录的真正根因（两层）**：
   - 第一层：`login.html` 没加载 `db.js` → 登录页永远连不上云端，只认本地 mock 的 admin。已补。
   - 第二层：加上 db.js 后暴露 `login.js` 的**时序崩溃**——账号列表异步渲染，而预填+按钮绑定代码不等它，`querySelector('.login-user')` 为 null 抛异常 → **登录按钮根本没绑上**。已改为 `await renderUsers()` 后再绑定。
   - 教训：给登录页加云能力时，所有 DOM 初始化必须等异步渲染完成。
3. ✅ **数据同步大审计（工具化）**：用脚本扫描 api.js 全部修改型函数，找出 8 处「属性赋值不触发数组钩子」的漏网并全部补上 `_cloudSync`：createQuoteVersion（调价！之前调完刷新就丢）、markQuoteDeal（成交状态）、savePayment（订单 paid/status）、_syncCustomerStage（客户阶段联动）、advancePurchase（采购审批/付款/入库）、saveSupplier（编辑）、resolveReminder、login 会话 userName。
4. ✅ **总经理发起采购免自审批**：savePurchase 里 `App.isBoss()` → 直接「已审批」+ approveDate；其他角色仍走审批。
5. ✅ **供应商种子数据**：云端 suppliers 表是空的（采购流程无法使用），已写入 3 条示例（霸州华信钢材贸易/安平热镀锌加工厂/廊坊鑫达包装材料），可在采购页「供应商管理」里改。
6. ✅ 客户改名**实测是会同步的**（报价/订单的客户名都是实时从客户档案计算的，E2E 已验证改名落库）。用户遇到的不同步大概率是上面第 3 条的调价/成交回退造成的观感。

**回归**：final_sweep.js（工作区）云模式 27 项全过：10 页面渲染、新账号登录、GM 采购免审批、业务员采购需审批、调价云端落库。本地冒烟 20 项全过。测试数据已全部清理（测试账号/测试采购单已删，客户名已还原）。

---

## ⚡ 第二轮记录（2026-09-16 上午，用户实测反馈）

**纠正第三节第 5 点**：本项目部署实际走 **GitHub push → Cloudflare 自动部署**（Git 连接项目没有 zip 上传入口）。桌面 `push-crm.bat` 是一键推送脚本（GitHub 凭证已缓存，双击即推）。

**修了 4 项（用户实测反馈）：**

1. ✅ **订单页一直转圈** —— 根因：`db.js` 从云端读回的行是 snake_case（order_date），代码全用 camelCase（orderDate），orders.js:35 `o.orderDate.slice` 直接 TypeError → 永远骨架屏。**修复：db.js 新增 `_fromRow()`，dbInit/dbList 读回时统一 snake→camel**（系统性修复，payments/followups/user_name 等多词字段全部受益）。orders.js/api.js 的 orderDate 排序处加了空值防御。
2. ✅ **账号管理：编辑后刷新重置、改的密码登不上** —— 根因：数组钩子只拦 push/splice，**属性赋值（u.userName=…）不触发同步**。新建其实能同步（实测落库成功），但编辑登录名/密码/停用切换只写内存。修复：settings.js 增加 `syncUser()`，编辑保存/停用启用/重置密码后显式 `_cloudSync('users','upsert',u)`。
3. ✅ **总经理可删除报价** —— api.js 新增 `deleteQuote()`（已成交并生成订单的拒绝删），quotes.js 抽屉总经理可见「删除报价」按钮 + 二次确认；splice 钩子自动云同步 delete。顺带修掉 submitQuote 里重复的两次 upsert。
4. ✅ **产品库管理** —— 设置页新增「产品库管理」卡片：总经理可增/删/改产品（name/spec/unit/price），增删改均显式云同步 products 表。同时报价弹窗（新建+调价）明细行的**名称/规格也可直接编辑**（换产品自动带出默认值，按改后值保存）——金属加工常做非标，不再受产品库限制。

**回归**：jsdom 连真实 Supabase 云端测试 9 项全过（orders 渲染出真实订单 SO2026-001、设置页产品卡渲染、quotes 正常）；本地 mock 冒烟 20 项全过。测试脚本：工作区 `cloud_test2.js`（云模式）、`smoke_test.js`（本地模式）。**云模式 jsdom 需 polyfill `window.fetch`（supabase-js 依赖它）**。

---

## ⚡ 第一轮记录（2026-09-16 凌晨）

**第四节 5 个待修问题已全部修完**，另修了 3 个交接文档第五节的「高优先级」问题：

1. ✅ 新建客户去掉「指派业务员」下拉（customers.js；owner 固定用 sess.userId；调岗/转移客户走客户抽屉「编辑」）
2. ✅ 五个页面搜索全部改手动触发：customers / quotes / orders / payments / purchase——去掉 300ms 防抖，搜索框旁加「搜索」按钮，回车同样触发
3. ✅ 新建/调价报价：每行单价可编辑（默认带出产品库价，换产品自动带出新默认价）+ 单位可选（吨/根/件/米/套/个/平方，历史单位不在列表时自动追加）
4. ✅ 客户页阶段 chip 显示总数（如「已下单 (3)」）；阶段/行业/关键词全改为前端过滤，chip 数取筛选前全量
5. ✅ scopes 为空兜底：登录时非总经理账号 scopes 空/未配置 → 默认开放 dashboard/customers/quotes/orders/payments/purchase/reminders（api.js `userScopes()`）
6. ✅ `sess.role`/`u.role`/`u.title` 旧字段全部清理，统一 `position`（customers/quotes/dashboard/orders 四个文件）；订单「定金不足强制发货」改 `App.isBoss()`。**注意：此前 `sess.role === 'finance'` 恒为 false，财务只读视图从未生效过，本版修复**
7. ✅ **perm.js 顶层 `const PERM` 与 app.js 重复声明 → 整个 perm.js 在浏览器从未执行过**（SyntaxError，靠 app.js 内联的同名实现兜底，无功能损失但有隐患）。已把 perm.js 包进 IIFE 消除冲突

**回归**：`node --check` 17 个 js 全过；jsdom 冒烟测试 20 项全过（五页面渲染无脚本错误、搜索按钮、chip 计数、报价弹窗控件）。测试脚本在工作区 `smoke_test.js`。

**未做（留给下一版）**：第五节中优先级项（手动建订单入口、自动提醒、手册更新）、安全项（RLS/Auth/密码哈希）、第六节 v2 清单。

---

## 一、项目概况

- **客户**：河北龙瀚金属制品有限公司（拉弯/金属制品厂，约 15 人使用）
- **产品**：龙瀚 CRM（客户/报价/订单/回款/采购/记账/提醒/设置 8 大模块）
- **本地路径**：`D:\Trae solo Demo  01\crm-mvp`
- **线上地址**：https://longhan-crm.pages.dev（Cloudflare Pages，国内可直连）
- **云端数据库**：Supabase（Postgres），13 张表
- **代码仓库**：https://github.com/yangxiaohao001/longhan-crm（main 分支，Cloudflare 已连 Git 自动部署，但用户网络连 GitHub 不稳定，实际多用 zip 手动上传）

### 技术栈
- **纯静态** HTML + CSS + JS，零构建、零框架、零 npm 依赖
- 唯一外部库：supabase-js（已下载到本地 `js/supabase.min.js`，218KB，**不要**改回 CDN 引用——用户网络访问 jsdelivr 不稳定）
- 主题：深色科技风（默认）+ 亮色（顶栏切换按钮，存 localStorage `lh-crm-theme`）

### 账号（云端 users 表现有）
| 登录名 | 密码 | 姓名 | 岗位 |
|---|---|---|---|
| admin | admin123 | 总经理 | 总经理（超管，scopes=['*']）|
| xiaoyang | 123456 | 杨舒皓 | 业务员 |

### 云端凭证（已硬编码进 js/api.js 的 login 兜底逻辑）
- SUPABASE_URL: `https://ddqrpofltnlerjodewxm.supabase.co`
- SUPABASE_ANON_KEY: `sb_publishable_pjMAv7pz5IELDihL5mQ9Qg_F0Y5ulMd`
- 用户浏览器侧也存一份（localStorage `lh-crm-cfg`），设置页可改

---

## 二、文件结构

```
crm-mvp/
├── login.html          登录页（账号列表从云端拉）
├── index.html          驾驶舱（按岗位三种视图：老板/财务/业务员）
├── customers.html      客户
├── quotes.html         报价
├── orders.html         订单（含生产看板、附件上传）
├── payments.html       回款
├── purchase.html       采购（含供应商管理）
├── finance.html        记账
├── reminders.html      提醒
├── settings.html       设置（账号管理/业务规则/云端配置，仅总经理）
├── help.html           内嵌操作手册（10 章）
├── styles.css          全部样式（含亮色主题，html[data-theme="light"]）
├── js/
│   ├── supabase.min.js 本地 supabase-js（勿删勿换 CDN）
│   ├── mock.js         本地数据源 + DB 顶层常量定义
│   ├── api.js          全部业务 API + 云同步钩子 + login
│   ├── app.js          外壳：会话/导航/主题/权限(PERM 内联在文件末尾)
│   ├── db.js           Supabase 适配层（dbInit/dbSync/dbList/dbUpload）
│   ├── perm.js         权限挂载（依赖 app.js 先加载）
│   ├── login.js        登录页逻辑
│   └── [页面名].js      各页 IIFE
├── supabase-init.sql       建表脚本（13 张表 + 初始数据）
├── supabase-rls-policies.sql  关闭 RLS 的脚本（已在用户 Supabase 跑过）
├── DEPLOY.md           部署指南（内容略旧，以本文档为准）
├── build-manual.js     用 docx 库生成 Word 手册的脚本（node build-manual.js）
├── 龙瀚CRM操作手册.docx  当前版手册（改动后需重新生成）
└── push-to-github.ps1  一键 git push 脚本
```

### 脚本加载顺序（**关键，顺序错了全挂**）
```html
<script src="js/supabase.min.js"></script>
<script src="js/mock.js"></script>
<script src="js/api.js"></script>
<script src="js/app.js"></script>
<script src="js/db.js"></script>
<script src="js/perm.js"></script>
<script src="js/页面名.js"></script>
```
原因：`const DB`（mock.js）、`const App`（app.js）都是顶层 const，不是 window 属性；perm.js/db.js 用轮询兜底挂载到 App，但页面脚本必须在 app.js 之后。

---

## 三、核心技术机制（务必理解，都是踩过的坑）

### 1. 数据流：内存 DB + 云同步钩子
- `mock.js` 定义顶层 `const DB = {...}`（本地空数据/产品库/admin 账号）
- 页面脚本 DOMContentLoaded 里**先** `await App.bootstrapFromCloud()`（拉云端 13 张表覆盖 DB）再渲染
- 写操作：先改内存 DB（UI 即时响应），同时异步 upsert/delete 到云
- 云同步两层实现：
  - **数组钩子**（api.js `_patchArray`）：劫持 `DB.customers.push/unshift/splice`，任何数组变更自动 `_cloudSync`
  - **返回点显式调用**：字段直接赋值（如 `q.status = '已成交'`）不会触发钩子，所以在 `return { code:0, data: _view(x) }` 前手动加了 `_cloudSync('表名','upsert', x)`（约 24 处）。**新增写操作时记得加**
- ⚠️ 曾经的致命 bug：dbInit 写的是 `window.DB`（不存在），而真实 DB 是顶层 const —— 已修。**不要用 window.DB**

### 2. 字段命名映射
- 内存 DB 用 camelCase（`customerId/orderDate/nextFollow`），Supabase 表用 snake_case（`customer_id/order_date/next_follow`）
- `db.js` 的 `_toRow()` 自动转换 camel→snake
- ⚠️ **空日期字符串必须过滤**（`_DATE_FIELDS` 集合）：Supabase date 列不接受 `""`，否则 upsert 报 `invalid input syntax for type date`

### 3. RLS 状态：全部关闭
- 所有表 `DISABLE ROW LEVEL SECURITY`（anon key 可读写全部数据）
- 这是 MVP 取舍；**安全性依赖 anon key 不泄露**，但 key 硬编码在前端，**任何拿到网址的人都能直接读写数据库**。下一版本必须换 Supabase Auth + RLS 策略

### 4. 会话
- localStorage `lh-crm-session` 存 {userId, name, position, scopes, ...}
- 登录校验顺序：云模式(dbList users) → 未配云端则用 api.js 里硬编码的凭证兜底 → 最后本地 DB（仅 admin）
- 权限：`App.isBoss()`（position==='总经理' 恒真）；其他岗位看 `scopes` 数组（总经理在设置页勾选）

### 5. 部署
- 用户网络：GitHub 时通时断，Vercel 完全不通（超时），Cloudflare Pages 可用
- **实际部署方式**：本地打包 zip → Cloudflare 控制台 → longhan-crm 项目 → Create deployment → 拖 zip
- 打包命令（PowerShell）：
```powershell
Get-ChildItem -Path . -Recurse -File | Where-Object { $_.FullName -notlike '*\node_modules*' -and $_.FullName -notlike '*\.git\*' -and $_.Name -notlike '~$*' -and $_.Name -ne '龙瀚CRM操作手册.docx' -and $_.Name -ne 'build-manual.js' -and $_.Name -ne 'extracted-requirements.md' -and $_.Name -ne 'check-classes.ps1' -and $_.Name -ne 'push-to-github.ps1' -and $_.Name -ne '.gitignore' -and $_.Name -ne '.edgeone-ignore' } | Compress-Archive -DestinationPath '..\crm-mvp-deploy.zip' -Force
```
- 本地调试：`python -X utf8 -S -m http.server 8765` → http://localhost:8765/login.html

---

## 四、⏳ 用户最新反馈的 5 个待修问题（未动工，含代码位置）

### 1. 新建客户去掉「指派业务员」下拉
- 位置：`js/customers.js` 约 237-240 行（`App.can('customer.editAll')` 分支里的 `#nOwner` select）
- 原因：代码还在用旧字段 `u.role === 'sales'` 和 `u.title`（账号体系已改为 `position`），下拉本来就是空的
- 修法：整个条件块删除；保存时 `owner` 直接用当前登录人 `sess.userId`（258 行已有兜底）
- 员工调岗/转移客户 → 保留在客户抽屉的「编辑」（总经理）里做

### 2. 客户搜索改为手动触发
- 位置：`js/customers.js` 约 63-66 行 `kwInput` 的 input 事件（当前 300ms 防抖自动搜）
- 用户明确要求：**输完自己点搜索按钮再刷新结果**
- 修法：去掉 input 监听，在搜索框旁加「搜索」按钮（click/回车触发 renderList）
- ⚠️ 全局排查：orders/quotes/payments/purchase 页都是同样的自动防抖模式，**统一都改成按钮触发**（用户说的是交互习惯问题，不是单页问题）

### 3. 新建报价：产品明细和单价可编辑
- 位置：`js/quotes.js` `addModal()`（约 240 行起）
- 现状：明细行=产品下拉（只读价格）+数量，价格取 `products.price` 固定值
- 修法：每行加「单价」input（默认带出产品库价格，可改），小计=数量×单价实时算
- 注意保存时用改后单价写入 items；`createQuoteVersion`（调价弹窗 `adjustModal`）同样处理

### 4. 报价单位可选【根/件/米/吨】等
- 位置：同上 `addModal()`/`adjustModal()`
- 现状：单位跟随产品库 `unit` 固定
- 修法：每行加「单位」select，选项：吨/根/件/米/套/个/平方（含产品默认值）
- `saveQuote`/`createQuoteVersion` 的 items 里 unit 已是透传字段，后端无需改

### 5. 客户页各阶段显示总数
- 位置：`js/customers.js` 列表顶部 stage chips（约 34 行）
- 修法：chip 文案改成 `已下单 (3)` 形式；数据从 `fetchCustomers` 全量结果统计（注意要在**筛选前**的集合上数，建议单独拉一次全量或复用上一次结果）
- 顺带：行业下拉也可加数量（低优先级）

---

## 五、自查发现的其他问题（按优先级）

### 高（本版就该修）
1. **新员工登录后看不到任何模块**：云端 users 行的 `scopes` 可能为 null（手动建的账号没勾模块时）。修法：login 时 scopes 为空的话给业务员默认 scopes（客户/报价/订单/回款/采购/提醒）；或设置页强制至少勾 1 项
2. **accounts.js 里 `u.role`/`u.title` 旧字段残留**：customers.js 239 行、orders.js 287 行 `App.session().role === 'boss'`（应删或改 position）——全局 grep `\.role\b|\.title\b` 清一遍
3. **orders.js IIFE 顶层 `let sess = null` 但 173/336 行已改用 App.session()**：其他页面（quotes/payments/customers）顶层也有 `const sess = App.session()`，登录前加载时为 null 的隐患仍在——统一改成用时再取

### 中（修完上面顺手做）
4. 报价「标记成交」后生成的订单 `files` 字段默认 `[]`，但云端 orders.files 是 jsonb，空数组 OK；而直接手写订单（无此入口）暂缺——订单目前只能从报价转，用户如果问「手动建单」，要么加「+新建订单」按钮，要么告知流程
5. `reminders` 表是死的（mock 里已清空），提醒页空——下一版做自动提醒生成
6. help.html 和 Word 手册内容落后于系统（无供应商管理、无亮色主题说明）——改完 5 个问题后重新生成（node build-manual.js，需 `npm install docx`）

### 安全（下一版本必须）
7. **RLS 全关 + anon key 前端硬编码** = 任何人拿到网址即可读写全部数据（包括改 pwd、删客户）。下一版：换 Supabase Auth（邮箱+密码登录）、RLS 按角色限权、密码哈希存储
8. 密码明文存在云端 users.pwd

---

## 六、下一版本（v2）建议清单（给用户讨论用）

| 功能 | 说明 | 优先级 |
|---|---|---|
| Supabase Auth + RLS | 真登录态、数据隔离、密码加密 | ★★★ |
| 车间生产填报 | 工序进度由车间在手机上点选填报 | ★★★（调研表勾选）|
| 开票管理 | 发票登记、开票状态跟踪 | ★★ |
| Excel 批量导入客户 | 用户有现成 Excel 老客户 | ★★★ |
| 自动提醒生成 | 按跟进日期/账期/报价到期自动建 reminders | ★★ |
| 客户字段扩展 | 客户来源/等级(ABC)/账期 | ★ |
| 数据导出 | 对账单导出 Excel/打印 | ★★ |
| 手机端优化 | 目前响应式可用，交互可再打磨 | ★ |
| 操作日志 | 谁改了什么（审计）| ★ |

---

## 七、部署与验收流程（改完代码后）

1. 本地起服务回归：`python -X utf8 -S -m http.server 8765`
2. 无痕窗口走查：登录(admin) → 客户增删改 → 报价新建/调价/成交 → 订单推进/登记回款 → 采购全流程 → 记账 → 提醒 → 设置加账号 → **无痕窗口用新账号登录**
3. 云端抽查：Supabase Table Editor 看 customers/users 等表数据是否同步
4. 打包 zip（见第三节命令）→ Cloudflare → longhan-crm → Create deployment → 拖 zip
5. 验证线上：https://longhan-crm.pages.dev 硬刷新（Ctrl+Shift+R）
6. 更新手册：改 build-manual.js 里对应章节 → `npm install docx && node build-manual.js` → 重新生成 Word

### 验收口径（老板看数字）
- 客户/订单/回款三个列表数字与 Supabase 表行数一致
- 刷新任意页面数据不丢（云同步正常）
- 新建员工 → 员工自己电脑能登录并看到勾选的模块
- 总经理能编辑/删除任何单据

---

## 八、和用户协作的注意事项

- 用户电脑操作水平一般，指导要逐步截图级；GitHub 时通时断，别依赖 git push，**zip 上传是主路径**
- 用户积分有限，改动尽量一次打包一批，避免频繁来回
- 用户说话直接，需求以他最新一条消息为准（他多次推翻之前的选择）
- 所有 UI 文案用简体中文；金额 `App.fmtMoney()`；日期 `YYYY-MM-DD`
- 改动后必跑：`node --check js/*.js` 全部通过再打包

---

*本文档由 ZCode 在项目移交时生成。接手后请先跑一遍第七节的回归流程熟悉系统。*
