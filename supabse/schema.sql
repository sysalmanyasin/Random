-- ══════════════════════════════════════════════════════════════
-- SUPABASE SCHEMA — Fazal Din Pharma Plus, Team Audit
-- Run this once, top to bottom, in Supabase Dashboard → SQL Editor.
-- Safe to re-run (uses "if not exists" / "or replace" throughout).
-- ══════════════════════════════════════════════════════════════

-- ── staff ──────────────────────────────────────────────────────
-- One row per person who can log in — Main Auditor(s) and every
-- Sub-Auditor. id matches auth.users.id exactly (created together
-- by the create-staff Edge Function).
create table if not exists staff (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  phone text unique not null,
  role text not null check (role in ('main','sub')),
  access_expires_at timestamptz,        -- null = never expires
  created_at timestamptz not null default now()
);

-- ── engagements / rounds / assignments / submissions ────────────
create table if not exists engagements (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'open' check (status in ('open','archived','closed')),
  scope_type text not null check (scope_type in ('full','selected','single')),
  scope_companies text[] not null default '{}',
  created_by uuid references staff(id),
  created_at timestamptz not null default now()
);

create table if not exists rounds (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references engagements(id) on delete cascade,
  round_number int not null,
  unit text not null check (unit in ('company','item')),
  state text not null default 'draft' check (state in ('draft','locked','counting','compiled','final')),
  base_round_id uuid references rounds(id),
  -- Frozen snapshot of every item in the engagement's company scope,
  -- taken the moment this round was created. Every assignment, submission,
  -- compile, and the final report for THIS round reads items from here —
  -- never from live inventory — so a Dropbox/CSV re-sync mid-round can't
  -- shift item positions out from under an in-progress count. Each new
  -- round takes its own fresh cutoff at creation time, so Round 2+ still
  -- naturally picks up legitimate inventory updates between rounds.
  item_snapshot jsonb not null default '[]',
  created_at timestamptz not null default now(),
  locked_at timestamptz,
  compiled_at timestamptz,
  finalized_at timestamptz
);

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  auditor_id uuid not null references staff(id),
  auditor_name text not null,
  unit text not null check (unit in ('company','item')),
  companies text[] not null default '{}',
  items jsonb not null default '[]',    -- [{itemKey, company, code, name, qty, price}, ...]
  method text not null default 'auto-count',
  status text not null default 'assigned' check (status in ('assigned','counting','submitted','revoked')),
  -- How many items this person has counted so far, synced (throttled) from
  -- their device while status = 'counting' — separate from `submissions`
  -- (which only ever gets a row at Submit) so the Main Auditor can see live
  -- progress without that being mistaken for an actual submission by the
  -- compile-gating logic ("has this assignment submitted?").
  progress_count int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  round_id uuid not null references rounds(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  auditor_id uuid not null references staff(id),
  auditor_name text not null,
  counts jsonb not null default '{}',   -- { itemKey: countedQty }
  notes jsonb not null default '{}',    -- { itemKey: noteText }
  confirms jsonb not null default '{}', -- { itemKey: true } when "Same" re-applied last round's variance
  submitted_at timestamptz not null default now(),
  unique (assignment_id, auditor_id)    -- one live submission per assignment; resubmits UPDATE this row
);

create table if not exists compiled_rounds (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  merged_items jsonb not null default '[]',
  variances jsonb not null default '[]',
  missing_assignment_ids uuid[] not null default '{}',
  compiled_with_missing boolean not null default false,
  compiled_at timestamptz not null default now()
);

create table if not exists final_snapshots (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references engagements(id) on delete cascade,
  final_inventory jsonb not null default '[]',
  audit_trail jsonb not null default '[]',
  report jsonb not null default '{}',
  generated_at timestamptz not null default now()
);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  role text,
  action text not null,
  details jsonb not null default '{}',
  ts timestamptz not null default now()
);

