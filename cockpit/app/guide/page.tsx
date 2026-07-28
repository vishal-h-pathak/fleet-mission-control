// cockpit/app/guide/page.tsx
// Static guide page — no data fetching needed; all content is prose + CSS/SVG.
// Auth-gated via proxy.ts (same as every other cockpit route).

import { CockpitNav } from "../nav";
import { SignOutButton } from "../sign-out-button";
import { STATUS_STYLE } from "@/lib/ui/session-format";
import type { SessionStatus } from "@/lib/inbox/types";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatusChip({ status }: { status: SessionStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
    >
      {status}
    </span>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-12 scroll-mt-8">
      <h2 className="text-base font-semibold text-zinc-50">{title}</h2>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-zinc-300">
        {children}
      </div>
    </section>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-400/20 bg-amber-500/5 px-4 py-3 text-amber-300/90 text-sm leading-relaxed">
      {children}
    </div>
  );
}

function Term({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 py-2 border-b border-white/5 last:border-0">
      <dt className="font-mono text-xs font-medium text-zinc-200 self-start pt-0.5">
        {term}
      </dt>
      <dd className="text-sm text-zinc-400">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSS mockups of each screen
// ---------------------------------------------------------------------------

function InboxMockup() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs font-mono">
      <div className="mb-3 text-zinc-500 text-[10px] uppercase tracking-widest">
        Inbox mockup
      </div>
      {/* Needs you */}
      <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">
        Needs you
      </div>
      <div className="rounded-lg border border-white/8 bg-white/[0.04] px-3 py-2 mb-1 flex items-center justify-between">
        <span className="text-zinc-300">session: feat/auth-refactor</span>
        <StatusChip status="waiting" />
      </div>
      {/* Awaiting review */}
      <div className="mt-3 mb-2 text-[10px] uppercase tracking-wider text-zinc-500">
        Awaiting review
      </div>
      <div className="rounded-lg border border-white/8 bg-white/[0.04] px-3 py-2 mb-1 flex items-center justify-between">
        <span className="text-zinc-300">session: feat/nav-polish</span>
        <StatusChip status="done" />
      </div>
      <div className="rounded-lg border border-white/8 bg-white/[0.04] px-3 py-2 flex items-center justify-between">
        <span className="text-zinc-300">session: fix/type-errors</span>
        <StatusChip status="done" />
      </div>
      {/* Actions */}
      <div className="mt-3 flex gap-2">
        <span className="rounded bg-emerald-500/10 border border-emerald-400/20 px-2 py-0.5 text-[10px] text-emerald-300">
          approve
        </span>
        <span className="rounded bg-amber-500/10 border border-amber-400/20 px-2 py-0.5 text-[10px] text-amber-300">
          redispatch
        </span>
        <span className="rounded bg-rose-500/10 border border-rose-400/20 px-2 py-0.5 text-[10px] text-rose-300">
          reject
        </span>
        <span className="rounded bg-white/5 border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400">
          dismiss
        </span>
      </div>
    </div>
  );
}

