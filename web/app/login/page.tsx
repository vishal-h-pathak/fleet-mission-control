"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = "/";
        return;
      }
      setError(res.status === 401 ? "Incorrect password." : "Sign-in failed.");
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold text-zinc-50">Fleet — sign in</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Enter the dashboard password to reveal remote-control links.
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-3">
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Dashboard password"
          className="min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-base text-zinc-100 outline-none focus:border-indigo-400/50"
        />
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={loading || !password}
          className="min-h-11 w-full rounded-xl bg-indigo-500 px-4 text-base font-medium text-white transition hover:bg-indigo-400 disabled:opacity-60"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <a href="/" className="mt-4 text-center text-sm text-zinc-500 hover:text-zinc-300">
        ← Back to dashboard
      </a>
    </main>
  );
}
