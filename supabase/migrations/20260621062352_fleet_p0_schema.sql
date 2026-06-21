-- Fleet Mission Control — P0 monitoring schema (read-only plane)
-- All tables prefixed `fleet_` to coexist with the portfolio's job-hunter tables
-- in the shared Supabase project (sbmsxerwgylpfkkkjtku).

-- ── Machine registry (public-safe; NO secrets here) ───────────────────────────
create table if not exists public.fleet_machines (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,                 -- 'mac-cockpit', 'sentry'
  kind          text not null default 'node'
                  check (kind in ('cockpit','compute','phone','node')),
  os            text,
  arch          text,
  specs         jsonb not null default '{}'::jsonb,    -- {cpu_model,cpu_cores,ram_total_mb,gpus:[...]}
  agent_version text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);
comment on table public.fleet_machines is 'Fleet node registry. Public-readable; contains no secrets.';

-- ── Per-machine secrets (write-token hash + tailnet IP). NEVER anon-readable ──
create table if not exists public.fleet_machine_secrets (
  machine_id  uuid primary key references public.fleet_machines(id) on delete cascade,
  token_hash  text not null,                           -- sha256 hex of the per-machine write token
  tailscale_ip text,
  created_at  timestamptz not null default now(),
  rotated_at  timestamptz
);
comment on table public.fleet_machine_secrets is 'Private: per-machine ingest token hash + tailnet IP. Service-role only.';

-- ── Heartbeats (telemetry time-series; public-readable) ───────────────────────
create table if not exists public.fleet_heartbeats (
  id             bigint generated always as identity primary key,
  machine_id     uuid not null references public.fleet_machines(id) on delete cascade,
  ts             timestamptz not null default now(),
  cpu_pct        real,
  ram_pct        real,
  ram_used_mb    integer,
  ram_total_mb   integer,
  load_avg       real[],                               -- [1m,5m,15m]
  gpu            jsonb,                                 -- [{index,name,util_pct,mem_used_mb,mem_total_mb,temp_c,power_w}]
  uptime_s       bigint,
  schema_version smallint not null default 1,
  raw            jsonb                                  -- forward-compat full payload (non-secret)
);
create index if not exists fleet_heartbeats_machine_ts_idx
  on public.fleet_heartbeats (machine_id, ts desc);
comment on table public.fleet_heartbeats is 'Append-only telemetry. Pruned on retention schedule.';

-- ── Jobs (what is running; public-safe columns only) ──────────────────────────
create table if not exists public.fleet_jobs (
  id          uuid primary key default gen_random_uuid(),
  machine_id  uuid not null references public.fleet_machines(id) on delete cascade,
  name        text not null,                           -- tmux session name ('nav','claude-123456')
  project     text,                                    -- 'cellular-gaits','portfolio',...
  kind        text not null default 'other'
                check (kind in ('evolution','claude-session','nav','other')),
  status      text not null default 'running'
                check (status in ('running','finished','failed','stopped','unknown')),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  updated_at  timestamptz not null default now(),
  progress    jsonb not null default '{}'::jsonb,       -- {gens_done,gens_total,best_fitness,mean_fitness,eta_s,pct}
  exit_code   integer
);
-- one active job per (machine,name)
create unique index if not exists fleet_jobs_active_uniq
  on public.fleet_jobs (machine_id, name) where (status = 'running');
create index if not exists fleet_jobs_machine_updated_idx
  on public.fleet_jobs (machine_id, updated_at desc);
comment on table public.fleet_jobs is 'Jobs running across the fleet. Public-safe columns; sensitive bits in fleet_job_links.';

-- ── Job links (SENSITIVE: /rc capability URL, full cmd, metrics, logs) ────────
create table if not exists public.fleet_job_links (
  job_id      uuid primary key references public.fleet_jobs(id) on delete cascade,
  rc_url      text,                                    -- /remote-control capability URL (SENSITIVE)
  rc_qr       text,
  cmd         text,                                    -- full launched command / directive
  metrics_url text,                                    -- e.g. W&B run URL
  log_tail    text,                                    -- recent log lines (P1)
  updated_at  timestamptz not null default now()
);
comment on table public.fleet_job_links is 'Private: /rc URL, full command, metrics, logs. Authed/service-role only.';

-- ── Convenience view: latest heartbeat + derived online status (RLS-respecting)
create or replace view public.fleet_machine_status
with (security_invoker = on) as
select
  m.id, m.name, m.kind, m.os, m.arch, m.specs, m.agent_version,
  m.created_at, m.last_seen_at,
  h.ts            as last_heartbeat_ts,
  h.cpu_pct, h.ram_pct, h.ram_used_mb, h.ram_total_mb, h.load_avg, h.gpu, h.uptime_s,
  case
    when m.last_seen_at is null                              then 'offline'
    when m.last_seen_at > now() - interval '30 seconds'      then 'online'
    when m.last_seen_at > now() - interval '2 minutes'       then 'stale'
    else 'offline'
  end as status
from public.fleet_machines m
left join lateral (
  select * from public.fleet_heartbeats hb
  where hb.machine_id = m.id
  order by hb.ts desc
  limit 1
) h on true;
comment on view public.fleet_machine_status is 'Latest heartbeat per machine + derived online/stale/offline.';
