-- ============================================================
-- 龙瀚 CRM Supabase 初始化 SQL
-- 在 Supabase 控制台 → SQL Editor → New query → 粘贴并运行
-- ============================================================

-- 1. 客户表
CREATE TABLE IF NOT EXISTS customers (
  id text PRIMARY KEY,
  name text NOT NULL,
  contact text,
  phone text,
  address text,
  industry text DEFAULT '其他',
  stage text DEFAULT '初步接触',
  owner text,
  next_follow date,
  last_follow date,
  follow_count int DEFAULT 0,
  visit_count int DEFAULT 0,
  created_at date DEFAULT CURRENT_DATE,
  note text,
  lost_reason text
);

-- 2. 报价表
CREATE TABLE IF NOT EXISTS quotes (
  id text PRIMARY KEY,
  no text UNIQUE NOT NULL,
  customer_id text REFERENCES customers(id),
  owner text,
  status text DEFAULT '草稿',
  valid_until date,
  created_at date DEFAULT CURRENT_DATE,
  updated_at date DEFAULT CURRENT_DATE,
  deal_order_id text,
  note text,
  reject_reason text,
  approval jsonb,
  versions jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- 3. 订单表
CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  no text UNIQUE NOT NULL,
  customer_id text REFERENCES customers(id),
  quote_no text,
  owner text,
  amount numeric DEFAULT 0,
  paid numeric DEFAULT 0,
  status text DEFAULT '已下单',
  order_date date DEFAULT CURRENT_DATE,
  payment_due date,
  due_date date,
  stage_dates jsonb DEFAULT '{}'::jsonb,
  production jsonb,
  files jsonb DEFAULT '[]'::jsonb,
  note text
);

-- 4. 回款表
CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,
  date date DEFAULT CURRENT_DATE,
  order_id text REFERENCES orders(id),
  customer_id text REFERENCES customers(id),
  type text DEFAULT '尾款',
  amount numeric NOT NULL,
  method text DEFAULT '对公转账',
  recorder text,
  note text
);

-- 5. 跟进表
CREATE TABLE IF NOT EXISTS followups (
  id text PRIMARY KEY,
  customer_id text REFERENCES customers(id),
  user_id text,
  date date DEFAULT CURRENT_DATE,
  type text DEFAULT '电话',
  content text,
  next text
);

-- 6. 提醒表
CREATE TABLE IF NOT EXISTS reminders (
  id text PRIMARY KEY,
  type text,
  ref_id text,
  title text,
  detail text,
  due_date date,
  owner text,
  status text DEFAULT 'pending'
);

-- 7. 采购表
CREATE TABLE IF NOT EXISTS purchases (
  id text PRIMARY KEY,
  no text UNIQUE NOT NULL,
  title text,
  supplier_id text,
  order_id text,
  requester text,
  status text DEFAULT '待审批',
  created_at date DEFAULT CURRENT_DATE,
  approve_date date,
  pay_date date,
  receive_date date,
  note text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- 8. 手工账
CREATE TABLE IF NOT EXISTS manual_ledgers (
  id text PRIMARY KEY,
  date date DEFAULT CURRENT_DATE,
  type text DEFAULT '支出',
  category text NOT NULL,
  amount numeric NOT NULL,
  recorder text,
  note text
);

-- 9. 供应商
CREATE TABLE IF NOT EXISTS suppliers (
  id text PRIMARY KEY,
  name text NOT NULL,
  contact text,
  phone text,
  category text DEFAULT '其他'
);

-- 10. 产品库
CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY,
  name text NOT NULL,
  spec text,
  unit text DEFAULT '件',
  price numeric DEFAULT 0
);

-- 11. 账号表
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  user_name text UNIQUE NOT NULL,
  phone text,
  position text DEFAULT '业务员',
  initial text,
  pwd text DEFAULT '123456',
  scopes jsonb DEFAULT '[]'::jsonb,
  active boolean DEFAULT true
);

-- 12. 公司 + 设置
CREATE TABLE IF NOT EXISTS meta (
  id int PRIMARY KEY DEFAULT 1,
  today date DEFAULT CURRENT_DATE,
  company text DEFAULT '河北龙瀚金属制品有限公司'
);

CREATE TABLE IF NOT EXISTS settings (
  id int PRIMARY KEY DEFAULT 1,
  deposit_pct int DEFAULT 30
);

-- 13. 关闭 RLS（演示用；正式上线建议打开并配置策略）
ALTER TABLE customers DISABLE ROW LEVEL SECURITY;
ALTER TABLE quotes DISABLE ROW LEVEL SECURITY;
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE followups DISABLE ROW LEVEL SECURITY;
ALTER TABLE reminders DISABLE ROW LEVEL SECURITY;
ALTER TABLE purchases DISABLE ROW LEVEL SECURITY;
ALTER TABLE manual_ledgers DISABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers DISABLE ROW LEVEL SECURITY;
ALTER TABLE products DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE meta DISABLE ROW LEVEL SECURITY;
ALTER TABLE settings DISABLE ROW LEVEL SECURITY;

-- 14. 初始默认账号（admin / admin123）
INSERT INTO users (id, name, user_name, position, initial, pwd, scopes) VALUES
  ('u1', '总经理', 'admin', '总经理', '总', 'admin123', '["*"]'::jsonb)
  ON CONFLICT (id) DO NOTHING;

INSERT INTO meta (id, company) VALUES (1, '河北龙瀚金属制品有限公司')
  ON CONFLICT (id) DO NOTHING;

INSERT INTO settings (id, deposit_pct) VALUES (1, 30)
  ON CONFLICT (id) DO NOTHING;

-- 15. 默认产品库
INSERT INTO products (id, name, spec, unit, price) VALUES
  ('p001', '镀锌角钢', '50×50×5mm Q235B', '吨', 4200),
  ('p002', '热轧卷板', '3.0×1250mm Q235B', '吨', 3640),
  ('p003', '镀锌圆钢', 'Φ20mm Q235B', '吨', 3980),
  ('p004', '不锈钢法兰', 'DN50 PN16 · 304', '件', 148),
  ('p005', '高强螺栓连接副', 'M20×60 · 10.9级', '套', 18),
  ('p006', '镀锌方管', '60×60×3mm', '根', 85),
  ('p007', '中厚板', '10mm Q345B', '吨', 3850),
  ('p008', '金属波纹管', 'DN200 补偿器', '个', 320)
  ON CONFLICT (id) DO NOTHING;
