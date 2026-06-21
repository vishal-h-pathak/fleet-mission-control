-- Fleet P0 — token hashing helpers for the ingest path.
create extension if not exists pgcrypto;

-- token_hash must be unique so the ingest fn can resolve a machine from its token.
create unique index if not exists fleet_machine_secrets_token_hash_uniq
  on public.fleet_machine_secrets (token_hash);

-- Register (or rotate) a machine and return a fresh plaintext token ONCE.
-- Only the sha256 hash is stored. Call with the service role (SQL editor / API route).
--   select public.fleet_register_machine('sentry', 'compute', '100.86.154.46');
create or replace function public.fleet_register_machine(
  p_name text,
  p_kind text default 'node',
  p_tailscale_ip text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_machine_id uuid;
  v_token text;
begin
  insert into public.fleet_machines (name, kind)
  values (p_name, coalesce(p_kind,'node'))
  on conflict (name) do update set kind = excluded.kind
  returning id into v_machine_id;

  v_token := encode(gen_random_bytes(24), 'hex');

  insert into public.fleet_machine_secrets (machine_id, token_hash, tailscale_ip, rotated_at)
  values (v_machine_id, encode(digest(v_token,'sha256'),'hex'), p_tailscale_ip, now())
  on conflict (machine_id) do update
    set token_hash = excluded.token_hash,
        tailscale_ip = coalesce(excluded.tailscale_ip, public.fleet_machine_secrets.tailscale_ip),
        rotated_at = now();

  return v_token;
end;
$$;

-- Lock the function down: not callable by anon/authenticated.
revoke all on function public.fleet_register_machine(text,text,text) from public, anon, authenticated;
