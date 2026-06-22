# Fleet Mission Control — how it works (plain-English guide)

> For anyone (including future-you) who opens this cold and thinks "wait, how does this actually
> run?" No jargon. The short version: **setup was the scripts; using it is just a website. The
> machines take care of themselves.**

## One sentence
Each of your machines quietly reports what it's doing to a shared spot in the cloud, and a website
reads that and shows it to you — so from your phone or laptop you can watch every machine, follow
your runs, and tell a machine to do something, without ever SSHing in.

## The mental model: a whiteboard in the cloud
Picture a whiteboard that lives in the cloud (that's **Supabase**).

- Every machine runs a tiny program — the **reporter** — that walks up to the whiteboard every ~10
  seconds and writes: *"I'm alive, here's my CPU/GPU/RAM, here's the job I'm running and how it's
  going."*
- The **dashboard** (the website) just *reads* the whiteboard and draws it for you, live.
- When you want a machine to *do* something, you (via the dashboard) pin a note to the whiteboard:
  *"mac-cockpit: run a check."* Every machine also runs an **agent** that watches the whiteboard for
  notes addressed to it, does the task, and writes the result back.

The important part: **machines only ever reach *out* to the whiteboard — nothing on the internet
reaches *in* to them.** That's what keeps it safe. Your machines stay behind Tailscale with no open
doors; they just push updates out and pull their to-dos.

## The pieces
| Piece | What it is | Where it runs |
|---|---|---|
| **Reporter** | Tiny program that pushes status ("I'm here, here's my state") | Each machine, as a background service |
| **Agent** | Tiny program that pulls + runs a fixed list of allowed commands | Each machine, as a background service |
| **Supabase** | The cloud whiteboard + a secure mailroom that checks each machine's token | Cloud |
| **Dashboard** | The website you look at | Vercel (`fleet-mission-control.vercel.app`) |
| **The FLEET link** | A button on `vishal.pa.thak.io` that takes you to the dashboard | Your portfolio site |

Your machines today: **`mac-cockpit`** (the Mac) and **`sentry`** (the 5900X/3080Ti workstation, in
WSL). Adding more later is the same recipe, once each.

## "Do I have to run scripts every time?" — No.
Once a machine is set up, you run **nothing** to use the system. The reporter and agent are installed
as **background services** — launchd on the Mac, systemd on `sentry` — that start on their own and
**survive reboots**. If you restart a machine, it reappears online by itself in ~10 seconds.

The commands you've seen fall into three buckets — only one is "every time," and that one is "open a
website":

1. **One-time per machine (already done for both):** register the machine + install its services.
   You'd only touch this again when you add a *brand-new* machine.
2. **Only when we're *building* a new feature:** the `ops/waves/setup-fleet-*-wave.sh` launchers, the
   prompt files in `ops/prompts/`, the consolidate prompt. That's the *development* workflow — it has
   nothing to do with *using* the system. When everything's just running, you never touch these.
3. **Daily use:** nothing to run. Open the dashboard.

## What you actually do day-to-day
1. Open the dashboard — the **FLEET** button on your site, or `fleet-mission-control.vercel.app`.
2. See every machine (online/offline, CPU/RAM/GPU) and every running job with its live fitness curve.
   This part is public (it's a portfolio showcase).
3. **Sign in** (your dashboard password) to do the private things: read a job's logs, dispatch a
   command, or tap a job's **Open in remote control** to drop into steering that session from your
   phone.

## What happens when… (so nothing feels mysterious)
- **You reboot the Mac or `sentry`** → the services auto-start → the machine is back online in ~10s.
  You do nothing.
- **You add a NEW machine** → run the one-time bootstrap on it once (register it, drop in its token,
  install the service). Then it's permanent like the others.
- **We build a NEW capability** (e.g. the "launch a run from your phone" verb) → that's a one-off dev
  session. Afterward it just works; there's no per-use script.
- **A run finishes / a curve updates** → the reporter notices and the dashboard updates itself live.

## How a delegated run syncs its work back (commit → push, with artifact as backup)
When you hand a machine a *building* task — e.g. `cg run <repo> "<goal>"` on the box — a headless
Claude session does the work in that repo's checkout. For its results to reach you, that session must
not just finish; it must **commit on its branch and `git push` to GitHub** *before* it stops. (That
ordering is now a frozen rule — see `ops/prompts/PROMPT_fleet_conventions.md`, "Commit → push →
STOP".) Then on the Mac you `cg pull` / `cg morning` and the work is right there.

**Why the push just works (no passwords, no prompts):** the box (`sentry`, in WSL) has the GitHub CLI
(`gh`) signed in as `vishal-h-pathak`, and git is wired to borrow `gh`'s token as its credential
helper for GitHub — so any `git push` to `github.com/vishal-h-pathak/*` authenticates silently, even
from a headless tmux session with no human there to type a password. *Verified live on 2026-06-22:* a
real write-auth `git push --dry-run` to a fresh branch succeeded on **both** `cellular-gaits` and
`portfolio` with terminal prompting disabled (so it can't be a hidden "type your password" path). The
token carries `repo` + `workflow` scopes, which is all a push needs.

> The nuts and bolts, if you ever re-check it: `git config --get-urlmatch credential.helper
> https://github.com` on the box returns `!/usr/bin/gh auth git-credential`, and `gh auth status`
> shows the logged-in account. If pushes ever start failing, that's the thing to fix — re-run
> `gh auth login` on the box (don't paste tokens into the repo).

**The backup path (`cg artifact`):** if a push ever can't happen, `cg artifact <relpath>` rsyncs a file
or folder straight off the box to the Mac. That's the **fallback only** — a hand-ferry for when the
clean git path is unavailable. The primary, default channel is `git push`; reach for `cg artifact`
only when push is broken (and then say so).

## When a session finishes, you hear about it (the completion hook)
Every machine also has a tiny **Claude Code hook** installed once (at the user level, so it
covers *every* project automatically — `deploy/hooks/`). The moment any Code session ends —
a headless `cg run`, an interactive `cg runi`, or a local Mac session — the hook fires and:
- **pings you** — a desktop banner **and** a phone/desktop push (via the self-hosted ntfy on
  `sentry`, over Tailscale) — carrying the session's **final message**, which project/branch it
  was, and the `/rc` link if it had one (tap the push → drop into steering it);
- **writes a "finished" note onto the whiteboard** (the same Supabase bus), so a Cowork chat can
  *read* that the run finished and what it said — closing the plan → delegate → execute →
  **report-back** loop without you babysitting the terminal or copy-pasting.

A second event, **"needs you,"** fires when a session is *waiting* for your input or a permission
— that one only pings you (no "finished" note). And if a session is hard-killed (so the hook can't
fire), the reporter's "the tmux session vanished" detection still marks it finished on the
whiteboard as a backstop — just without the rich message. The hook never blocks or breaks a
session: if the network or ntfy is down it quietly logs to `~/.fleet/hook.log` and moves on.

## The safety model in one breath
Public visitors see machine names and fitness curves (the showcase). Everything sensitive — logs, the
`/rc` steering links, and the ability to send commands — is behind your password. Machines only push
*out*; the web never reaches *in*. And commands are a **fixed, vetted list** (check, status,
fetch-log, pull, artifact) — the website can never make a machine run arbitrary shell.

## Where things live (if you ever need to poke)
- **Code + docs:** this repo (`github.com/vishal-h-pathak/fleet-mission-control`).
- **Each machine's config:** a gitignored `.env` in the repo on that machine (holds its token).
- **Services:** Mac → `~/Library/LaunchAgents/com.fleet.*.plist`; `sentry` →
  `/etc/systemd/system/fleet-reporter.service`. Check them with `launchctl list | grep fleet`
  (Mac) or `systemctl status fleet-reporter` (`sentry`).
- **Roadmap / status:** `docs/ROADMAP.md` and `docs/BRIEF.md`.

## TL;DR
The scripts were the one-time setup and the feature-building. **To use Fleet, you open a website.**
The machines run themselves.
