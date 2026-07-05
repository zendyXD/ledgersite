"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const supabase = createClient();
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Signup successful. You can log in now.");
    router.push("/login");
  };

  const inputClass = "w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] text-[var(--input-text)] px-3 py-3 placeholder:text-[var(--input-placeholder)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--border)] mb-3";

  return (
    <main className="page-shell min-h-screen flex items-center justify-center p-4">
      <form
        onSubmit={handleSignup}
        className="surface-panel w-full max-w-md rounded-2xl p-6 shadow"
      >
        <h1 className="text-2xl font-semibold text-[var(--foreground)] mb-4">Create LedgerSite account</h1>

        <input
          className={inputClass}
          placeholder="Full name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />

        <input
          className={inputClass}
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          className={`${inputClass} !mb-4`}
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button className="w-full btn-theme-accent p-3 rounded-lg transition-colors">
          Sign up
        </button>

        {message && <p className="mt-4 text-sm text-[var(--foreground)]">{message}</p>}
      </form>
    </main>
  );
}