// Shared UUID-shape validator for the three decision routes
// (app/api/sessions/[id]/{approve,redispatch,reject}/route.ts). `fleet_sessions.id`
// is a uuid pk; rejecting non-uuid-shaped path params before querying avoids a
// wasted round-trip to Supabase for an obviously-invalid id. Previously this
// regex was copy-pasted in all three route files — pulled out here so there's
// one definition to keep in sync.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSessionId(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}
