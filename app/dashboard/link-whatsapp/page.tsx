"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

function LinkWhatsAppContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    async function init() {
      try {
        const { data, error } = await supabase.auth.getUser();

        if (error || !data.user) {
          router.push("/login");
          return;
        }

        setUserEmail(data.user.email || "");

        const numberFromQuery = searchParams.get("number");
        if (numberFromQuery) {
          setWhatsappNumber(numberFromQuery);
        }
      } catch (err) {
        console.error(err);
        setErrorMessage("Failed to load user session");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [router, searchParams, supabase.auth]);

  async function handleLink(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const res = await fetch("/api/link-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatsappNumber }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to link WhatsApp number");
      }

      setSuccessMessage("WhatsApp number successfully linked!");
      setTimeout(() => {
        router.push("/dashboard");
      }, 2000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Unknown error occurred");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="page-shell p-4 md:p-8">
        <div className="mx-auto max-w-lg space-y-8">
          <div className="app-card p-6">
            <div className="skeleton h-8 w-48 mb-4" />
            <div className="skeleton h-4 w-full mb-8" />
            <div className="skeleton h-10 w-full" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page-shell p-4 md:p-8">
      <div className="mx-auto max-w-lg space-y-8">
        <div className="app-card p-6">
          <h1 className="text-2xl font-semibold text-slate-900 mb-2">Link WhatsApp</h1>
          <p className="text-sm text-slate-600 mb-6">
            Link your WhatsApp number to your LedgerSite account to automatically save proofs sent via WhatsApp.
          </p>

          <p className="text-sm text-slate-700 mb-6">
            Logged in as: <strong>{userEmail}</strong>
          </p>

          <form onSubmit={handleLink} className="space-y-4">
            <div>
              <label htmlFor="whatsapp_number" className="mb-1 block text-sm font-medium text-slate-700">
                WhatsApp Number
              </label>
              <input
                id="whatsapp_number"
                type="text"
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                placeholder="e.g. +14155238886"
                className="input-field"
                required
              />
              <p className="text-xs text-slate-500 mt-1">Include the country code (e.g., +1, +91).</p>
            </div>

            {errorMessage && (
              <p className="status-error text-sm font-medium">{errorMessage}</p>
            )}
            
            {successMessage && (
              <p className="rounded bg-green-50 p-3 text-sm font-medium text-green-700">
                {successMessage}
              </p>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={submitting || !whatsappNumber}
                className="btn-primary flex-1"
              >
                {submitting ? "Linking..." : "Link Number"}
              </button>
              <Link href="/dashboard" className="btn-secondary">
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}

export default function LinkWhatsAppPage() {
  return (
    <Suspense fallback={
      <main className="page-shell p-4 md:p-8">
        <div className="mx-auto max-w-lg space-y-8">
          <div className="app-card p-6">
            <div className="skeleton h-8 w-48 mb-4" />
            <div className="skeleton h-4 w-full mb-8" />
            <div className="skeleton h-10 w-full" />
          </div>
        </div>
      </main>
    }>
      <LinkWhatsAppContent />
    </Suspense>
  );
}