-- ── helper functions (security definer = bypass RLS internally,
--    so checking "am I main auditor" doesn't itself get blocked) ──
create or replace function is_main_auditor()
returns boolean language sql security definer stable as $$
  select exists (select 1 from staff where id = auth.uid() and role = 'main');
$$;

create or replace function is_access_valid()
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from staff
    where id = auth.uid()
    and (access_expires_at is null or access_expires_at > now())
  );
$$;

-- Sub-Auditors have no read access to engagements/rounds (by design,
-- for isolation), so "is this engagement still open?" can't be checked
-- client-side for them. Enforced here instead, at the only two places
-- a Sub-Auditor can actually write: their own assignment's status, and
-- their own submission. A closed/archived engagement — including one
-- that was "Close Permanently"'d while someone was mid-count — now
-- actually stops accepting new work, not just looks closed in the UI.
create or replace function is_engagement_open(p_engagement_id uuid)
returns boolean language sql security definer stable as $$
  select exists (select 1 from engagements where id = p_engagement_id and status = 'open');
$$;

-- Mirrors the "frozen once submitted" rule enforced on assignments
-- (see restrict_subauditor_assignment_updates below) at the submissions
-- table itself, since that's the table that actually holds the counts.
create or replace function is_assignment_editable(p_assignment_id uuid)
returns boolean language sql security definer stable as $$
  select exists (select 1 from assignments where id = p_assignment_id and status not in ('submitted','revoked'));
$$;

-- ── Row Level Security ──────────────────────────────────────────
alter table staff enable row level security;
alter table engagements enable row level security;
alter table rounds enable row level security;
alter table assignments enable row level security;
alter table submissions enable row level security;
alter table compiled_rounds enable row level security;
alter table final_snapshots enable row level security;
alter table audit_log enable row level security;

-- Existing databases created before item_snapshot existed: this adds it
-- without touching anything else. Safe to re-run.
alter table rounds add column if not exists item_snapshot jsonb not null default '[]';
-- Existing databases created before progress_count existed: same idea —
-- adds the live-progress column without touching anything else.
alter table assignments add column if not exists progress_count int not null default 0;
-- Existing databases created before confirms existed: same idea — adds
-- the "Same button" confirmation-flag column without touching anything else.
alter table submissions add column if not exists confirms jsonb not null default '{}';

-- staff: everyone can read their own row (to know their own name/role/
-- expiry); Main Auditor can read + manage everyone.
drop policy if exists "staff self or main read" on staff;
create policy "staff self or main read" on staff for select
  using (id = auth.uid() or is_main_auditor());
drop policy if exists "staff main manage" on staff;
create policy "staff main manage" on staff for all
  using (is_main_auditor());

-- engagements / rounds / compiled_rounds / final_snapshots / audit_log:
-- Main Auditor only. A Sub-Auditor never needs these directly — they
-- only ever see their own assignment + submission rows below.
drop policy if exists "main only" on engagements;
create policy "main only" on engagements for all using (is_main_auditor());
drop policy if exists "main only" on rounds;
create policy "main only" on rounds for all using (is_main_auditor());
drop policy if exists "main only" on compiled_rounds;
create policy "main only" on compiled_rounds for all using (is_main_auditor());
drop policy if exists "main only" on final_snapshots;
create policy "main only" on final_snapshots for all using (is_main_auditor());
drop policy if exists "main only" on audit_log;
create policy "main only" on audit_log for all using (is_main_auditor());

-- assignments: Main Auditor full access. A Sub-Auditor may ONLY read
-- the assignment(s) that belong to them, and only while their access
-- hasn't expired — this is the real, database-enforced isolation
-- (not "isolation by omission" the way the old pairing-link app did it).
drop policy if exists "assignments main all" on assignments;
create policy "assignments main all" on assignments for all
  using (is_main_auditor());
drop policy if exists "assignments sub read own" on assignments;
create policy "assignments sub read own" on assignments for select
  using (auditor_id = auth.uid() and is_access_valid());
