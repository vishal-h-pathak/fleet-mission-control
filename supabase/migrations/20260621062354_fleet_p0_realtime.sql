-- Fleet P0 — add the public read tables to the realtime publication.
alter publication supabase_realtime add table public.fleet_machines;
alter publication supabase_realtime add table public.fleet_heartbeats;
alter publication supabase_realtime add table public.fleet_jobs;
