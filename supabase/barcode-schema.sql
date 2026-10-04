-- ══════════════════════════════════════════════════════════════
-- BARCODE & SCANNER SUBSYSTEM — Supabase migration
-- APPLIED to project BTpharmacyAudit@2026 (vtcrdkqhuvxatclobsby) and role-tested.
-- Run AFTER supabase/schema.sql, in the SQL Editor. Safe to re-run.
--
-- Design rules enforced HERE (not only in the UI):
--   * Clients can never INSERT/UPDATE/DELETE product_barcodes or
--     barcode_verification_log directly. No such policies exist, so RLS
--     denies them. Every change goes through a SECURITY DEFINER function
--     that checks the caller's role and writes the history row in the
--     same transaction. -> no silent reassignment, no silent deletion.
--   * A barcode is globally UNIQUE. A second product claiming it never
--     overwrites it; the existing row is flagged 'conflict' instead.
--   * inventory_products stays the source of truth for products.
--     inventory_products.code is NOT unique/FK-able (the Dropbox sync
--     rewrites that table), so product existence is checked by function.
-- ══════════════════════════════════════════════════════════════

-- ── helpers ────────────────────────────────────────────────────
create or replace function is_dep_or_main_valid()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from staff
    where id = auth.uid() and role in ('main','dep')
      and (access_expires_at is null or access_expires_at > now())
  );
$$;

create or replace function is_main_valid()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from staff
    where id = auth.uid() and role = 'main'
      and (access_expires_at is null or access_expires_at > now())
  );
$$;

create or replace function barcode_product_exists(p_code text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from inventory_products where code = p_code);
$$;

-- ── product_barcodes ───────────────────────────────────────────
create table if not exists product_barcodes (
  id uuid primary key default gen_random_uuid(),
  product_code text not null,
  barcode text not null,
  barcode_type text not null default 'unknown',
  status text not null default 'unverified'
    check (status in ('unverified','verified','conflict','disabled')),
  -- set only while status = 'conflict': the OTHER product that tried to claim this barcode
  conflict_with_product_code text,
  created_by uuid not null references staff(id),
  verified_by uuid references staff(id),
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint product_barcodes_barcode_unique unique (barcode),
  constraint product_barcodes_barcode_format check (barcode ~ '^[A-Za-z0-9._/-]{4,48}$'),
  constraint product_barcodes_verified_has_who
    check (status <> 'verified' or (verified_by is not null and verified_at is not null))
);
create index if not exists product_barcodes_product_code_idx on product_barcodes (product_code);
create index if not exists product_barcodes_status_idx on product_barcodes (status);

-- ── barcode_verification_log ───────────────────────────────────
create table if not exists barcode_verification_log (
  id uuid primary key default gen_random_uuid(),
  barcode text not null,
  product_code text,
  action text not null
    check (action in ('registered','verified','changed','disabled','conflict_resolved','conflict_reported')),
  performed_by uuid not null references staff(id),
  performed_at timestamptz not null default clock_timestamp(),
  notes text
);
create index if not exists barcode_log_barcode_idx on barcode_verification_log (barcode, performed_at desc);

