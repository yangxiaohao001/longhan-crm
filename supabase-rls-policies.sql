-- ============================================================
-- 龙瀚 CRM · RLS 策略（让 anon key 能读写所有表）
-- 在 Supabase SQL Editor 跑这段
-- ============================================================

-- 关闭 RLS（最简单方式）
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

-- 备份方案：如果上面失败（policy 已创建），删 policy
DROP POLICY IF EXISTS "anon_all" ON customers;
DROP POLICY IF EXISTS "anon_all" ON quotes;
DROP POLICY IF EXISTS "anon_all" ON orders;
DROP POLICY IF EXISTS "anon_all" ON payments;
DROP POLICY IF EXISTS "anon_all" ON followups;
DROP POLICY IF EXISTS "anon_all" ON reminders;
DROP POLICY IF EXISTS "anon_all" ON purchases;
DROP POLICY IF EXISTS "anon_all" ON manual_ledgers;
DROP POLICY IF EXISTS "anon_all" ON suppliers;
DROP POLICY IF EXISTS "anon_all" ON products;
DROP POLICY IF EXISTS "anon_all" ON users;
DROP POLICY IF EXISTS "anon_all" ON meta;
DROP POLICY IF EXISTS "anon_all" ON settings;

-- 备份 2：用 policy 允许 anon
-- CREATE POLICY "anon_all" ON customers FOR ALL TO anon USING (true) WITH CHECK (true);
-- 等等 12 张表
