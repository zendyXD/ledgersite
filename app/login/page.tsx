"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) {
          setMessage(error.message);
        } else {
          setMessage("Signup successful. Check your email if confirmation is enabled.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          setMessage(error.message);
        } else {
          setMessage("Login successful.");
          const next = new URLSearchParams(window.location.search).get("next");
          router.push(next || "/uploads");
        }
      }
    } catch (err) {
      console.error(err);
      setMessage("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const inputClass = "w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] text-[var(--input-text)] px-3 py-3 placeholder:text-[var(--input-placeholder)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--border)]";

  return (
    <main className="page-shell flex min-h-screen items-center justify-center p-4">
      <div className="surface-panel w-full max-w-md rounded-2xl shadow p-6">
        <h1 className="text-2xl font-semibold text-[var(--foreground)] mb-2">Ledger login</h1>
        <p className="text-sm text-[var(--muted)] mb-6">
          Login or create an account to continue.
        </p>

        <div className="flex gap-2 mb-6">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              mode === "login"
                ? "btn-theme-accent font-medium"
                : "bg-[var(--card-elevated)] text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-muted)]"
            }`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              mode === "signup"
                ? "btn-theme-accent font-medium"
                : "bg-[var(--card-elevated)] text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-muted)]"
            }`}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--foreground)] mb-2">Email</label>
            <input
              type="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--foreground)] mb-2">Password</label>
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-theme-accent px-4 py-3 text-sm rounded-lg disabled:opacity-60 transition-colors"
          >
            {loading
              ? "Please wait..."
              : mode === "login"
              ? "Login"
              : "Create account"}
          </button>
        </form>

        {message && (
          <p className="mt-4 text-sm text-[var(--foreground)]">{message}</p>
        )}
      </div>
    </main>
  );
}