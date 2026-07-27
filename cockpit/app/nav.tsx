// cockpit/app/nav.tsx
import Link from "next/link";

// Shared top nav between the Inbox (/) and the Waves board (/waves) — both
// pages render this inside the same authed layout shell (see app/page.tsx,
// app/waves/page.tsx).
export function CockpitNav({ active }: { active: "inbox" | "waves" | "compose" }) {
  const linkClass = (isActive: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium ${
      isActive
        ? "bg-white/10 text-zinc-50"
        : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
    }`;

  return (
    <nav className="mt-4 flex gap-2 border-b border-white/10 pb-4">
      <Link href="/" className={linkClass(active === "inbox")}>
        Inbox
      </Link>
      <Link href="/waves" className={linkClass(active === "waves")}>
        Waves
      </Link>
      <Link href="/compose" className={linkClass(active === "compose")}>
        Compose
      </Link>
    </nav>
  );
}