drop policy if exists "assignments sub update own status" on assignments;
create policy "assignments sub update own status" on assignments for update
  using (auditor_id = auth.uid() and is_access_valid())
  with check (auditor_id = auth.uid() and is_engagement_open(engagement_id));

-- submissions: Main Auditor full access. A Sub-Auditor may insert/update
-- ONLY their own submission row, only while access is valid, and may
-- read only their own.
drop policy if exists "submissions main all" on submissions;
create policy "submissions main all" on submissions for all
  using (is_main_auditor());
drop policy if exists "submissions sub insert own" on submissions;
create policy "submissions sub insert own" on submissions for insert
  with check (auditor_id = auth.uid() and is_access_valid() and is_engagement_open(engagement_id) and is_assignment_editable(assignment_id));
drop policy if exists "submissions sub update own" on submissions;
create policy "submissions sub update own" on submissions for update
  using (auditor_id = auth.uid() and is_access_valid())
  with check (auditor_id = auth.uid() and is_engagement_open(engagement_id) and is_assignment_editable(assignment_id));
drop policy if exists "submissions sub read own" on submissions;
create policy "submissions sub read own" on submissions for select
  using (auditor_id = auth.uid());

-- ── column-level hardening ──────────────────────────────────────
-- RLS policies gate which ROWS a Sub-Auditor can update, not which
-- COLUMNS. Without this trigger, a Sub-Auditor's own "update own
-- status" policy would technically also let their client rewrite
-- their own assignment's item list or companies. This trigger
-- enforces that a non-Main-Auditor caller may only ever change the
-- `status` column on their own assignment row — everything else on
-- that table still requires is_main_auditor().
create or replace function restrict_subauditor_assignment_updates()
returns trigger language plpgsql security definer as $$
begin
  if is_main_auditor() then
    return new;
  end if;
  -- Sub-Auditors may freely change `status` and `progress_count` on their
  -- own row (both are just their own live self-reported state) — every
  -- other column below is locked down to Main-Auditor-only.
  if new.companies is distinct from old.companies
     or new.items is distinct from old.items
     or new.unit is distinct from old.unit
     or new.method is distinct from old.method
     or new.auditor_id is distinct from old.auditor_id
     or new.round_id is distinct from old.round_id then
    raise exception 'Sub-Auditors may only update the status field on their own assignment';
  end if;
  -- Once submitted, the assignment is frozen for that Sub-Auditor —
  -- no more edits, no re-triggering "counting", nothing — until the
  -- Main Auditor explicitly reopens it (which they can, since they're
  -- exempt above). Prevents a "fixed" count from silently invalidating
  -- a round the Main Auditor already compiled with no warning.
  if old.status = 'submitted' then
    raise exception 'This assignment was already submitted — ask the Main Auditor to reopen it before making further changes';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_restrict_subauditor_assignment_updates on assignments;
create trigger trg_restrict_subauditor_assignment_updates
  before update on assignments
  for each row execute function restrict_subauditor_assignment_updates();

-- ── helpful indexes ──────────────────────────────────────────────
create index if not exists idx_rounds_engagement on rounds(engagement_id);
create index if not exists idx_assignments_round on assignments(round_id);
create index if not exists idx_assignments_auditor on assignments(auditor_id);
create index if not exists idx_submissions_assignment on submissions(assignment_id);
create index if not exists idx_compiled_round on compiled_rounds(round_id);
create index if not exists idx_final_engagement on final_snapshots(engagement_id);

-- ══════════════════════════════════════════════════════════════
-- ONE-TIME: create your own Main Auditor login.
-- Do this AFTER deploying the create-staff Edge Function (see
-- supabase/admin-actions/index.ts) — call it once with your own
-- name/phone/PIN and role:'main'. Do not insert into `staff`
-- directly; the Edge Function creates the matching auth.users row
-- too, which a raw SQL insert here cannot do.
-- ══════════════════════════════════════════════════════════════
