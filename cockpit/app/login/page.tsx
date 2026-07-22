"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const searchParams = useSearchParams();
  const denied = searchParams.get("denied") === "1";
  const callbackError = searchParams.get("error") === "auth_callback_failed";

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (otpError) {
        setError(otpError.message);
        return;
      }
      setSent(true);
    } catch {
      setError("Network error — could not reach Supabase.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold text-zinc-50">
        MCv2 Cockpit — sign in
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        Enter your email for a magic sign-in link.
      </p>

      {denied && (
        <p className="mt-4 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-300">
          That account isn&apos;t authorized for this cockpit.
        </p>
      )}
      {callbackError && (
        <p className="mt-4 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-300">
          Sign-in link is invalid or expired — request a new one below.
        </p>
      )}

      {sent ? (
        <p className="mt-6 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-300">
          Check your email for a sign-in link.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <input
            type="email"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-base text-zinc-100 outline-none focus:border-indigo-400/50"
          />
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button
            type="submit"
            disabled={loading || !email}
            className="min-h-11 w-full rounded-xl bg-indigo-500 px-4 text-base font-medium text-white transition hover:bg-indigo-400 disabled:opacity-60"
          >
            {loading ? "Sending…" : "Send magic link"}
          </button>
        </form>
      )}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