function WavesMockup() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs font-mono">
      <div className="mb-3 text-zinc-500 text-[10px] uppercase tracking-widest">
        Waves mockup
      </div>
      {/* machine rail */}
      <div className="mb-3 flex gap-2">
        <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-zinc-300">
          mac ● online
        </span>
        <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-zinc-500">
          win ○ idle
        </span>
      </div>
      {/* wave group */}
      <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
        wave: auth-hardening
      </div>
      <div className="space-y-1">
        {(
          [
            ["feat/auth-refactor", "running"],
            ["feat/nav-polish", "done"],
            ["feat/type-errors", "planned"],
          ] as [string, SessionStatus][]
        ).map(([branch, st]) => (
          <div
            key={branch}
            className="rounded border border-white/8 bg-white/[0.04] px-3 py-1.5 flex items-center justify-between"
          >
            <span className="text-zinc-300">{branch}</span>
            <StatusChip status={st} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ComposeMockup() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs font-mono">
      <div className="mb-3 text-zinc-500 text-[10px] uppercase tracking-widest">
        Compose mockup
      </div>
      <div className="space-y-2">
        <div className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-zinc-400">
          project: fleet-mission-control
        </div>
        <div className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-zinc-400">
          prompt: ops/prompts/PROMPT_mcv2_guide.md
        </div>
        <div className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-zinc-400">
          machine: mac · model: sonnet · branch: feat/mcv2-guide
        </div>
      </div>
      <div className="mt-3 rounded border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] text-zinc-500">
        preview directive…
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input
          readOnly
          value=""
          placeholder="type wave name to arm"
          className="flex-1 rounded border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-zinc-500 placeholder-zinc-600"
        />
        <span className="rounded bg-sky-500/10 border border-sky-400/20 px-3 py-1 text-[10px] text-sky-400 opacity-40">
          Confirm
        </span>
      </div>
    </div>
  );
}

function GuideMockup() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs font-mono">
      <div className="mb-3 text-zinc-500 text-[10px] uppercase tracking-widest">
        Guide mockup
      </div>
      <div className="space-y-1 text-zinc-500 text-[10px]">
        <div>§1 What this is &amp; why</div>
        <div>§2 The objects</div>
        <div>§3 The four screens</div>
        <div>§4 Anatomy of a dispatch</div>
        <div>§5 Your first wave</div>
        <div>§6 Status &amp; term glossary</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dispatch timeline
// ---------------------------------------------------------------------------

const DISPATCH_STEPS: Array<{ label: string; detail: string }> = [
  {
    label: "Operator presses Confirm",
    detail:
      "The cockpit creates a wave record and stamps it confirmed with the signed-in operator's email and the exact timestamp. Free-text can't sneak in here — the directive is assembled server-side from a committed prompt file.",
  },
  {
    label: "Agent polls and claims",
    detail:
      "Each machine's fleet-agent polls the bus on a short interval. When it sees a confirmed dispatch addressed to it, it atomically sets status → claimed (race-safe: only one agent wins). The directive is read directly from the bus row.",
  },
  {
    label: "Agent revalidates everything",
    detail:
      "Before touching the shell, the agent runs its own hard-coded allowlist checks: is the repo one of the fixed permitted repos? Does the prompt_ref exist as a committed file on origin/main right now? Do the characters in the directive pass a charset filter? Computed paths (worktree, branch) are derived locally, never accepted from the bus. Revalidation failure aborts silently — nothing launches.",
  },
  {
    label: "tmux session launches",
    detail:
      "A new tmux window opens, cds into the worktree, and runs Claude Code with the directive pasted unsubmitted. An /rc URL is generated and written back to the bus so the operator can steer the session live if needed.",
  },
  {
    label: "Session works and STOPs",
    detail:
      "The session executes the plan: reads files, writes code, runs tests, commits on its branch. When done it outputs a STOP marker and exits the tmux pane. The agent's on-exit hook fires.",
  },
  {
    label: "Completion hook fires",
    detail:
      "The hook pushes a push notification (via ntfy), opens a draft PR on GitHub, and writes a session summary back to the bus. Status transitions to done.",
  },
  {
    label: "Session lands in Inbox",
    detail:
      "The cockpit's Awaiting Review group shows the session. The operator reads the summary, checks the draft PR on GitHub, and makes a decision: approve (merge), redispatch with feedback, reject, or dismiss. Nothing merges itself.",
  },
];

function DispatchTimeline() {
  return (
    <ol className="relative mt-2 space-y-0">
      {DISPATCH_STEPS.map((step, i) => (
        <li key={i} className="relative flex gap-4 pb-6 last:pb-0">
          {/* vertical connector */}
          {i < DISPATCH_STEPS.length - 1 && (
            <div
              className="absolute left-[11px] top-6 bottom-0 w-px bg-white/10"
              aria-hidden
            />
          )}
          {/* dot */}
          <div className="relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/15 bg-zinc-800 text-[10px] font-medium text-zinc-400">
            {i + 1}
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-100">{step.label}</p>
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">
              {step.detail}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function GuidePage() {
  const allStatuses: SessionStatus[] = [
    "planned",
    "running",
    "waiting",
    "done",
    "reviewed",
    "merged",
    "rejected",
    "lost",
  ];

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-50">Guide</h1>
        <SignOutButton />
      </header>
      <CockpitNav active="guide" />

      {/* ------------------------------------------------------------------ */}
      {/* §1 What this is & why */}
      {/* ------------------------------------------------------------------ */}
      <Section id="what" title="What this is &amp; why">
        <p>
          Mission Control is an operator cockpit for running a fleet of AI
          coding sessions from anywhere. Each session is a headless Claude Code
          process running inside a tmux pane on one of your machines —
          executing a plan, writing code on a branch, and stopping cleanly when
          it is done. The cockpit is how you see what the fleet is doing, make
          decisions on finished work, and dispatch new waves without being
          physically at the machine.
        </p>
        <p>
          The problem it solves is a coordination one. The delegation lifecycle
          — plan, dispatch, watch, review, merge — used to be scattered across
          local terminals, chat threads, push notifications, and a
          laptop-bound launcher script. The operator's mental model is
          work-centric (project → wave → session → decision), but the machines
          are machine-centric. Mission Control is the shared index and decision
          surface over both: one place where all in-flight work is visible and
          every decision is recorded.
        </p>
        <p>
          Be clear about what it is <strong>not</strong>. Diffs live on GitHub
          — draft PRs are the review gate and merging happens there, not here.
          Live session steering lives in Claude Code's{" "}
          <span className="font-mono text-zinc-200">/rc</span> interface; the
          cockpit surfaces an /rc URL per session but does not rebuild that
          control plane. Planning lives in the operator's Cowork sessions.
          This app deliberately rebuilds none of those things. It is the index
          and decision layer, not the execution layer.
        </p>
        <p>
          The security model reflects the asymmetry between breadth and depth.
          Machine telemetry (heartbeats, job state, session status) flows over
          a shared Supabase bus. The public surface of that bus is readable
          with an anon key. Sensitive fields — /rc URLs, log tails,
          per-machine tokens — live in private tables behind the service-role
          key and are never sent to the browser. A dispatch can only be
          confirmed by a signed-in allowlisted operator. Nothing ever runs
          that was not committed to origin/main first.
        </p>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* §2 The objects */}
      {/* ------------------------------------------------------------------ */}
      <Section id="objects" title="The objects">
        <div className="space-y-5">
          <div>
            <p className="font-medium text-zinc-100">Project</p>
            <p className="mt-1">
              A repository (or sub-project within a monorepo) that sessions
              work in. Projects are the top-level grouping: every wave and
              every session belongs to one. Configured by the operator; only
              active projects appear in the Compose picker.
            </p>
          </div>
          <div>
            <p className="font-medium text-zinc-100">Wave</p>
            <p className="mt-1">
              A named batch of sessions dispatched together toward a shared
              goal — for example, "auth-hardening" or "mcv2-wave3-build". A
              wave groups the individual sessions on the Waves board and gives
              the operator a unit of intent to track across machines and time.
              Waves move from <span className="font-mono text-zinc-200">draft</span>{" "}
              → <span className="font-mono text-zinc-200">confirmed</span> →{" "}
              <span className="font-mono text-zinc-200">completed</span>.
            </p>
          </div>
          <div>
            <p className="font-medium text-zinc-100">Session</p>
            <p className="mt-1">
              One Claude Code process: one branch, one machine, one prompt
              file, one model. Sessions are the atoms of the fleet. They
              progress through a lifecycle expressed by the status vocabulary
              below — each status maps to the same chip you see on the Waves
              board and in the Inbox.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {allStatuses.map((s) => (
                <StatusChip key={s} status={s} />
              ))}
            </div>
            <div className="mt-3 space-y-1 text-sm text-zinc-400">
              <p>
                <StatusChip status="planned" /> — created, not yet dispatched.
              </p>
              <p>
                <StatusChip status="running" /> — the tmux session is live and
                the agent is working.
              </p>
              <p>
                <StatusChip status="waiting" /> — the session paused and needs
                operator input before it can continue.
              </p>
              <p>
                <StatusChip status="done" /> — session exited cleanly; draft PR
                opened; awaiting your review in the Inbox.
              </p>
              <p>
                <StatusChip status="reviewed" /> — you have looked at the PR
                and approved it (merge happens on GitHub).
              </p>
              <p>
                <StatusChip status="merged" /> — the branch has been merged to
                main.
              </p>
              <p>
                <StatusChip status="rejected" /> — you rejected the session's
                output; it will not be merged.
              </p>
              <p>
                <StatusChip status="lost" /> — the 30-minute sweeper marked
                this session lost because it stopped reporting without a clean
                exit (e.g. the machine rebooted or the tmux pane was killed).
              </p>
            </div>
          </div>
          <div>
            <p className="font-medium text-zinc-100">Decision</p>
            <p className="mt-1">
              A recorded operator action on a completed session: approve (you
              intend to merge the draft PR), redispatch with feedback (send
              the session back with a note), reject (close without merging), or
              dismiss (acknowledge without acting). Decisions are written to the
              bus and feed the Recently Decided group in the Inbox.
            </p>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* §3 The four screens */}
      {/* ------------------------------------------------------------------ */}
      <Section id="screens" title="The four screens">
        <div className="space-y-8">
          {/* Inbox */}
          <div>
            <p className="font-medium text-zinc-100">
              Inbox —{" "}
              <span className="font-normal text-zinc-400">
                what needs you right now
              </span>
            </p>
            <p className="mt-1">
              The landing screen. Three groups: <strong>Needs You</strong>{" "}
              (sessions in <StatusChip status="waiting" /> state that have
              paused for operator input), <strong>Awaiting Review</strong>{" "}
              (sessions that finished and need a decision), and{" "}
              <strong>Recently Decided</strong> (a capped recent history of
              decisions you have already made). Polling keeps the view live
              without a full reload. Decision actions — approve, redispatch,
              reject, dismiss — are the only write operations the cockpit
              exposes.
            </p>
            <div className="mt-3">
              <InboxMockup />
            </div>
          </div>

          {/* Waves */}
          <div>
            <p className="font-medium text-zinc-100">
              Waves —{" "}
              <span className="font-normal text-zinc-400">
                what the fleet is doing, live
              </span>
            </p>
            <p className="mt-1">
              A board view grouped by wave, then by project within each wave.
              Every session is visible with its current status. A machine rail
              at the top shows which machines are online. Refreshes on a short
              poll interval so running sessions visibly progress. This is the
              screen to leave open while a wave is in flight.
            </p>
            <div className="mt-3">
              <WavesMockup />
            </div>
          </div>

          {/* Compose */}
          <div>
            <p className="font-medium text-zinc-100">
              Compose —{" "}
              <span className="font-normal text-zinc-400">
                build and confirm a wave
              </span>
            </p>
            <p className="mt-1">
              A wizard for building a dispatch. You pick a project, a prompt
              file (fetched from the list of committed prompts on origin/main),
              a target machine, a model, and a branch name. A directive preview
              renders before you commit to anything. To actually confirm, you
              must type the wave name into an arm field — deliberate friction
              that prevents accidental dispatches. The Confirm button only
              becomes active once the name matches.
            </p>
            <div className="mt-3">
              <ComposeMockup />
            </div>
          </div>

          {/* Guide */}
          <div>
            <p className="font-medium text-zinc-100">
              Guide —{" "}
              <span className="font-normal text-zinc-400">this page</span>
            </p>
            <p className="mt-1">
              A persistent reference: what Mission Control is, how it works,
              what happens at each step of a dispatch, and a glossary of every
              term and status. No data is fetched; content is static and
              server-rendered. Reach it from the nav on any screen.
            </p>
            <div className="mt-3">
              <GuideMockup />
            </div>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* §4 Anatomy of a dispatch */}
      {/* ------------------------------------------------------------------ */}
      <Section id="dispatch" title="Anatomy of a dispatch">
        <p>
          When you press Confirm in Compose, a deterministic sequence of events
          unfolds across the cockpit, the Supabase bus, and the target machine.
          Each step is traceable; the safety properties are threaded through
          the mechanism rather than bolted on separately.
        </p>
        <div className="mt-6">
          <DispatchTimeline />
        </div>
        <p className="mt-6 text-zinc-400">
          Two safety invariants to keep in mind. First, only committed prompt
          files can run — the agent re-fetches the prompt from origin/main at
          claim time, so a prompt that was deleted or never merged will cause
          the dispatch to abort cleanly. Second, the cockpit never merges
          anything: every merge is a deliberate human action on GitHub.
        </p>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* §5 Your first wave */}
      {/* ------------------------------------------------------------------ */}
      <Section id="first-wave" title="Your first wave">
        <p>
          A hands-on walkthrough. Before you start, you need one thing: a
          prompt file committed and pushed to origin/main in the target repo.
          The file should follow the project's prompt conventions and end with
          a clear STOP-and-report instruction. That's it — no other setup is
          required.
        </p>
        <ol className="mt-2 list-none space-y-4">
          {[
            [
              "Open Compose",
              "Click Compose in the nav. The wizard loads with the list of active projects and online machines.",
            ],
            [
              "Pick project and prompt",
              "Select the project the session should work in. The prompt picker fetches the list of committed prompt files from origin/main for that repo — pick yours. The directive preview renders immediately so you can verify the content before dispatching.",
            ],
            [
              "Set machine, model, and branch",
              "Choose the target machine (it must have its fleet-agent running), a Claude model (Haiku for mechanical work, Sonnet for most tasks, Opus for hard architectural work), and the branch name the session should create.",
            ],
            [
              "Name and arm the wave",
              'Give the wave a descriptive name (e.g. "auth-hardening" or "mcv2-guide"). Type that exact name into the arm field. The Confirm button activates.',
            ],
            [
              "Confirm and watch /waves",
              "Press Confirm. The wave status moves to confirmed. Switch to the Waves board — within seconds you should see the session flip from planned → running as the agent on the target machine claims and launches it.",
            ],
            [
              "Wait for the push notification",
              "When the session finishes it pushes a notification via ntfy and opens a draft PR on GitHub. The session status moves to done.",
            ],
            [
              "Review the draft PR",
              "Open the draft PR link on GitHub. Read the diff. Check the commit messages. This is where the work actually lives — the cockpit's summary is a signal, not a substitute for the diff.",
            ],
            [
              "Decide in Inbox",
              "Return to the Inbox. The session appears in Awaiting Review. Choose: approve (you'll merge the PR on GitHub), redispatch with feedback (send it back with a note), reject, or dismiss. Your decision is recorded on the bus.",
            ],
          ].map(([title, body], i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500/15 border border-sky-400/20 text-[10px] font-medium text-sky-300">
                {i + 1}
              </span>
              <div>
                <p className="font-medium text-zinc-100">{title}</p>
                <p className="mt-0.5 text-zinc-400">{body}</p>
              </div>
            </li>
          ))}
        </ol>

        <Note>
          <strong>Current caveats.</strong> Dispatch only works if the target
          machine's fleet-agent process is running and polling. A session that
          is killed abruptly (machine reboot, tmux kill-pane) will not report
          its exit — the 30-minute staleness sweeper will eventually mark it{" "}
          <StatusChip status="lost" />. Merging always happens on GitHub, never
          in this cockpit.
        </Note>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* §6 Glossary */}
      {/* ------------------------------------------------------------------ */}
      <Section id="glossary" title="Status &amp; term glossary">
        <p className="text-zinc-500">
          Quick reference for every status value and term used in Mission
          Control.
        </p>

        <div className="mt-4">
          <p className="mb-2 text-xs uppercase tracking-widest text-zinc-500">
            Session status
          </p>
          <dl className="rounded-xl border border-white/8 bg-white/[0.02] px-4 divide-y divide-white/5">
            <Term term="planned">
              Session created, directive assembled, not yet dispatched to a
              machine.
            </Term>
            <Term term="running">
              tmux session is live; the agent is actively executing the
              directive.
            </Term>
            <Term term="waiting">
              Session paused and surfaced a question for the operator. Appears
              in the Needs You group.
            </Term>
            <Term term="done">
              Session exited cleanly. Draft PR opened. Awaiting an operator
              decision in the Inbox.
            </Term>
            <Term term="reviewed">
              Operator approved the session's output. Merge is expected to
              follow on GitHub.
            </Term>
            <Term term="merged">Branch merged to main on GitHub.</Term>
            <Term term="rejected">
              Operator rejected the session's output. Branch will not be
              merged.
            </Term>
            <Term term="lost">
              Session stopped reporting without a clean exit. The staleness
              sweeper (30-minute window) set this status. Check the machine.
            </Term>
          </dl>
        </div>

        <div className="mt-6">
          <p className="mb-2 text-xs uppercase tracking-widest text-zinc-500">
            Wave lifecycle
          </p>
          <dl className="rounded-xl border border-white/8 bg-white/[0.02] px-4 divide-y divide-white/5">
            <Term term="draft">
              Wave is being composed in the wizard. Not yet sent to any
              machine.
            </Term>
            <Term term="confirmed">
              Operator confirmed the dispatch. The wave's sessions are queued
              for the target machine(s) to claim.
            </Term>
            <Term term="completed">
              All sessions in the wave have reached a terminal status (done,
              reviewed, merged, rejected, or lost).
            </Term>
          </dl>
        </div>

        <div className="mt-6">
          <p className="mb-2 text-xs uppercase tracking-widest text-zinc-500">
            Terms
          </p>
          <dl className="rounded-xl border border-white/8 bg-white/[0.02] px-4 divide-y divide-white/5">
            <Term term="wave">
              A named batch of sessions dispatched together toward a shared
              goal. The unit of intent the operator tracks.
            </Term>
            <Term term="claim">
              The atomic act of a machine's fleet-agent taking ownership of a
              confirmed dispatch. Only one agent wins the race.
            </Term>
            <Term term="dispatch">
              Sending a confirmed wave to a target machine so its agent can
              claim it and launch a session.
            </Term>
            <Term term="rc / /rc">
              Claude Code's built-in remote-control interface. The cockpit
              surfaces a per-session /rc URL so the operator can steer a
              running session; this cockpit does not rebuild /rc itself.
            </Term>
            <Term term="draft PR">
              A GitHub pull request opened automatically by the session's
              completion hook. The operator reviews the diff here before
              deciding in the Inbox.
            </Term>
            <Term term="dismiss">
              An Inbox decision that acknowledges a session without approving,
              redispatching, or rejecting it. Moves the session to Recently
              Decided without further action.
            </Term>
            <Term term="sweeper">
              A background process that polls for sessions last seen more than
              30 minutes ago with no clean exit, and marks them lost.
            </Term>
            <Term term="directive">
              The full text of the instruction assembled from the chosen prompt
              file and sent to the session. Always derived server-side from a
              committed prompt; never typed free-form by the operator into the
              bus.
            </Term>
            <Term term="allowlist">
              The hard-coded set of permitted repos and operators. The agent
              enforces this locally at claim time, independently of whatever
              the bus says.
            </Term>
            <Term term="bus">
              The Supabase project that acts as the shared message bus:
              machines push telemetry in, the cockpit reads it out.
            </Term>
          </dl>
        </div>
      </Section>

      {/* bottom padding */}
      <div className="h-16" />
    </main>
  );
}
