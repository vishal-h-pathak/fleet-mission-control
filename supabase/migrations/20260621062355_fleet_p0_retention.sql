-- Fleet P0 — prune heartbeats to keep the time-series bounded (scalability).
create extension if not exists pg_cron;

-- Drop a prior schedule of the same name if re-run.
select cron.unschedule('fleet_prune_heartbeats')
  where exists (select 1 from cron.job where jobname = 'fleet_prune_heartbeats');

-- Every 30 min, delete heartbeats older than 48h.
select cron.schedule(
  'fleet_prune_heartbeats',
  '*/30 * * * *',
  $$delete from public.fleet_heartbeats where ts < now() - interval '48 hours'$$
);
