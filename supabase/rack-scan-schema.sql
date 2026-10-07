-- Rack Scan (Main Auditor only). Already applied to project vtcrdkqhuvxatclobsby via migration "rack_scan_tables".
-- Safe to re-run.
create table if not exists public.rack_scan_sessions (
  id uuid primary key default gen_random_uuid(),
  rack_label text,
  status text not null default 'open' check (status in ('open','closed')),
  created_by uuid not null default auth.uid(),
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  signed_off_by text,
  note text
);
create table if not exists public.rack_scan_items (
  id uuid primary key default gen_random_uuid(),
  client_event_id text not null,
  session_id uuid not null references public.rack_scan_sessions(id) on delete cascade,
  product_code text, product_name text, company text, barcode text,
  system_qty numeric not null default 0,
  counted_qty numeric not null default 0,
  diff numeric generated always as (counted_qty - system_qty) stored,
  unit_price numeric not null default 0,
  variance_value numeric generated always as ((counted_qty - system_qty) * unit_price) stored,
  entry_mode text not null default 'counted' check (entry_mode in ('counted','matched_tap')),
  result text not null check (result in ('match','variance','not_in_system')),
  flagged boolean not null default false,
  recounted boolean not null default false,
  note text,
  scanned_by uuid not null default auth.uid(),
  scanned_at timestamptz not null default now(),
  unique (session_id, client_event_id)
);
create index if not exists rack_scan_items_session_idx on public.rack_scan_items(session_id);
create index if not exists rack_scan_items_product_idx on public.rack_scan_items(product_code, scanned_at desc);
alter table public.rack_scan_sessions enable row level security;
alter table public.rack_scan_items enable row level security;
drop policy if exists "rack scan sessions main all" on public.rack_scan_sessions;
create policy "rack scan sessions main all" on public.rack_scan_sessions for all using (is_main_auditor()) with check (is_main_auditor());
drop policy if exists "rack scan items main all" on public.rack_scan_items;
create policy "rack scan items main all" on public.rack_scan_items for all using (is_main_auditor()) with check (is_main_auditor());
create or replace view public.rack_scan_last_verified with (security_invoker = true) as
select distinct on (product_code) product_code, product_name, company, scanned_at as last_verified_at, result, diff
from public.rack_scan_items where product_code is not null order by product_code, scanned_at desc;
