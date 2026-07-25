// Fleet MCv2 — pure wave/session LAUNCH state machine, shared by the `dispatch`
// Edge Function (Deno) and its Node test (test/dispatch-logic.test.mjs). No I/O, no
// jsr imports — same pattern as ingest/session-logic.mjs, for the same reason: the
// function and the test exercise the SAME code, not two drifting copies.
//
// This module governs an EXECUTION SURFACE (see the migration's design note), so it
// is written as a closed set of allowed transitions plus explicit refusal reasons —
// anything not enumerated here is refused, not tolerated.

// ── Wave dispatch lifecycle ──────────────────────────────────────────────────
// draft → confirmed → launching → dispatched → reviewing → done | abandoned
export const WAVE_STATUSES_V2 = Object.freeze([
  "draft", "confirmed", "launching", "dispatched", "reviewing", "done", "abandoned",
]);

// The ONLY statuses from which work is pollable/claimable. `confirmed` is the
// operator's explicit go (set solely by the authed cockpit route); `launching`
// means a sibling agent already claimed something from the same wave.
// `abandoned` is deliberately absent — abandoning a wave is the kill switch and
// must stop further claims immediately, even mid-launch.
export const WAVE_LAUNCHABLE = Object.freeze(new Set(["confirmed", "launching"]));

// A session is launchable only from `planned`. Anything else means it already ran
// (running/done/...) or the operator has decided it — never relaunch that.
export const SESSION_LAUNCHABLE_STATUS = "planned";

export const DISPATCH_ACTIONS = Object.freeze(new Set(["poll", "claim", "ack"]));

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LAUNCH_ERROR_MAX = 2000;

// ── Poll projection — the directive firewall ─────────────────────────────────
// SECURITY INVARIANT (c): the free-text `directive` is RECORD-ONLY and is never
// transported to an agent. The agent builds what it runs from validated structured
// fields alone (and revalidates them against its own local allowlist — invariant
// (d): the bus is untrusted input to the agent).
//
// This is an allowlist, not a denylist: poll responses are BUILT from
// POLL_SESSION_FIELDS, so a column added to fleet_sessions later cannot leak by
// default. POLL_FORBIDDEN_FIELDS exists only so the test can assert the intent
// directly against a row that carries them.
export const POLL_SESSION_FIELDS = Object.freeze([
  "id", "name", "project", "repo", "branch", "worktree", "model", "prompt_ref",
]);
export const POLL_WAVE_FIELDS = Object.freeze([
  "id", "name", "status", "project_id",
]);
export const POLL_FORBIDDEN_FIELDS = Object.freeze([
  "directive",      // record-only by design — the whole point of this firewall
  "last_message",   // sensitive (final assistant message)
  "rc_url",         // sensitive (live steering URL)
  "pr_url",         // sensitive (leaks repo + branch + content)
]);

function project(row, fields) {
  const out = {};
  for (const k of fields) out[k] = row?.[k] ?? null;
  return out;
}

export function projectPollSession(row) {
  return project(row, POLL_SESSION_FIELDS);
}

export function projectPollWave(wave) {
  return project(wave, POLL_WAVE_FIELDS);
}

export function isWaveLaunchable(status) {
  return WAVE_LAUNCHABLE.has(status);
}

// ── Claim ────────────────────────────────────────────────────────────────────
// `session` is the joined row: { machine_id, status, claimed_at, wave_status }.
//
// A missing session and a session belonging to ANOTHER machine return the SAME
// reason (`unknown_session`) — invariant (b) is about information too: an agent
// must not be able to probe which session ids exist on other machines.
export function claimPrecheck({ session, machineId }) {
  if (!machineId) return { ok: false, reason: "unknown_session" };
  if (!session) return { ok: false, reason: "unknown_session" };
  if (session.machine_id !== machineId) return { ok: false, reason: "unknown_session" };
  if (!isWaveLaunchable(session.wave_status)) {
    return { ok: false, reason: "wave_not_launchable" };
  }
  if (session.status !== SESSION_LAUNCHABLE_STATUS) {
    return { ok: false, reason: "session_not_launchable" };
  }
  if (session.claimed_at != null) return { ok: false, reason: "already_claimed" };
  return { ok: true };
}

// Winning a claim arms the wave. Only `confirmed` → `launching`; a wave already
// `launching` stays put (idempotent), and no other status is reachable from here —
// a claim can never resurrect an abandoned/dispatched wave.
export function nextWaveStatusOnClaim(cur) {
  return cur === "confirmed" ? "launching" : cur;
}

// ── Ack ──────────────────────────────────────────────────────────────────────
// Deliberately WEAKER than claimPrecheck, in exactly two ways:
//   • the wave's status is not checked — a late ack on an already-`dispatched` (or
//     abandoned) wave must still record what happened to that session. Losing the
//     audit trail is worse than a no-op wave update, and waveLaunchOutcome refuses
//     to move a non-launchable wave anyway.
//   • the session's status is not checked — by the time an ack lands, ingest may
//     already have flipped the session `planned` → `running` from the launched
//     process's own telemetry. That is the success path, not an error.
// Ownership is still absolute: only the machine that WON the claim may ack it.
export function ackPrecheck({ session, machineId }) {
  if (!machineId) return { ok: false, reason: "unknown_session" };
  if (!session) return { ok: false, reason: "unknown_session" };
  if (session.machine_id !== machineId) return { ok: false, reason: "unknown_session" };
  if (session.claimed_at == null || session.claimed_by !== machineId) {
    return { ok: false, reason: "not_claimed" };
  }
  return { ok: true };
}

// launched_at is preserve-on-null: a duplicate or late ack never restamps it.
// A successful ack clears any prior launch_error (an agent that retried and won).
export function ackSessionPatch({ session, ok, error, nowIso }) {
  if (ok) {
    return {
      launched_at: session?.launched_at ?? nowIso,
      launch_error: null,
      updated_at: nowIso,
    };
  }
  const msg = typeof error === "string" && error.trim()
    ? error.trim().slice(0, LAUNCH_ERROR_MAX)
    : "launch_failed";
  return { launch_error: msg, updated_at: nowIso };
}

// A session still owes the wave a launch outcome while it has neither launched nor
// terminally failed. Note an UNCLAIMED session counts as pending: the wave is not
// dispatched until every session is accounted for.
export function isLaunchPending(s) {
  return s?.launched_at == null && s?.launch_error == null;
}

// Given every session of a wave, decide the wave's post-ack state.
// Returns null when nothing should change — which covers, deliberately:
//   • a wave that is not launchable (abandoned mid-flight, or already dispatched):
//     never regress or resurrect it from an ack;
//   • sessions still pending: stay `launching`;
//   • an empty wave: stay put (the staleness sweeper surfaces it — see SCHEMA_V2).
//
// launch_error is set whenever >=1 session failed, not only when ALL did: a wave
// that launched 2 of 3 is still a launch the operator must look at, and the count
// is strictly more informative than a boolean. `dispatched` here means "the launch
// phase is over", not "everything succeeded".
export function waveLaunchOutcome({ waveStatus, sessions }) {
  if (!isWaveLaunchable(waveStatus)) return null;
  const rows = Array.isArray(sessions) ? sessions : [];
  if (!rows.length) return null;
  if (rows.some(isLaunchPending)) return null;
  const total = rows.length;
  const failed = rows.filter((s) => s.launched_at == null && s.launch_error != null).length;
  return {
    status: "dispatched",
    launch_error: failed ? `${failed}/${total} sessions failed to launch` : null,
  };
}
