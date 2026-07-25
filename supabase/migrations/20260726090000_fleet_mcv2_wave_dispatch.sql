-- Fleet MCv2 — M4 wave dispatch lifecycle + per-session claim bookkeeping.
-- See docs/SCHEMA_V2.md § "Wave dispatch lifecycle (M4)".
--
-- DESIGN DECISION OF RECORD (operator, 2026-07-26): dispatch is DIRECT-POLL — the
-- machine agent polls the `dispatch` Edge Function for confirmed waves; there is no
-- fleet_commands row acting as the trigger. Consequence: fleet_waves stops being a
-- passive record of a launch that already happened (the v1 `register` semantics) and
-- becomes an EXECUTION SURFACE. It therefore carries command-queue-grade protections:
--   • `confirmed` is the ONLY thing that makes work pollable, and only the authed
--     cockpit route may set it (an operator's explicit go — audited by
--     confirmed_at/confirmed_by, enforced below by a check constraint);
--   • per-session claims are conditional-update advisory locks, so two agents can
--     never double-launch one session;
--   • every launch attempt is recorded (launched_at | launch_error) — full audit
--     trail of what actually ran.
--
-- PROPOSED — the planner applies this; it is NOT run against the live project by the
-- building session. Idempotent (`if not exists` / drop-then-add constraint).

-- ── fleet_waves: the dispatch lifecycle ──────────────────────────────────────
-- draft → confirmed → launching → dispatched → reviewing → done | abandoned
--
--   draft      registered/composed, inert. Nothing polls it.
--   confirmed  the operator pressed go in the cockpit. THE execution trigger.
--   launching  at least one agent has claimed a session from it.
--   dispatched every session has launched or terminally failed to launch.
--   reviewing/done/abandoned  unchanged post-launch states (abandoned is also the
--              kill switch: it is not launchable, so it stops further claims dead).
--
-- 'dispatched' predates this migration and keeps its v1 meaning for launcher-
-- registered waves (the Mac launcher already ran them; ingest's `register` block
-- defaults to it). Such waves never pass through confirmed/launching — which is why
-- the audit constraint below is scoped to 'confirmed' only, and why the register
-- block's accepted-status list (session-logic.mjs WAVE_STATUSES) deliberately does
-- NOT include 'confirmed'/'launching': a machine token must not be able to arm work.
alter table public.fleet_waves drop constraint if exists fleet_waves_status_check;
alter table public.fleet_waves add constraint fleet_waves_status_check
  check (status in ('draft','confirmed','launching','dispatched','reviewing','done','abandoned'));

alter table public.fleet_waves add column if not exists confirmed_at  timestamptz;
alter table public.fleet_waves add column if not exists confirmed_by  text;   -- operator email
alter table public.fleet_waves add column if not exists launch_error  text;

comment on column public.fleet_waves.confirmed_at is
  'MCv2 M4: when the operator confirmed this wave for dispatch. Set ONLY by the authed cockpit route.';
comment on column public.fleet_waves.confirmed_by is
  'MCv2 M4: operator email that confirmed the wave (audit). Set ONLY by the authed cockpit route.';
comment on column public.fleet_waves.launch_error is
  'MCv2 M4: set by the dispatch function when >=1 session failed to launch ("<n>/<total> sessions failed to launch").';

-- Audit invariant: a wave cannot be armed anonymously. Existing rows are unaffected
-- ('confirmed' is a new status, so no row currently holds it).
alter table public.fleet_waves drop constraint if exists fleet_waves_confirmed_audit_check;
alter table public.fleet_waves add constraint fleet_waves_confirmed_audit_check
  check (status <> 'confirmed' or (confirmed_at is not null and confirmed_by is not null));

-- Poll-side index: the dispatch function's poll filters waves by launchable status.
create index if not exists fleet_waves_launchable_idx
  on public.fleet_waves (status)
  where (status in ('confirmed','launching'));

-- ── fleet_sessions: per-session launch bookkeeping ───────────────────────────
-- claimed_at/claimed_by are the advisory lock. A claim is
--   update ... where id = $1 and machine_id = $auth and claimed_at is null
-- so exactly one agent can win; the loser gets zero rows back and stands down.
-- A session that fails to launch keeps its claim (claimed_at stays set) so it is
-- NOT silently re-polled into a relaunch loop — recovery is an explicit operator
-- re-dispatch, not an automatic retry. That is deliberate for an execution surface.
alter table public.fleet_sessions add column if not exists claimed_at   timestamptz;
alter table public.fleet_sessions add column if not exists claimed_by   uuid
  references public.fleet_machines(id) on delete set null;
alter table public.fleet_sessions add column if not exists launched_at  timestamptz;
alter table public.fleet_sessions add column if not exists launch_error text;

comment on column public.fleet_sessions.claimed_at is
  'MCv2 M4: advisory-lock stamp. Non-null => some agent has claimed this session for launch; never re-polled.';
comment on column public.fleet_sessions.claimed_by is
  'MCv2 M4: machine that won the claim (audit). Always equals the authed machine of the winning dispatch call.';
comment on column public.fleet_sessions.launched_at is
  'MCv2 M4: the agent acked a successful launch. Preserve-on-null (a duplicate/late ack never restamps it).';
comment on column public.fleet_sessions.launch_error is
  'MCv2 M4: the agent acked a failed launch. Terminal for the launch phase: the wave completes without it.';

-- Poll-side index: unclaimed, still-planned work for one machine.
create index if not exists fleet_sessions_dispatch_poll_idx
  on public.fleet_sessions (machine_id, wave_id)
  where (claimed_at is null and status = 'planned');

-- ── Security posture: unchanged ──────────────────────────────────────────────
-- New columns inherit fleet_waves / fleet_sessions' existing posture: RLS enabled,
-- ZERO policies (deny-all), grants revoked from anon/authenticated
-- (20260722090100_fleet_mcv2_rls.sql). Nothing here joins the anon surface or the
-- realtime publication. The dispatch Edge Function reads/writes with the service
-- role behind per-machine token auth; the cockpit does so behind operator auth.
