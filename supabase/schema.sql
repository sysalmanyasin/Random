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
  role text not null check (role in ('main','dep','sub')),
  access_expires_at timestamptz,        -- null = never expires
  created_at timestamptz not null default now()
);

-- Migration for a database that already has the old ('main','sub')
-- constraint — safe to re-run, no-op once already widened.
alter table staff drop constraint if exists staff_role_check;
alter table staff add constraint staff_role_check check (role in ('main','dep','sub'));

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
  -- Lettered sub-round within the same round_number family, e.g. Round
  -- "1A"/"1B" — created when the Main Auditor adds newly-discovered
  -- companies mid-engagement without disturbing the in-progress round.
  -- Null for an ordinary (unlettered) round.
  round_suffix text,
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
  -- A periodic (debounced) snapshot of {counts, confirms, updatedAt} synced
  -- from the Sub-Auditor's own device while they work, pre-submission —
  -- purely so the Main Auditor can tap the progress bar and see a
  -- refreshing read-only view of what's been entered so far. Not the
  -- system of record: the real counts only land in `submissions` at Submit.
  live_snapshot jsonb not null default '{}',
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
  round_id uuid not null references rounds(id) on delete cascade unique,
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

-- Deputy Auditor: a read-only tier between Main and Sub. Used below to
-- grant SELECT (never insert/update/delete) on engagements/rounds/
-- assignments/submissions, alongside the existing "main only" for-all
-- policies (Postgres OR's permissive policies together per command).
create or replace function is_dep_or_main()
returns boolean language sql security definer stable as $$
  select exists (select 1 from staff where id = auth.uid() and role in ('main','dep'));
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

-- The one privileged write a Sub-Auditor's own client needs but can't
-- have directly: compiling their own just-submitted Individual round
-- (see individual-actions.js autoCompileIfIndividual). compiled_rounds
-- has no Sub-Auditor policy at all, and rounds has none for UPDATE —
-- both stay that way; this function is the sole, narrow crack,
-- re-validating server-side (never trusting the caller) that:
--   1. the round actually belongs to a scope_type='individual' engagement
--   2. the caller either owns that round's one assignment, or is the Main Auditor
-- The merge/variance numbers themselves are computed in JS
-- (buildMergedItems, compile-actions.js) — identical logic to every
-- other compile in the app — and just carried across this one
-- privilege boundary as parameters, so there is exactly one place the
-- actual variance rule lives, not one in JS and a second copy in SQL.
create or replace function compile_individual_round(p_round_id uuid, p_merged_items jsonb, p_variances jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_engagement_id uuid;
  v_scope_type text;
  v_owner uuid;
begin
  select engagement_id into v_engagement_id from rounds where id = p_round_id;
  if v_engagement_id is null then
    raise exception 'round not found';
  end if;

  select scope_type into v_scope_type from engagements where id = v_engagement_id;
  if v_scope_type is distinct from 'individual' then
    raise exception 'compile_individual_round can only be used on an Individual Assignments round';
  end if;

  select auditor_id into v_owner from assignments where round_id = p_round_id limit 1;
  if v_owner is distinct from auth.uid() and not is_main_auditor() then
    raise exception 'not your round';
  end if;

  insert into compiled_rounds (round_id, engagement_id, merged_items, variances, missing_assignment_ids, compiled_with_missing)
  values (p_round_id, v_engagement_id, p_merged_items, p_variances, '{}', false)
  on conflict (round_id) do update set
    merged_items = excluded.merged_items, variances = excluded.variances, compiled_at = now();

  update rounds set state = 'compiled', compiled_at = now() where id = p_round_id;
end;
$$;

grant execute on function compile_individual_round(uuid, jsonb, jsonb) to authenticated;

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
-- Existing databases created before round_suffix existed: same idea —
-- adds the lettered-sub-round column without touching anything else.
alter table rounds add column if not exists round_suffix text;
-- Existing databases created before live_snapshot existed: same idea —
-- adds the Sub-Auditor live-progress popup column without touching anything else.
alter table assignments add column if not exists live_snapshot jsonb not null default '{}';

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
drop policy if exists "dep read engagements" on engagements;
create policy "dep read engagements" on engagements for select using (is_dep_or_main());
drop policy if exists "main only" on rounds;
create policy "main only" on rounds for all using (is_main_auditor());
drop policy if exists "dep read rounds" on rounds;
create policy "dep read rounds" on rounds for select using (is_dep_or_main());
drop policy if exists "main only" on compiled_rounds;
create policy "main only" on compiled_rounds for all using (is_main_auditor());
drop policy if exists "dep read compiled_rounds" on compiled_rounds;
create policy "dep read compiled_rounds" on compiled_rounds for select using (is_dep_or_main());
drop policy if exists "main only" on final_snapshots;
create policy "main only" on final_snapshots for all using (is_main_auditor());
drop policy if exists "main only" on audit_log;
create policy "main only" on audit_log for all using (is_main_auditor());

-- Individual Assignments (staff self-service, see individual-actions.js):
-- the one deliberate, narrow crack in "engagements/rounds are Main
-- Auditor only" above. A Sub-Auditor may read and create rows in
-- EITHER table, but ONLY where scope_type='individual' (the one
-- evergreen monthly pool every self-pick lands in) — every other
-- engagement/round in the system stays completely invisible to them,
-- exactly as before.
drop policy if exists "sub read individual engagements" on engagements;
create policy "sub read individual engagements" on engagements for select
  using (scope_type = 'individual');
drop policy if exists "sub create individual engagements" on engagements;
create policy "sub create individual engagements" on engagements for insert
  with check (scope_type = 'individual');

drop policy if exists "sub read individual rounds" on rounds;
create policy "sub read individual rounds" on rounds for select
  using (exists (select 1 from engagements e where e.id = rounds.engagement_id and e.scope_type = 'individual'));
drop policy if exists "sub create individual rounds" on rounds;
create policy "sub create individual rounds" on rounds for insert
  with check (exists (select 1 from engagements e where e.id = rounds.engagement_id and e.scope_type = 'individual'));
-- No sub-auditor UPDATE policy on rounds: the one time a round's state
-- needs to change post-creation (compiling) goes through
-- compile_individual_round() below instead, which runs with elevated
-- privilege of its own rather than needing a broad UPDATE grant here.

-- A unique index (not just a constraint check) so two Sub-Auditors
-- can't race to create the same month's pool engagement twice — the
-- second insert fails outright rather than silently forking the pool.
create unique index if not exists uq_engagements_individual_month
  on engagements(scope_month) where scope_type = 'individual';

-- Same shape of problem, one level down: individual-actions.js's
-- startIndividualAssignment() checks "does this auditor already have
-- an open self-pick" before inserting a new round+assignment, but
-- that check-then-insert isn't atomic — two calls close together
-- (e.g. a double-tap on "Start Counting" on a slow connection, with
-- no button-disable in between) can both pass the check before either
-- write lands, leaving the same auditor with two live "assigned"
-- rounds. This partial unique index makes the second insert fail
-- outright instead of silently succeeding, exactly like the
-- engagement-pool index above; individual-actions.js catches the
-- 23505 and hands back whichever one actually won.
create unique index if not exists uq_assignments_one_open_individual_pick
  on assignments(auditor_id)
  where method = 'individual-self-pick' and status in ('assigned', 'counting');

-- assignments: Main Auditor full access. A Sub-Auditor may ONLY read
-- the assignment(s) that belong to them, and only while their access
-- hasn't expired — this is the real, database-enforced isolation
-- (not "isolation by omission" the way the old pairing-link app did it).
drop policy if exists "assignments main all" on assignments;
create policy "assignments main all" on assignments for all
  using (is_main_auditor());
drop policy if exists "dep read assignments" on assignments;
create policy "dep read assignments" on assignments for select
  using (is_dep_or_main());
drop policy if exists "assignments sub read own" on assignments;
create policy "assignments sub read own" on assignments for select
  using (auditor_id = auth.uid() and is_access_valid());
drop policy if exists "assignments sub update own status" on assignments;
create policy "assignments sub update own status" on assignments for update
  using (auditor_id = auth.uid() and is_access_valid())
  with check (auditor_id = auth.uid() and is_engagement_open(engagement_id));
-- Individual self-pick: a Sub-Auditor may create exactly one
-- assignment for THEMSELVES (auditor_id = auth.uid(), never anyone
-- else's), and only inside a scope_type='individual' round — creating
-- an assignment on any real Team round stays impossible for them.
drop policy if exists "sub create own individual assignment" on assignments;
create policy "sub create own individual assignment" on assignments for insert
  with check (
    auditor_id = auth.uid()
    and exists (select 1 from rounds r join engagements e on e.id = r.engagement_id where r.id = assignments.round_id and e.scope_type = 'individual')
  );

-- submissions: Main Auditor full access. A Sub-Auditor may insert/update
-- ONLY their own submission row, only while access is valid, and may
-- read only their own.
drop policy if exists "submissions main all" on submissions;
create policy "submissions main all" on submissions for all
  using (is_main_auditor());
drop policy if exists "dep read submissions" on submissions;
create policy "dep read submissions" on submissions for select
  using (is_dep_or_main());
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
-- INVENTORY TAB — saved audit templates + exact-code Team Audit scope.
-- Safe to re-run, same "if not exists / or replace" convention as
-- the rest of this file.
-- ══════════════════════════════════════════════════════════════

-- A template is deliberately dumb storage: just a name + a list of
-- product codes. All "what does this mean right now" logic happens at
-- LOAD time (resolved against current live inventory client-side), not
-- here — so a template survives Dropbox/CSV re-syncs and discontinued
-- codes without ever going stale in the database.
create table if not exists audit_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  codes text[] not null default '{}',
  created_by uuid references staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table audit_templates enable row level security;
drop policy if exists "templates main all" on audit_templates;
create policy "templates main all" on audit_templates for all using (is_main_auditor());
-- Any valid staff member can read templates (not just the Main
-- Auditor) so a Sub-Auditor's device can also launch an Individual
-- Random Audit from a template shared with them.
drop policy if exists "templates read all staff" on audit_templates;
create policy "templates read all staff" on audit_templates for select using (is_access_valid());

create index if not exists idx_templates_created_by on audit_templates(created_by);

-- Team Audit launched directly from a template: scope_type = 'template'
-- carries the exact code list in scope_codes, alongside the normal
-- scope_companies (auto-derived client-side from those codes, so every
-- existing company-based UI — chips, progress views, sub-rounds — keeps
-- working without modification). round-actions.js intersects the
-- company-scoped item snapshot with scope_codes at Round 1 creation, so
-- sub-auditors only ever see the exact codes, never the whole company.
alter table engagements drop constraint if exists engagements_scope_type_check;
alter table engagements add constraint engagements_scope_type_check
  check (scope_type in ('full','selected','single','template','individual'));

-- One evergreen, auto-rolling engagement per calendar month holds every
-- staff self-assigned "individual" audit (see individual-actions.js).
-- scope_type='individual' identifies it structurally (not by parsing
-- the display name); scope_month is the exact-match lookup key
-- ('2026-07') used to find-or-create the current month's one and to
-- auto-close the previous month's the moment a new one is needed.
alter table engagements add column if not exists scope_month text;
alter table engagements add column if not exists scope_codes text[] not null default '{}';

-- Sub-Auditor free-text note ("items found but not in inventory"),
-- carried alongside the itemKey-scoped `counts`/`notes` — see
-- counting-actions.js myExtraNote. Not part of any variance
-- calculation; purely an informational appendix surfaced post-compile
-- grouped by auditor (compiled_rounds.auditor_notes below).
alter table submissions add column if not exists extra_note text not null default '';
-- Set only when a submission was written by Force Submit (Main
-- Auditor acting on a Sub-Auditor's live_snapshot) rather than by the
-- Sub-Auditor themselves — holds the Main Auditor's name, so reports
-- can always distinguish a real submission from a forced one. Null for
-- ordinary submissions.
alter table submissions add column if not exists force_submitted_by text;
-- How Force Submit should treat items the Sub-Auditor never got to:
-- 'unverified' leaves them blank, 'match' auto-fills system qty. Null
-- for ordinary (non-forced) submissions.
alter table submissions add column if not exists force_submit_leftover_mode text
  check (force_submit_leftover_mode in ('unverified','match'));

-- Auditor Notes appendix, collected at compile time from every
-- submission's extra_note in this round — see compile-actions.js
-- collectAuditorNotes(). Kept fully separate from merged_items/
-- variances so it can never affect variance counts.
alter table compiled_rounds add column if not exists auditor_notes jsonb not null default '[]';
-- Cross-round conflicts: same (company, code) counted with a
-- different variance in another already-compiled round. Never
-- auto-resolved — see compile-actions.js detectCrossRoundConflicts()
-- and resolveCrossRoundConflict(). Each entry gains a `resolved` field
-- (itemKey/roundId chosen + resolvedBy + resolvedAt) once the Main
-- Auditor picks one side; until then it's flagged but both counts
-- are kept exactly as compiled.
alter table compiled_rounds add column if not exists cross_round_conflicts jsonb not null default '[]';

-- For databases that ran this schema before the `unique` on
-- compiled_rounds.round_id existed above: add it now, guarded so this
-- is safe to re-run. (If duplicate rows already exist from a past
-- double-click race, this will fail loudly rather than silently
-- picking one to drop — resolve those manually first, they're rare.)
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'compiled_rounds_round_id_key'
  ) then
    alter table compiled_rounds add constraint compiled_rounds_round_id_key unique (round_id);
  end if;
end $$;

-- Time tracking: "opening to submission" duration plus a per-row
-- breakdown (see counting-actions.js recordMyCount / openMyAssignment).
-- started_at is set once, the first time a Sub-Auditor actually opens
-- the assignment (assigned -> counting) — not when it was created or
-- assigned, since that could be hours or days before anyone starts
-- counting. row_times is itemKey -> seconds spent on that row,
-- attributed sequentially and capped per-row (see MAX_ROW_SECONDS) so
-- a coffee break mid-session doesn't get misattributed as "this one
-- item took 40 minutes."
alter table assignments add column if not exists started_at timestamptz;
alter table submissions add column if not exists row_times jsonb not null default '{}';

-- Which saved Template (Inventory tab) an Individual self-pick audit
-- was started from, purely for display (Main Auditor's plain
-- Engagement-detail round list — see individual-actions.js
-- summarizeIndividualRounds / round-components.js roundCard). A
-- template can bundle several companies under one meaningful label
-- (e.g. a category or a recurring spot-check list), which the
-- companies[] array alone doesn't convey. Null whenever the pick was
-- direct companies (selection.source === 'companies') rather than a
-- template. Never used to gate or route anything — purely cosmetic,
-- same spirit as round_suffix above.
alter table assignments add column if not exists template_name text;

-- The uncounted=0 rule: any item never actually typed defaults to a
-- full assumed-shortage variance (countedQty=0) rather than being
-- excluded from the report. auto_matched marks the ONE sanctioned way
-- to resolve that without a real physical count — "Mark Remaining as
-- Match" (self-service) or Force Submit's match mode — so reports can
-- always tell a real count apart from an assumed/auto-resolved one,
-- even when both show the same number. See counting-actions.js
-- markRemainingAsMatch and compile-actions.js buildMergedItems.
alter table submissions add column if not exists auto_matched jsonb not null default '{}';

-- ══════════════════════════════════════════════════════════════
-- SHARED INVENTORY — server-synced from Dropbox.
-- These two tables are queried directly by js/repository/supabase.js
-- (fetchInventoryProducts, fetchLatestInventorySync) but were missing
-- from this file even though the app depends on them from first
-- bootstrap (Actions.bootstrap() -> loadInventoryFromSupabase). Only
-- the sync-inventory-from-dropbox Edge Function (service-role key,
-- bypasses RLS) ever writes to these — every client only ever reads.
-- ══════════════════════════════════════════════════════════════

create table if not exists inventory_products (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  qty numeric not null default 0,
  price numeric not null default 0,
  company text not null default 'Unassigned Manufacturer',
  generic text not null default '',
  supplier text not null default 'Unassigned Supplier',
  conversion_factor numeric not null default 1
);

alter table inventory_products enable row level security;
drop policy if exists "inventory read all staff" on inventory_products;
create policy "inventory read all staff" on inventory_products for select using (is_access_valid());

create index if not exists idx_inventory_products_code on inventory_products(code);

create table if not exists inventory_sync_log (
  id uuid primary key default gen_random_uuid(),
  synced_at timestamptz not null default now(),
  item_count integer not null,
  source text not null
);

alter table inventory_sync_log enable row level security;
drop policy if exists "inventory sync log read all staff" on inventory_sync_log;
create policy "inventory sync log read all staff" on inventory_sync_log for select using (is_access_valid());

create index if not exists idx_inventory_sync_log_synced_at on inventory_sync_log(synced_at desc);

-- ══════════════════════════════════════════════════════════════
-- FIX: submissions must be unique per ASSIGNMENT, not per
-- (assignment, auditor). The original `unique (assignment_id,
-- auditor_id)` meant Reassign-to-a-different-auditor didn't upsert
-- the existing row — it inserted a SECOND submissions row for the
-- same assignment (old auditor's row untouched, new auditor's row
-- added alongside it). compile-actions.js buildMergedItems then had
-- two candidate rows per assignment and no way to know which was
-- current, so a recompile after reassigning to someone new could
-- keep merging the stale, pre-reassignment counts. One live
-- submission per assignment (whoever most recently submitted it) is
-- the actual invariant this table is supposed to hold — see the
-- upsertSubmission comment in js/repository/supabase.js.
--
-- Step 1: collapse any duplicate rows that already exist per
-- assignment_id, keeping only the most recently submitted one.
delete from submissions s
  using submissions newer
  where s.assignment_id = newer.assignment_id
    and (newer.submitted_at, newer.id) > (s.submitted_at, s.id);

-- Step 2: drop the old composite unique constraint, whatever
-- Postgres auto-named it, and replace it with one on assignment_id
-- alone so every future upsert (see upsertSubmission's onConflict)
-- correctly updates the single existing row for that assignment
-- regardless of which auditor currently owns it.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'submissions'
      and con.contype = 'u'
      and (
        select array_agg(attname order by attname)
        from pg_attribute
        where attrelid = rel.oid and attnum = any(con.conkey)
      ) = array['assignment_id', 'auditor_id']
  loop
    execute format('alter table submissions drop constraint %I', c.conname);
  end loop;
end $$;

alter table submissions add constraint submissions_assignment_id_key unique (assignment_id);

-- ══════════════════════════════════════════════════════════════
-- ONE-TIME: create your own Main Auditor login.
-- Do this AFTER deploying the create-staff Edge Function (see
-- supabase/admin-actions/index.ts) — call it once with your own
-- name/phone/PIN and role:'main'. Do not insert into `staff`
-- directly; the Edge Function creates the matching auth.users row
-- too, which a raw SQL insert here cannot do.
-- ══════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════
-- EXPIRY TRACKING MODULE
-- Racks (master list, Main Auditor-managed in Settings) + monthly
-- rack→staff assignments (who checks which rack this month) +
-- expiry_entries (the actual near-expiry log, staff-wise & month-
-- wise, universally searchable by everyone). Safe to re-run, same
-- "if not exists / or replace" convention as the rest of this file.
-- ══════════════════════════════════════════════════════════════

-- ── racks (master list) ──────────────────────────────────────────
-- A small, Main-Auditor-curated list of physical rack names/numbers
-- ("Rack A2", "Cold Chain Rack 1", ...) — kept as a real table (not
-- free text everywhere) so the dropdown stays typo-free and can be
-- reused both by the expiry-entry form and by the monthly assignment
-- screen. "active" (not a hard delete) so a retired rack name doesn't
-- silently break the history of entries that already reference it.
create table if not exists racks (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_by uuid references staff(id),
  created_at timestamptz not null default now()
);

alter table racks enable row level security;
drop policy if exists "racks read all staff" on racks;
create policy "racks read all staff" on racks for select using (is_access_valid());
drop policy if exists "racks main manage" on racks;
create policy "racks main manage" on racks for all using (is_main_auditor());

-- ── rack_assignments (monthly: who checks which rack) ────────────
-- One row per (rack, calendar month). Re-assigning the same rack in
-- the same month is an upsert (onConflict rack_id,month in
-- repository/expiry.js), so re-running the assignment screen for a
-- month just overwrites who currently owns that rack rather than
-- piling up duplicate rows. rack_name/staff_name are denormalized at
-- assignment time so a later rack rename or staff rename doesn't
-- silently rewrite past months' history.
create table if not exists rack_assignments (
  id uuid primary key default gen_random_uuid(),
  rack_id uuid not null references racks(id) on delete cascade,
  rack_name text not null,
  staff_id uuid not null references staff(id),
  staff_name text not null,
  month text not null,              -- 'YYYY-MM' — the calendar month this assignment covers
  assigned_by uuid references staff(id),
  assigned_at timestamptz not null default now(),
  unique (rack_id, month)
);

alter table rack_assignments enable row level security;
-- Read access is open to every valid staff member (not just Main
-- Auditor) because a Sub-Auditor's own device needs to know which
-- rack(s) are theirs this month, to filter the expiry-entry form's
-- rack dropdown down to just their own assignment.
drop policy if exists "rack assignments read all staff" on rack_assignments;
create policy "rack assignments read all staff" on rack_assignments for select using (is_access_valid());
drop policy if exists "rack assignments main manage" on rack_assignments;
create policy "rack assignments main manage" on rack_assignments for all using (is_main_auditor());

create index if not exists idx_rack_assignments_month on rack_assignments(month);
create index if not exists idx_rack_assignments_staff on rack_assignments(staff_id);

-- ── expiry_entries (the actual near-expiry log) ──────────────────
-- product_code/product_name are picked from the same shared
-- inventory_products table the rest of the app already uses (no
-- second product list). "locked" plus the RLS policies below are
-- what actually enforce "once saved, can't be edited — only the
-- Main Auditor can reopen it": a Sub-Auditor's client has an INSERT
-- grant on this table and nothing else — no UPDATE policy exists for
-- them at all, so there is no RLS path for them to change a row after
-- it's inserted, regardless of what the UI shows. Only the Main
-- Auditor can UPDATE (reopen, edit, then re-lock) or DELETE a row.
create table if not exists expiry_entries (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id),
  staff_name text not null,
  product_code text not null default '',
  product_name text not null,
  quantity numeric not null,
  expiry_month text not null,        -- 'YYYY-MM' — the month/year the stock actually expires
  rack_location text not null,       -- a name from `racks`, or free text if "Other" was typed
  status text not null default 'Near Expiry'
    check (status in ('Near Expiry','Sold','Returned to Warehouse','Discarded')),
  locked boolean not null default true,
  logged_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reopened_by uuid references staff(id),
  reopened_by_name text,
  reopened_at timestamptz
);

alter table expiry_entries enable row level security;

-- Shared visibility: any logged-in, non-expired staff member can read
-- every entry — this is the "universal search for any product,
-- anytime" requirement. Unlike Team Audit's per-person isolation,
-- expiry records are meant to be visible to the whole team.
drop policy if exists "expiry read all staff" on expiry_entries;
create policy "expiry read all staff" on expiry_entries for select using (is_access_valid());

-- A Sub-Auditor may insert a new entry under their own staff_id, once,
-- while their access is valid. That's the only write grant they get —
-- see the comment above the table for why that's what actually locks
-- an entry after save.
drop policy if exists "expiry insert own" on expiry_entries;
create policy "expiry insert own" on expiry_entries for insert
  with check (staff_id = auth.uid() and is_access_valid());

drop policy if exists "expiry main update" on expiry_entries;
create policy "expiry main update" on expiry_entries for update using (is_main_auditor());
drop policy if exists "expiry main delete" on expiry_entries;
create policy "expiry main delete" on expiry_entries for delete using (is_main_auditor());

create index if not exists idx_expiry_product_name on expiry_entries(product_name);
create index if not exists idx_expiry_month on expiry_entries(expiry_month);
create index if not exists idx_expiry_staff on expiry_entries(staff_id);
create index if not exists idx_expiry_status on expiry_entries(status);
