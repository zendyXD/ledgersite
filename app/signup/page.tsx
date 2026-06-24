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

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <form
        onSubmit={handleSignup}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow"
      >
        <h1 className="text-2xl font-semibold mb-4">Create LedgerSite account</h1>

        <input
          className="w-full border rounded-lg p-3 mb-3"
          placeholder="Full name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />

        <input
          className="w-full border rounded-lg p-3 mb-3"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          className="w-full border rounded-lg p-3 mb-4"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button className="w-full rounded-lg bg-teal-700 text-white p-3">
          Sign up
        </button>

        {message && <p className="mt-4 text-sm text-gray-600">{message}</p>}
      </form>
    </main>
  );
}