"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import PublicHeader from "@/components/PublicHeader";
import { Zap, ShieldCheck, ArrowRight, FileSpreadsheet, HardDriveUpload, CheckCircle2 } from "lucide-react";

export default function Home() {
  const router = useRouter();
  const supabase = createClient();
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    async function checkAuth() {
      const { data } = await supabase.auth.getUser();
      setIsLoggedIn(!!data.user);
    }
    checkAuth();
  }, [supabase]);

  const handleNormalFlowClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isLoggedIn) {
      router.push("/uploads");
    } else {
      router.push("/login?next=/uploads");
    }
  };

  return (
    <div className="min-h-screen flex flex-col theme-page">
      <PublicHeader />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 md:px-8 py-8 md:py-14 flex flex-col gap-10">
        {/* Header intro */}
        <div className="max-w-2xl space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[var(--card-muted)] border border-[var(--border)] text-[var(--muted)]">
            <span className="w-2 h-2 rounded-full bg-[var(--primary)]" />
            Construction Bookkeeping Engine
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-[var(--foreground)] tracking-tight leading-tight">
            Choose your bookkeeping workflow
          </h1>
          <p className="text-base text-[var(--muted)] leading-relaxed">
            LedgerSite provides two distinct workflows to track site expenses and payment proofs. Select the tool that matches your immediate work.
          </p>
        </div>

        {/* Workflow Choice Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Workflow 1: Quick Mode */}
          <div className="surface-panel p-6 md:p-7 flex flex-col justify-between border-2 border-[var(--primary)]/40 hover:border-[var(--primary)] transition-colors relative overflow-hidden group">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center font-bold">
                  <Zap className="w-5 h-5" />
                </div>
                <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md bg-[var(--primary)]/10 text-[var(--primary)]">
                  Fast • No Login Needed
                </span>
              </div>

              <div>
                <h2 className="text-xl font-bold text-[var(--foreground)] mb-1.5 flex items-center gap-2">
                  Quick Mode
                </h2>
                <p className="text-sm text-[var(--muted)] leading-relaxed">
                  Batch process payment screenshots directly in your browser. Extracts entries into a clean Excel file without saving to party ledgers or permanent databases.
                </p>
              </div>

              <div className="space-y-2 pt-2 border-t border-[var(--border)]">
                <div className="flex items-start gap-2 text-xs text-[var(--foreground)]">
                  <CheckCircle2 className="w-4 h-4 text-[var(--primary)] shrink-0 mt-0.5" />
                  <span>Available to both guests & logged-in users</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-[var(--foreground)]">
                  <CheckCircle2 className="w-4 h-4 text-[var(--primary)] shrink-0 mt-0.5" />
                  <span>Generates consolidated Excel download</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-[var(--foreground)]">
                  <CheckCircle2 className="w-4 h-4 text-[var(--primary)] shrink-0 mt-0.5" />
                  <span>Session memory only — no server ledger records</span>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-4">
              <Link
                href="/quick"
                className="w-full btn-theme-accent py-3 px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all group-hover:gap-3"
              >
                <span>Launch Quick Mode</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>

          {/* Workflow 2: Normal Daily Flow */}
          <div className="surface-panel p-6 md:p-7 flex flex-col justify-between hover:border-[var(--muted)] transition-colors relative overflow-hidden group">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl bg-[var(--card-muted)] text-[var(--foreground)] flex items-center justify-center font-bold border border-[var(--border)]">
                  <HardDriveUpload className="w-5 h-5" />
                </div>
                <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md bg-[var(--card-muted)] text-[var(--muted)] border border-[var(--border)]">
                  Requires Login
                </span>
              </div>

              <div>
                <h2 className="text-xl font-bold text-[var(--foreground)] mb-1.5">
                  Normal Daily Flow
                </h2>
                <p className="text-sm text-[var(--muted)] leading-relaxed">
                  Full site ledger workflow for site managers. Upload payment receipts, auto-extract details into Proof Inbox, manage party balances, and export monthly statements.
                </p>
              </div>

              <div className="space-y-2 pt-2 border-t border-[var(--border)]">
                <div className="flex items-start gap-2 text-xs text-[var(--foreground)]">
                  <CheckCircle2 className="w-4 h-4 text-[var(--muted)] shrink-0 mt-0.5" />
                  <span>Saves files securely to Supabase Storage</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-[var(--foreground)]">
                  <CheckCircle2 className="w-4 h-4 text-[var(--muted)] shrink-0 mt-0.5" />
                  <span>Updates party ledgers & Proof Inbox</span>
                </div>
                <div className="flex items-start gap-2 text-xs text-[var(--foreground)]">
                  <CheckCircle2 className="w-4 h-4 text-[var(--muted)] shrink-0 mt-0.5" />
                  <span>Syncs with WhatsApp bot & monthly close tools</span>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-4">
              <button
                type="button"
                onClick={handleNormalFlowClick}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--card-elevated)] hover:bg-[var(--card-muted)] py-3 px-4 text-sm font-semibold text-[var(--foreground)] flex items-center justify-center gap-2 transition-all"
              >
                <span>{isLoggedIn ? "Go to Daily Upload" : "Login & Daily Upload"}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

        </div>

        {/* Technical Footer Notice */}
        <div className="rounded-xl bg-[var(--card-muted)] border border-[var(--border)] p-4 text-xs text-[var(--muted)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[var(--primary)] shrink-0" />
            <span>LedgerSite v1.0 • Construction AI Bookkeeping Platform</span>
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <span>Storage: Supabase Postgres</span>
            <span>Auth: Secured SSR</span>
          </div>
        </div>
      </main>
    </div>
  );
}