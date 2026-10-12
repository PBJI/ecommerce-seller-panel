-- Merchant Desk GitHub Pages prototype
-- Run this whole file in Supabase Dashboard -> SQL Editor.
-- This schema stores one private JSON workspace per authenticated user to keep
-- the first single-user-business version simple. The browser never gets a service-role key.

create table if not exists public.merchant_desk_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint merchant_desk_state_state_object check (jsonb_typeof(state) = 'object')
);

alter table public.merchant_desk_state enable row level security;

drop policy if exists "Merchant Desk users read own workspace" on public.merchant_desk_state;
create policy "Merchant Desk users read own workspace"
  on public.merchant_desk_state for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Merchant Desk users insert own workspace" on public.merchant_desk_state;
create policy "Merchant Desk users insert own workspace"
  on public.merchant_desk_state for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Merchant Desk users update own workspace" on public.merchant_desk_state;
create policy "Merchant Desk users update own workspace"
  on public.merchant_desk_state for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.merchant_desk_state to authenticated;

-- Public bucket: intended only for product photos that may be shown on a storefront.
-- Reads are public by design; upload/delete operations are restricted to the owning user folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'merchant-product-images',
  'merchant-product-images',
  true,
  5242880,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Merchant Desk users upload product images" on storage.objects;
create policy "Merchant Desk users upload product images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'merchant-product-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "Merchant Desk users update own product images" on storage.objects;
create policy "Merchant Desk users update own product images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'merchant-product-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'merchant-product-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "Merchant Desk users delete own product images" on storage.objects;
create policy "Merchant Desk users delete own product images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'merchant-product-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
