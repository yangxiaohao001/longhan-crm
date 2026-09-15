# 龙瀚 CRM 部署指南

## 1. 系统能力
- 客户 / 报价 / 订单 / 回款 / 采购 / 记账 / 提醒 / 设置 8 大模块
- 总经理（超管）可改所有单据、删单、覆盖金额
- 暗 / 亮主题切换，记忆偏好
- 多端访问：电脑 / 手机浏览器，输入网址即用
- 两种模式：
  - **本地演示模式**（开箱即用）：数据存浏览器 localStorage，**仅自己电脑可见**
  - **云端生产模式**（推荐上线）：数据存 Supabase 真实云库，**所有员工共享**

## 2. 部署到公网（约 15 分钟）

### 第一步：建 Supabase 项目（5 分钟）
1. 打开 https://supabase.com → Sign up → New project
2. Region 选 Singapore / Tokyo（离中国近），密码设置后等 1~2 分钟初始化
3. 左侧 **Settings → API**，复制：
   - Project URL（形如 `https://xxxxx.supabase.co`）
   - anon public key（一长串 eyJ... 开头的 JWT）
4. 左侧 **SQL Editor → New query**，把本目录下的 `supabase-init.sql` 整个粘进去，点 Run（约 10 秒）
5. 左侧 **Storage → New bucket** → name 填 `attachments` → Public bucket → Save

### 第二步：部署到 Vercel（5 分钟，免费）
1. 把 `crm-mvp` 整个文件夹上传到 GitHub 仓库
2. 打开 https://vercel.com → Sign in with GitHub → Import 该仓库
3. 框架选 "Other" → 直接 Deploy（约 1 分钟出网址，形如 `https://crm-mvp-xxx.vercel.app`）

### 第三步：配置系统（2 分钟）
1. 浏览器打开 Vercel 给的网址 → 用默认账号登录：`admin` / `admin123`
2. 进 **设置 → 云端** → 粘贴第一步复制的 URL + anon key → **测试连接**（绿勾表示成功）→ 保存
3. 刷新页面，所有数据自动上云，**所有员工都能用同一个网址登录了**

### 第四步：把员工加进系统（3 分钟）
1. **设置 → 账号管理 → 新增账号** → 填姓名、登录名、电话、岗位、勾选可见模块 → 创建
2. 把网址发给员工，他们用自己设置的登录名 + 默认密码 `123456` 登录
3. 员工第一次登录后到 **设置** 改自己的密码

## 3. 总经理专属能力
登录 `admin` / `admin123` 后：
- 任何单据右上角都有 **编辑** / **删除** 按钮（金额、日期、状态、付款进度都可改）
- **设置** 页管理所有账号、配置云端、调整规则
- 任何人提交报价待审批时，侧栏「报价」旁出现红点提示

## 4. 数据迁移（已有 Excel 数据）
把所有客户资料整理成下面这个格式（用 Excel 保存为 CSV，上传到 Supabase）：

| name | contact | phone | address | industry | owner | stage | note |
|------|---------|-------|---------|----------|-------|-------|------|
| XX 机械 | 张三 | 139... | 石家庄... | 机械制造 | u1 | 已下单 | 备注 |

在 Supabase SQL Editor 里执行：
```sql
INSERT INTO customers (id, name, contact, phone, address, industry, owner, stage, note) VALUES
  ('c001', 'XX 机械', '张三', '139...', '石家庄...', '机械制造', 'u1', '已下单', '备注');
-- 重复更多行
```

## 5. 维护 & 备份
- 数据在 Supabase 云端，**自动每日备份**，比本地 Excel 安全得多
- 建议每月底在 **回款** 页导出对账单存档
- 员工离职：去 **设置 → 账号** 把"启用"关掉，该员工立即无法登录，历史数据保留

## 6. 常见问题
- **打开页面空白？** 多刷新几次（首次加载要拉云数据）
- **忘记密码？** 总经理去设置里点"重置密码"，演示环境统一重置为 `123456`
- **能否换域名？** 在 Vercel → Settings → Domains 添加 `crm.你的域名.com` 即可
- **多人同时编辑会冲突吗？** 简单场景不会（按时间序保存），如果担心关键数据用微信/电话同步一下
