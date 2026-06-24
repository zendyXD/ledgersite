"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { findDuplicates } from "@/app/inbox/page";

type Proof = {
  id: number;
  user_id: string;
  comment: string | null;
  created_at: string;
  processing_status: "unprocessed" | "drafted" | "linked" | "reviewed" | string;
  extracted_text: string | null;
  original_name?: string | null;
  extracted_amount: number | null;
  extracted_date: string | null;
  file_path?: string | null;
  extracted_party: string | null;
  linked_entry_id: number | null;
  reviewed_at?: string | null;
  extraction_status?: string | null;
  preview_url?: string | null;
  extracted_category?: string | null;
  extracted_entry_type?: string | null;
  project_name?: string | null;
  invoice_number?: string | null;
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
  updated_at?: string | null;
  is_finalised?: boolean | null;
  review_status?: string | null;
};

export default function ClosePage() {
  const router = useRouter();
  const supabase = createClient();

  const [proofs, setProofs] = useState<Proof[]>([]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const currentMonthDefault = new Date().toISOString().slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthDefault);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          router.push("/login");
          return;
        }

        const [proofRes, ledgerRes] = await Promise.all([
          fetch("/api/proofs/inbox"),
          fetch("/api/ledger")
        ]);

        if (!proofRes.ok || !ledgerRes.ok) throw new Error("Failed to load data");

        const proofData = await proofRes.json();
        const ledgerData = await ledgerRes.json();

        setProofs(proofData.proofs || []);
        setEntries(ledgerData.entries || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [router, supabase]);

  const monthOptions = useMemo(() => {
    const dates = [
      ...proofs.map(p => p.created_at),
      ...entries.map(e => e.created_at)
    ];
    const months = Array.from(new Set(dates.map(d => d?.slice(0, 7)).filter(Boolean))).sort().reverse();
    if (!months.includes(currentMonthDefault)) months.unshift(currentMonthDefault);
    return months;
  }, [proofs, entries, currentMonthDefault]);

  // Derived metrics
  const { metrics, exceptionTrends, topParties, categorySummary } = useMemo(() => {
    const selectedMonthIndex = monthOptions.indexOf(selectedMonth);
    const lastMonth = monthOptions[selectedMonthIndex + 1] || null;

    // Metrics calculation
    const proofsUploaded = proofs.filter(p => p.created_at?.startsWith(selectedMonth)).length;
    const proofsReviewed = proofs.filter(p => p.reviewed_at?.startsWith(selectedMonth) || (p.processing_status === "reviewed" && p.created_at?.startsWith(selectedMonth))).length;
    const draftsCreated = entries.filter(e => e.created_at?.startsWith(selectedMonth)).length;
    const draftsFinalised = entries.filter(e => e.is_finalised && (e.updated_at?.startsWith(selectedMonth) || e.created_at?.startsWith(selectedMonth))).length;

    // Exceptions logic
    function getProofExceptions(p: Proof): string[] {
      const ex: string[] = [];
      const dups = findDuplicates(p, proofs);
      if (dups.length > 0 && dups[0].score === "likely") ex.push("Duplicate Detected");
      if (p.processing_status !== "unprocessed" && (!p.extracted_amount || !p.extracted_date || !p.extracted_party)) ex.push("Missing Info");
      if (p.processing_status === "reviewed" && !p.linked_entry_id) ex.push("Stalled at Review");
      return ex;
    }

    function getLedgerExceptions(e: LedgerEntry): string[] {
      const ex: string[] = [];
      if (!e.is_finalised) {
        if (!e.amount || !e.party_name || !e.entry_date) ex.push("Missing Fields (Draft)");
        if (e.review_status !== "reviewed") ex.push("Unreviewed Draft");
        if (e.review_status === "reviewed" && e.amount && e.party_name && e.entry_date) ex.push("Ready to Finalise");
      } else {
        if (!e.proof_id) ex.push("Finalised w/o Proof");
      }
      return ex;
    }

    const currentEx = new Map<string, number>();
    const lastEx = new Map<string, number>();

    proofs.forEach(p => {
      const isCurrent = p.created_at?.startsWith(selectedMonth);
      const isLast = lastMonth && p.created_at?.startsWith(lastMonth);
      if (!isCurrent && !isLast) return;

      const exs = getProofExceptions(p);
      exs.forEach(ex => {
        if (isCurrent) currentEx.set(ex, (currentEx.get(ex) || 0) + 1);
        if (isLast) lastEx.set(ex, (lastEx.get(ex) || 0) + 1);
      });
    });

    entries.forEach(e => {
      const isCurrent = e.created_at?.startsWith(selectedMonth);
      const isLast = lastMonth && e.created_at?.startsWith(lastMonth);
      if (!isCurrent && !isLast) return;

      const exs = getLedgerExceptions(e);
      exs.forEach(ex => {
        if (isCurrent) currentEx.set(ex, (currentEx.get(ex) || 0) + 1);
        if (isLast) lastEx.set(ex, (lastEx.get(ex) || 0) + 1);
      });
    });

    const allExTypes = Array.from(new Set([...currentEx.keys(), ...lastEx.keys()]));
    const trends = allExTypes.map(type => ({
      type,
      current: currentEx.get(type) || 0,
      last: lastEx.get(type) || 0,
    })).sort((a, b) => b.current - a.current);

    // Finalised Entries Tables
    const finalisedThisMonth = entries.filter(e => e.is_finalised && (e.updated_at?.startsWith(selectedMonth) || e.created_at?.startsWith(selectedMonth)));
    
    const partyMap = new Map<string, number>();
    const categoryMap = new Map<string, number>();

    finalisedThisMonth.forEach(e => {
      const pName = e.party_name?.trim() || "Unknown";
      const cat = e.category?.trim() || "Uncategorized";
      const amt = Number(e.amount) || 0;

      partyMap.set(pName, (partyMap.get(pName) || 0) + amt);
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + amt);
    });

    const topPartiesArr = Array.from(partyMap.entries())
      .map(([party, amount]) => ({ party, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);

    const categoryArr = Array.from(categoryMap.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);

    return {
      metrics: { proofsUploaded, proofsReviewed, draftsCreated, draftsFinalised },
      exceptionTrends: trends,
      topParties: topPartiesArr,
      categorySummary: categoryArr
    };
  }, [proofs, entries, selectedMonth, monthOptions]);

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Loading monthly close...</div>;
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-y-auto">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 shrink-0 sticky top-0 z-10">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Monthly Close</h1>
          <p className="text-sm text-slate-500">Lightweight overview and unresolved exception trends</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700">Month:</label>
          <select 
            value={selectedMonth} 
            onChange={e => setSelectedMonth(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-200"
          >
            {monthOptions.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </header>

      <div className="p-6 max-w-6xl mx-auto w-full space-y-6">
        
        {/* Metrics row */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Proofs Uploaded</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{metrics.proofsUploaded}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Proofs Reviewed</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{metrics.proofsReviewed}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Drafts Created</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{metrics.draftsCreated}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Drafts Finalised</p>
            <p className="mt-2 text-3xl font-bold text-emerald-700">{metrics.draftsFinalised}</p>
          </div>
        </section>

        {/* Exceptions */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-4 bg-slate-50">
            <h2 className="text-sm font-bold text-slate-900">Unresolved Exceptions by Item Age</h2>
            <p className="text-xs text-slate-500 mt-1">Shows currently unresolved issues on items created in this month vs last month.</p>
          </div>
          <div className="p-0 overflow-x-auto">
            {exceptionTrends.length === 0 ? (
              <p className="p-5 text-sm text-slate-500 text-center">No unresolved exceptions for this period! 🎉</p>
            ) : (
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Exception Type</th>
                    <th className="px-5 py-3 font-medium text-right">{selectedMonth}</th>
                    <th className="px-5 py-3 font-medium text-right">Last Month</th>
                    <th className="px-5 py-3 font-medium text-right">Trend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {exceptionTrends.map(t => {
                    const diff = t.current - t.last;
                    const isWorse = diff > 0;
                    return (
                      <tr key={t.type} className="hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3 font-medium text-slate-700">{t.type}</td>
                        <td className="px-5 py-3 text-right font-bold text-red-600">{t.current}</td>
                        <td className="px-5 py-3 text-right text-slate-500">{t.last}</td>
                        <td className="px-5 py-3 text-right">
                          {diff === 0 ? (
                            <span className="text-slate-400">-</span>
                          ) : isWorse ? (
                            <span className="text-red-500 font-medium">+{diff} ↗</span>
                          ) : (
                            <span className="text-emerald-500 font-medium">{diff} ↘</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Tables */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-12">
          {/* Top Parties */}
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col h-full">
            <div className="border-b border-slate-200 px-5 py-4 bg-slate-50 shrink-0">
              <h2 className="text-sm font-bold text-slate-900">Top Parties (Finalised)</h2>
            </div>
            <div className="p-0 overflow-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Party Name</th>
                    <th className="px-5 py-3 font-medium text-right">Total Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {topParties.map((p, i) => (
                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3 font-medium text-slate-700">{p.party}</td>
                      <td className="px-5 py-3 text-right text-slate-600">Rs. {p.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                  {topParties.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-5 py-4 text-center text-slate-500">No finalised entries this month.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Categories */}
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col h-full">
            <div className="border-b border-slate-200 px-5 py-4 bg-slate-50 shrink-0">
              <h2 className="text-sm font-bold text-slate-900">Category Summary (Finalised)</h2>
            </div>
            <div className="p-0 overflow-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Category</th>
                    <th className="px-5 py-3 font-medium text-right">Total Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {categorySummary.map((c, i) => (
                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3 font-medium text-slate-700">{c.category}</td>
                      <td className="px-5 py-3 text-right text-slate-600">Rs. {c.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                  {categorySummary.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-5 py-4 text-center text-slate-500">No finalised entries this month.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

      </div>
    </div>
  );
}
