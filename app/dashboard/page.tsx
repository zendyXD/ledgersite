"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Proof = {
  id: number;
  file_path: string;
  original_name: string;
  comment: string | null;
  created_at: string;
  preview_url?: string | null;
};

type LedgerEntry = {
  id: number;
  proof_id: number | null;
  entry_date: string;
  amount: number | string;
  entry_type: "income" | "expense";
  party_name: string | null;
  category: string | null;
  note: string | null;
  created_at: string;
};

function DashboardSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" aria-label="Loading dashboard">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="surface-panel p-4">
          <div className="skeleton h-4 w-28" />
          <div className="skeleton mt-3 h-8 w-24" />
          <div className="skeleton mt-3 h-4 w-36" />
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();

  const [userEmail, setUserEmail] = useState("");
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function initDashboard() {
      try {
        setLoading(true);
        setErrorMessage("");

        const { data, error } = await supabase.auth.getUser();

        if (error || !data.user) {
          router.push("/login");
          return;
        }

        setUserEmail(data.user.email || "");

        // 1. Route to /api/proofs/inbox where your list query logic is completely functional
        const [ledgerRes, proofsRes] = await Promise.all([
          fetch("/api/ledger"),
          fetch("/api/proofs/inbox"),
        ]);

        // 2. Safety verification check runs first
        if (!ledgerRes.ok || !proofsRes.ok) {
          if (ledgerRes.status === 401 || proofsRes.status === 401) {
            return router.push("/login");
          }

          let failureDetails = "";
          if (!ledgerRes.ok) {
            failureDetails += `[Ledger API failed with Status: ${ledgerRes.status}] `;
          }
          if (!proofsRes.ok) {
            failureDetails += `[Inbox API failed with Status: ${proofsRes.status}] `;
          }

          throw new Error(`Database Communication Error: ${failureDetails}`);
        }

        // 3. Extract your payload arrays safely from response headers
        const ledgerData = await ledgerRes.json();
        const proofsData = await proofsRes.json();

        // 4. Update state variables cleanly to refresh dashboard statistics boxes
        setLedgerEntries(ledgerData.entries || []);
        setProofs(proofsData.proofs || []);
      } catch (err) {
        console.error(err);
        setErrorMessage(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    }

    initDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();

  const todaysExpenses = useMemo(() => {
    return ledgerEntries
      .filter(
        (entry) =>
          entry.entry_type === "expense" &&
          entry.entry_date === todayStr
      )
      .reduce((sum, entry) => sum + Number(entry.amount), 0);
  }, [ledgerEntries, todayStr]);

  const thisMonthSpend = useMemo(() => {
    return ledgerEntries
      .filter((entry) => {
        if (entry.entry_type !== "expense") return false;
        const date = new Date(entry.entry_date);
        return (
          date.getMonth() === currentMonth &&
          date.getFullYear() === currentYear
        );
      })
      .reduce((sum, entry) => sum + Number(entry.amount), 0);
  }, [ledgerEntries, currentMonth, currentYear]);

  const thisMonthIncome = useMemo(() => {
    return ledgerEntries
      .filter((entry) => {
        if (entry.entry_type !== "income") return false;
        const date = new Date(entry.entry_date);
        return (
          date.getMonth() === currentMonth &&
          date.getFullYear() === currentYear
        );
      })
      .reduce((sum, entry) => sum + Number(entry.amount), 0);
  }, [ledgerEntries, currentMonth, currentYear]);

  const labourPayouts = useMemo(() => {
    return ledgerEntries
      .filter((entry) => {
        if (entry.entry_type !== "expense") return false;
        const category = (entry.category || "").toLowerCase();
        return category.includes("labour") || category.includes("labor");
      })
      .reduce((sum, entry) => sum + Number(entry.amount), 0);
  }, [ledgerEntries]);

  const linkedProofCount = useMemo(() => {
    return ledgerEntries.filter((entry) => entry.proof_id !== null).length;
  }, [ledgerEntries]);

  const recentEntries = useMemo(() => {
    return [...ledgerEntries]
      .sort(
        (a, b) =>
          new Date(b.entry_date).getTime() - new Date(a.entry_date).getTime()
      )
      .slice(0, 5);
  }, [ledgerEntries]);

  return (
    <main className="p-4 md:p-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <section className="surface-panel p-4">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-[var(--foreground)]">LedgerSite Dashboard</h1>
              <p className="text-sm text-[var(--muted)]">
                Your bookkeeping workspace is ready.
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Logged in as: {userEmail || "Loading..."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link href="/uploads" className="btn-theme-accent">
                Upload proof
              </Link>
              <Link href="/reports" className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--card-muted)] transition-colors">
                Reports
              </Link>
              <button type="button" onClick={handleLogout} className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--card-muted)] transition-colors">
                Logout
              </button>
            </div>
          </div>

          {errorMessage && (
            <p className="status-error text-sm font-medium">{errorMessage}</p>
          )}

          {loading ? (
            <DashboardSkeleton />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="surface-panel p-4">
                <p className="text-sm text-[var(--muted)]">Today&apos;s expenses</p>
                <p className="text-2xl font-semibold text-[var(--foreground)]">
                  ₹{todaysExpenses.toFixed(2)}
                </p>
              </div>

              <div className="surface-panel p-4">
                <p className="text-sm text-[var(--muted)]">Linked proofs in ledger</p>
                <p className="text-2xl font-semibold text-[var(--foreground)]">
                  {linkedProofCount}
                </p>
              </div>

              <div className="surface-panel p-4">
                <p className="text-sm text-[var(--muted)]">Labour payouts</p>
                <p className="text-2xl font-semibold text-[var(--foreground)]">
                  ₹{labourPayouts.toFixed(2)}
                </p>
              </div>

              <div className="surface-panel p-4">
                <p className="text-sm text-[var(--muted)]">This month spend</p>
                <p className="text-2xl font-semibold text-[var(--foreground)]">
                  ₹{thisMonthSpend.toFixed(2)}
                </p>
              </div>
            </div>
          )}
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-green-300 bg-green-50 dark:border-emerald-500/20 dark:bg-emerald-500/10 p-4">
            <p className="text-sm font-medium text-green-800 dark:text-emerald-400">This month income</p>
            <p className="text-2xl font-bold text-green-900 dark:text-emerald-300">
              ₹{thisMonthIncome.toFixed(2)}
            </p>
          </div>

          <div className="rounded-xl border border-red-300 bg-red-50 dark:border-red-500/20 dark:bg-red-500/10 p-4">
            <p className="text-sm font-medium text-red-800 dark:text-red-400">This month expense</p>
            <p className="text-2xl font-bold text-red-900 dark:text-red-300">
              ₹{thisMonthSpend.toFixed(2)}
            </p>
          </div>

          <div className="surface-panel p-4">
            <p className="text-sm font-medium text-[var(--muted)]">Net this month</p>
            <p className="text-2xl font-bold text-[var(--foreground)]">
              ₹{(thisMonthIncome - thisMonthSpend).toFixed(2)}
            </p>
          </div>
        </section>

        <section className="surface-panel p-4">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="text-xl font-semibold text-[var(--foreground)]">Recent activity</h2>
            <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
              <span>{ledgerEntries.length} ledger entries</span>
              <span>•</span>
              <span>{proofs.length} proofs</span>
              <span>•</span>
              <Link href="/reports" className="font-medium text-[var(--primary)] hover:text-[var(--primary-hover)] transition-colors">
                Open reports
              </Link>
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--card-muted)] p-4">
                  <div className="skeleton h-4 w-40" />
                  <div className="skeleton mt-2 h-4 w-60" />
                  <div className="skeleton mt-2 h-4 w-28" />
                </div>
              ))}
            </div>
          ) : recentEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--card-muted)] p-6 text-center">
              <p className="text-sm font-medium text-[var(--foreground)]">
                No ledger activity yet.
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Add a proof and create your first ledger entry from the uploads page.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentEntries.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-[var(--border)] bg-[var(--card-muted)] p-4 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          entry.entry_type === "income"
                            ? "bg-green-100 text-green-800 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border dark:border-emerald-500/20"
                            : "bg-red-100 text-red-800 dark:bg-red-500/10 dark:text-red-400 dark:border dark:border-red-500/20"
                        }`}
                      >
                        {entry.entry_type === "income" ? "Income" : "Expense"}
                      </span>
                      <span className="font-semibold text-[var(--foreground)]">
                        ₹{Number(entry.amount).toFixed(2)}
                      </span>
                    </div>
                    <span className="text-xs text-[var(--muted)]">{entry.entry_date}</span>
                  </div>

                  <p className="mt-2 text-sm text-[var(--foreground)]">
                    {entry.party_name || "-"} | {entry.category || "-"}
                  </p>

                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {entry.note || "No note"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}