-- ── barcode_scan_events ────────────────────────────────────────
-- client_event_id is minted on the device when the scan happens, so the
-- offline queue can retry the same event any number of times and the
-- server keeps exactly one row (ON CONFLICT DO NOTHING).
create table if not exists barcode_scan_events (
  id uuid primary key default gen_random_uuid(),
  client_event_id text not null unique,
  engagement_id uuid references engagements(id) on delete set null,   -- "audit"
  round_id uuid references rounds(id) on delete set null,
  assignment_id uuid references assignments(id) on delete set null,
  barcode text not null,
  product_code text,
  scan_type text not null check (scan_type in ('identify','count','recount','verification')),
  result text not null check (result in ('matched','unknown','conflict','duplicate','disabled')),
  user_id uuid not null default auth.uid() references staff(id),
  scanned_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists barcode_scan_events_audit_idx on barcode_scan_events (engagement_id, round_id, scanned_at desc);
create index if not exists barcode_scan_events_user_idx on barcode_scan_events (user_id, scanned_at desc);

alter table product_barcodes enable row level security;
alter table barcode_verification_log enable row level security;
alter table barcode_scan_events enable row level security;

-- ── RLS: reads ─────────────────────────────────────────────────
-- Sub: everything except 'unverified' (so they still see a clear
--      "disabled"/"conflict" message instead of a misleading "unknown").
-- Dep/Main: everything.
drop policy if exists "barcodes read" on product_barcodes;
create policy "barcodes read" on product_barcodes for select to authenticated
  using (is_access_valid() and (status <> 'unverified' or is_dep_or_main_valid()));

drop policy if exists "barcode log main read" on barcode_verification_log;
create policy "barcode log main read" on barcode_verification_log for select to authenticated
  using (is_main_valid());
drop policy if exists "barcode log dep read own" on barcode_verification_log;
create policy "barcode log dep read own" on barcode_verification_log for select to authenticated
  using (is_dep_or_main_valid() and performed_by = auth.uid());

-- scan events: anyone valid may insert THEIR OWN; read own; dep/main read all
drop policy if exists "scan events insert own" on barcode_scan_events;
create policy "scan events insert own" on barcode_scan_events for insert to authenticated
  with check (is_access_valid() and user_id = auth.uid());
drop policy if exists "scan events read own" on barcode_scan_events;
create policy "scan events read own" on barcode_scan_events for select to authenticated
  using (is_access_valid() and user_id = auth.uid());
drop policy if exists "scan events dep main read all" on barcode_scan_events;
create policy "scan events dep main read all" on barcode_scan_events for select to authenticated
  using (is_dep_or_main_valid());
-- Deliberately NO update/delete policies anywhere in this file.

-- ── internal: write one history row ────────────────────────────
create or replace function _barcode_log(p_barcode text, p_product text, p_action text, p_notes text)
returns void language sql security definer set search_path = public as $$
  insert into barcode_verification_log (barcode, product_code, action, performed_by, notes)
  values (p_barcode, p_product, p_action, auth.uid(), p_notes);
$$;
revoke all on function _barcode_log(text, text, text, text) from public, anon, authenticated;

-- ── register_barcode ───────────────────────────────────────────
-- Deputy/Main. p_verify=true means the user already eyeballed the
-- scan + product on screen and tapped "Verify & Save".
-- Returns {outcome: 'created'|'exists'|'conflict', ...}. Never moves a barcode.
create or replace function register_barcode(
  p_product_code text, p_barcode text, p_barcode_type text default 'unknown',
  p_verify boolean default true, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_existing product_barcodes; v_new_id uuid;
begin
  if not is_dep_or_main_valid() then raise exception 'Not authorised to register barcodes'; end if;
  if not barcode_product_exists(p_product_code) then
    raise exception 'Product code % does not exist in inventory', p_product_code;
  end if;

  insert into product_barcodes (product_code, barcode, barcode_type, status, created_by, verified_by, verified_at)
  values (p_product_code, p_barcode, coalesce(p_barcode_type,'unknown'),
          case when p_verify then 'verified' else 'unverified' end, auth.uid(),
          case when p_verify then auth.uid() end, case when p_verify then now() end)
  on conflict (barcode) do nothing
  returning id into v_new_id;

  if v_new_id is not null then
    perform _barcode_log(p_barcode, p_product_code, 'registered', p_notes);
    if p_verify then perform _barcode_log(p_barcode, p_product_code, 'verified', p_notes); end if;
    return jsonb_build_object('outcome','created','id',v_new_id);
  end if;

  select * into v_existing from product_barcodes where barcode = p_barcode;
  if v_existing.product_code = p_product_code then
    return jsonb_build_object('outcome','exists','status',v_existing.status);
  end if;

  -- Belongs to a different product: flag, never overwrite.
  update product_barcodes
     set status = 'conflict', conflict_with_product_code = p_product_code, updated_at = now()
   where barcode = p_barcode;
  perform _barcode_log(p_barcode, p_product_code, 'conflict_reported',
    'Claimed by ' || p_product_code || ' but already linked to ' || v_existing.product_code ||
    coalesce('. ' || p_notes, ''));
  return jsonb_build_object('outcome','conflict','existing_product_code',v_existing.product_code);
end $$;

-- ── verify_barcode ─────────────────────────────────────────────
create or replace function verify_barcode(p_barcode text, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v product_barcodes;
begin
  if not is_dep_or_main_valid() then raise exception 'Not authorised to verify barcodes'; end if;
  select * into v from product_barcodes where barcode = p_barcode for update;
  if not found then raise exception 'Unknown barcode'; end if;
  if v.status = 'verified' then return; end if;
  if v.status = 'conflict' then raise exception 'Barcode is in conflict - resolve it first'; end if;
  if v.status = 'disabled' and not is_main_valid() then
    raise exception 'Only a Main Auditor can re-enable a disabled barcode';
  end if;
  update product_barcodes set status='verified', verified_by=auth.uid(), verified_at=now(), updated_at=now()
   where barcode = p_barcode;
  perform _barcode_log(p_barcode, v.product_code, 'verified', p_notes);
end $$;

-- ── change_barcode (re-point to another product) — Main only ───
create or replace function change_barcode(p_barcode text, p_new_product_code text, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare v product_barcodes;
begin
  if not is_main_valid() then raise exception 'Only a Main Auditor can change a barcode mapping'; end if;
  if coalesce(trim(p_notes),'') = '' then raise exception 'A reason is required'; end if;
  if not barcode_product_exists(p_new_product_code) then
    raise exception 'Product code % does not exist in inventory', p_new_product_code;
  end if;
  select * into v from product_barcodes where barcode = p_barcode for update;
  if not found then raise exception 'Unknown barcode'; end if;
  update product_barcodes
     set product_code = p_new_product_code, status='verified', conflict_with_product_code = null,
         verified_by = auth.uid(), verified_at = now(), updated_at = now()
   where barcode = p_barcode;
  perform _barcode_log(p_barcode, p_new_product_code, 'changed',
    'From ' || v.product_code || ' to ' || p_new_product_code || '. ' || p_notes);
end $$;

-- ── disable_barcode — Main only ────────────────────────────────
create or replace function disable_barcode(p_barcode text, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare v product_barcodes;
begin
  if not is_main_valid() then raise exception 'Only a Main Auditor can disable a barcode'; end if;
  if coalesce(trim(p_notes),'') = '' then raise exception 'A reason is required'; end if;
  select * into v from product_barcodes where barcode = p_barcode for update;
  if not found then raise exception 'Unknown barcode'; end if;
  update product_barcodes set status='disabled', conflict_with_product_code = null, updated_at=now()
   where barcode = p_barcode;
  perform _barcode_log(p_barcode, v.product_code, 'disabled', p_notes);
end $$;

-- ── report_barcode_conflict — Dep/Main may flag, never resolve ─
create or replace function report_barcode_conflict(p_barcode text, p_claimed_product_code text, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v product_barcodes;
begin
  if not is_dep_or_main_valid() then raise exception 'Not authorised'; end if;
  select * into v from product_barcodes where barcode = p_barcode for update;
  if not found then raise exception 'Unknown barcode'; end if;
  if v.product_code = p_claimed_product_code then raise exception 'Barcode already belongs to that product'; end if;
  update product_barcodes set status='conflict', conflict_with_product_code=p_claimed_product_code, updated_at=now()
   where barcode = p_barcode;
  perform _barcode_log(p_barcode, p_claimed_product_code, 'conflict_reported', p_notes);
end $$;

-- ── resolve_barcode_conflict — Main only ───────────────────────
-- p_resolution: 'keep' (existing mapping stands), 'reassign' (move to the
-- claiming product), 'disable' (neither; retire the barcode).
create or replace function resolve_barcode_conflict(p_barcode text, p_resolution text, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare v product_barcodes; v_target text;
begin
  if not is_main_valid() then raise exception 'Only a Main Auditor can resolve conflicts'; end if;
  if coalesce(trim(p_notes),'') = '' then raise exception 'A reason is required'; end if;
  if p_resolution not in ('keep','reassign','disable') then raise exception 'Invalid resolution'; end if;
  select * into v from product_barcodes where barcode = p_barcode for update;
  if not found then raise exception 'Unknown barcode'; end if;
  if v.status <> 'conflict' then raise exception 'Barcode is not in conflict'; end if;

  if p_resolution = 'keep' then
    update product_barcodes set status='verified', conflict_with_product_code=null,
           verified_by=auth.uid(), verified_at=now(), updated_at=now() where barcode=p_barcode;
    v_target := v.product_code;
  elsif p_resolution = 'reassign' then
    v_target := v.conflict_with_product_code;
    if v_target is null or not barcode_product_exists(v_target) then
      raise exception 'Claiming product no longer exists in inventory';
    end if;
    update product_barcodes set product_code=v_target, status='verified', conflict_with_product_code=null,
           verified_by=auth.uid(), verified_at=now(), updated_at=now() where barcode=p_barcode;
  else
    update product_barcodes set status='disabled', conflict_with_product_code=null, updated_at=now()
     where barcode=p_barcode;
    v_target := v.product_code;
  end if;
  perform _barcode_log(p_barcode, v_target, 'conflict_resolved',
    'Resolution: ' || p_resolution || '. Was ' || v.product_code ||
    ', claimant ' || coalesce(v.conflict_with_product_code,'n/a') || '. ' || p_notes);
end $$;

-- Only signed-in users may call the RPCs (each checks its own role).
revoke all on function register_barcode(text,text,text,boolean,text) from public, anon;
revoke all on function verify_barcode(text,text) from public, anon;
revoke all on function change_barcode(text,text,text) from public, anon;
revoke all on function disable_barcode(text,text) from public, anon;
revoke all on function report_barcode_conflict(text,text,text) from public, anon;
revoke all on function resolve_barcode_conflict(text,text,text) from public, anon;
grant execute on function register_barcode(text,text,text,boolean,text) to authenticated;
grant execute on function verify_barcode(text,text) to authenticated;
grant execute on function change_barcode(text,text,text) to authenticated;
grant execute on function disable_barcode(text,text) to authenticated;
grant execute on function report_barcode_conflict(text,text,text) to authenticated;
grant execute on function resolve_barcode_conflict(text,text,text) to authenticated;

-- ── Counting method (audit configuration) ────────
-- On engagements (Main Auditor config) AND copied onto each assignment,
-- because Sub-Auditors can read their own assignment but not engagements.
alter table engagements add column if not exists counting_method text not null default 'hybrid'
  check (counting_method in ('manual','barcode','hybrid'));
alter table assignments add column if not exists counting_method text not null default 'hybrid'
  check (counting_method in ('manual','barcode','hybrid'));

-- Re-declare the Sub-Auditor guard so counting_method is Main-only
-- (otherwise a Sub could change the method on their own row).
create or replace function restrict_subauditor_assignment_updates()
returns trigger language plpgsql security definer as $$
begin
  if is_main_auditor() then
    return new;
  end if;
  if new.companies is distinct from old.companies
     or new.items is distinct from old.items
     or new.unit is distinct from old.unit
     or new.method is distinct from old.method
     or new.auditor_id is distinct from old.auditor_id
     or new.round_id is distinct from old.round_id
     or new.counting_method is distinct from old.counting_method then
    raise exception 'Sub-Auditors may only update the status field on their own assignment';
  end if;
  if old.status = 'submitted' then
    raise exception 'This assignment was already submitted — ask the Main Auditor to reopen it before making further changes';
  end if;
  return new;
end;
$$;
