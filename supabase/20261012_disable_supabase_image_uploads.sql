-- Merchant Desk no longer uploads product image files to Supabase Storage.
-- Safe for existing installations: this removes app write policies but intentionally
-- does not delete any existing objects or the old bucket. Copy needed legacy photos
-- to Google Drive first, then delete the old bucket in Supabase Storage if desired.

drop policy if exists "Merchant Desk users upload product images" on storage.objects;
drop policy if exists "Merchant Desk users update own product images" on storage.objects;
drop policy if exists "Merchant Desk users delete own product images" on storage.objects;
