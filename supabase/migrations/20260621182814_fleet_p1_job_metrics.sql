-- Fleet P1 — per-generation metric time-series for fitness sparklines.
-- Public-readable (fitness numbers are non-sensitive; this is the showcase content).
create table if not exists public.fleet_job_metrics (
  id           bigint generated always as identity primary key,
  job_id       uuid not null references public.fleet_jobs(id) on delete cascade,
  ts           timestamptz not null default now(),
  gen          integer,
  best_fitness real,
  mean_fitness real,
  extra        jsonb
);
-- Idempotent upserts per (job, generation). Null-gen rows (ad-hoc points) just insert.
create unique index if not exists fleet_job_metrics_job_gen_uniq
  on public.fleet_job_metrics (job_id, gen);
create index if not exists fleet_job_metrics_job_ts_idx
  on public.fleet_job_metrics (job_id, ts);

alter table public.fleet_job_metrics enable row level security;
drop policy if exists fleet_job_metrics_public_read on public.fleet_job_metrics;
create policy fleet_job_metrics_public_read on public.fleet_job_metrics
  for select to anon, authenticated using (true);
revoke all on public.fleet_job_metrics from anon, authenticated;
grant select on public.fleet_job_metrics to anon, authenticated;

alter publication supabase_realtime add table public.fleet_job_metrics;
