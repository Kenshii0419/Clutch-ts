-- ============================================================================
-- Migration 001: Iloilo Marketplace Enhancements (Backward-Compatible)
-- Run safely in Supabase SQL Editor on an existing deployment.
-- Preserves all existing records, tables, functions, and triggers.
-- ============================================================================

-- 1. Default currency to Philippine Peso (PHP) for new rows (keeps existing rows intact)
alter table public.products alter column currency set default 'PHP';
alter table public.orders alter column currency set default 'PHP';
alter table public.payments alter column currency set default 'PHP';
alter table public.sales_events alter column currency set default 'PHP';

-- 2. Performance indexes for marketplace discovery & storefront queries
create index if not exists idx_products_published_feed
  on public.products(status, moderation_status, created_at desc);

create index if not exists idx_shops_active
  on public.shops(is_active, created_at desc);

-- 3. Tighten public product visibility so drafts/pending/rejected listings
--    are only visible to their seller or an administrator.
drop policy if exists "Published products are viewable by everyone" on public.products;
create policy "Published products are viewable by everyone" on public.products
  for select using (
    (status = 'published' and moderation_status = 'approved')
    or auth.uid() = seller_id
    or public.is_marketplace_admin()
  );

-- 4. Allow users to mark their own notifications as read
drop policy if exists "Users update own notifications" on public.notifications;
create policy "Users update own notifications" on public.notifications
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 5. Additive handmade categories (only inserted if slug does not already exist)
insert into public.categories (name, slug, description) values
  ('Handmade Accessories', 'handmade-accessories', 'Bags, pouches, hairpieces, and everyday hand-crafted accents'),
  ('Other Handmade Creations', 'other-handmade', 'Unique small-batch crafts and local artisan keepsakes')
on conflict (slug) do nothing;
