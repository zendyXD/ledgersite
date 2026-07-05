"use client";

import { useEffect, useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
 
type LedgerEntry = {
  id: number;
  proof_id: number | null;
  entry_date: string;
  amount: number | string;
  entry_type: "income" | "expense";
  party_name: string | null;
  category: string | null;
  note: string | null;
  project_name?: string | null;
  is_finalised?: boolean | null;
  review_status?: string | null;
  is_split?: boolean;
  split_allocations?: any[];
  created_at: string;
  proofs?: { id: number; original_name: string; file_path: string } | null;
};

export default function LedgerPage() {
  const router = useRouter();
  const supabase = createClient();

  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "needs_review" | "reviewed" | "confirmed" | "exceptions">("all");
  
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<number>>(new Set());
  const [bulkMarkLoading, setBulkMarkLoading] = useState(false);
  const [bulkCategory, setBulkCategory] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "done" | "error">("idle");
  
  // --- SURGICAL PATCH: DRAFT EDITING STATES ---
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [editParty, setEditParty] = useState("");
  const [editAmount, setEditAmount] = useState(""); 
  const [editDate, setEditDate] = useState("");
  const [editType, setEditType] = useState<"income" | "expense">("expense");
  const [editCategory, setEditCategory] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editProject, setEditProject] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [finaliseConfirmId, setFinaliseConfirmId] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const [historyData, setHistoryData] = useState<{ [id: number]: any[] }>({});
  const [expandedHistoryId, setExpandedHistoryId] = useState<number | null>(null);
  
  const [expandedSplitIds, setExpandedSplitIds] = useState<Set<number>>(new Set());

  function toggleSplitRow(id: number) {
    setExpandedSplitIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function toggleHistory(id: number) {
    if (expandedHistoryId === id) {
      setExpandedHistoryId(null);
      return;
    }
    setExpandedHistoryId(id);
    if (!historyData[id]) {
      try {
        const res = await fetch(`/api/activity?entity_type=ledger_entry&entity_id=${id}`);
        if (res.ok) {
          const data = await res.json();
          setHistoryData((prev) => ({ ...prev, [id]: data.logs || [] }));
        }
      } catch (err) {
        console.error("Failed to fetch history", err);
      }
    }
  }

  async function loadLedgerEntries() {
    try {
      setLoading(true);
      const res = await fetch("/api/ledger");
      const data = await res.json();
      if (res.ok) {
        setEntries(data.entries || []);
      }
    } catch (err) {
      console.error("Error loading ledger:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {

    async function init() {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        router.push("/login");
        return;
      }
      await loadLedgerEntries();
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [highlightEntryId, setHighlightEntryId] = useState<number | null>(null);

  useEffect(() => {
    if (!loading && entries.length > 0) {
      const params = new URLSearchParams(window.location.search);
      const highlight = params.get("highlight");
      if (highlight) {
        const id = Number(highlight);
        setHighlightEntryId(id);
        setTimeout(() => {
          const el = document.getElementById(`ledger-entry-${id}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            window.history.replaceState(null, "", window.location.pathname);
            setTimeout(() => setHighlightEntryId(null), 3000);
          }
        }, 100);
      }
    }
  }, [loading, entries]);
// --- SURGICAL PATCH: FORM SAVE HANDLERS ---
  function startEditing(entry: LedgerEntry) {
    setEditingEntryId(entry.id);
    setEditParty(entry.party_name ?? "");
    setEditAmount(String(entry.amount));
    setEditDate(entry.entry_date ?? "");
    setEditType(entry.entry_type);
    setEditCategory(entry.category ?? "");
    setEditNote(entry.note ?? "");
    setEditProject(entry.project_name ?? "");
  }

  async function handleSaveEntry(id: number, explicitlyFinalise = false) {
    try {
      setSavingId(id);
      
      const payload: any = {
        party_name: editParty,
        amount: editAmount,
        entry_date: editDate,
        entry_type: editType,
        category: editCategory,
        note: editNote,
        project_name: editProject,
        review_status: "unreviewed",
      };

      const res = await fetch(`/api/ledger/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to save entry parameters");
      
      setEditingEntryId(null);
      await loadLedgerEntries();
    } catch (err: any) {
      console.error(err);
    } finally {
      setSavingId(null);
    }
  }

  async function handleConfirmFinalise(id: number) {
    try {
      setSavingId(id);
      const res = await fetch(`/api/ledger/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_finalised: true }),
      });
      if (!res.ok) throw new Error("Failed to finalise entry.");
      setFinaliseConfirmId(null);
      await loadLedgerEntries();
    } catch (err: any) {
      console.error(err);
    } finally {
      setSavingId(null);
    }
  }

  async function handleDeleteEntry(id: number) {
    try {
      setSavingId(id);
      const res = await fetch(`/api/ledger/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to delete entry.");
      setDeleteConfirmId(null);
      await loadLedgerEntries();
    } catch (err: any) {
      console.error(err);
      setMessage(err.message || "Failed to delete entry");
      setStatus("error");
    } finally {
      setSavingId(null);
    }
  }

  async function handleUnlockEntry(id: number) {
    try {
      setSavingId(id);
      const res = await fetch(`/api/ledger/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_finalised: false, review_status: "reviewed" }), // Flip finalization flag off, keep reviewed
      });
      if (!res.ok) throw new Error("Failed to unlock row.");
      await loadLedgerEntries(); // Reload updated statuses
    } catch (err: any) {
      console.error(err);
    } finally {
      setSavingId(null);
    }
  }

  async function handleMarkDraftReviewed(id: number) {
    try {
      setSavingId(id);
      const res = await fetch(`/api/ledger/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review_status: "reviewed" }),
      });
      if (!res.ok) throw new Error("Failed to mark reviewed.");
      await loadLedgerEntries();
    } catch (err: any) {
      console.error(err);
    } finally {
      setSavingId(null);
    }
  }

  async function handleBulkMarkReviewed() {
    const selectedEntries = entries.filter(e => selectedEntryIds.has(e.id));
    const eligibleEntries = selectedEntries.filter(e => !e.is_finalised && e.review_status !== "reviewed");
    const skipped = selectedEntries.length - eligibleEntries.length;

    if (eligibleEntries.length === 0) {
      setMessage(`No eligible drafts selected. (${skipped} skipped)`);
      setStatus("error");
      return;
    }

    try {
      setBulkMarkLoading(true);
      setMessage(`Marking ${eligibleEntries.length} drafts as reviewed...`);
      let successCount = 0;
      let failCount = 0;

      await Promise.allSettled(
        eligibleEntries.map(async (e) => {
          const res = await fetch(`/api/ledger/${e.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ review_status: "reviewed" })
          });
          if (res.ok) successCount++;
          else failCount++;
        })
      );

      setMessage(`Updated ${successCount}. ${failCount > 0 ? `${failCount} failed. ` : ""}${skipped > 0 ? `${skipped} skipped.` : ""}`);
      setStatus(failCount === 0 ? "done" : "error");
      setSelectedEntryIds(new Set());
      await loadLedgerEntries();
    } catch (err) {
      console.error(err);
      setMessage("An error occurred during bulk mark.");
      setStatus("error");
    } finally {
      setBulkMarkLoading(false);
    }
  }

  async function handleBulkCategorise() {
    if (!bulkCategory.trim()) return;

    const selectedEntries = entries.filter(e => selectedEntryIds.has(e.id));
    const eligibleEntries = selectedEntries.filter(e => !e.is_finalised);
    const skipped = selectedEntries.length - eligibleEntries.length;

    if (eligibleEntries.length === 0) {
      setMessage(`No unfinalised drafts selected. (${skipped} skipped)`);
      setStatus("error");
      return;
    }

    try {
      setBulkMarkLoading(true);
      setMessage(`Setting category to "${bulkCategory}" for ${eligibleEntries.length} drafts...`);
      let successCount = 0;
      let failCount = 0;

      await Promise.allSettled(
        eligibleEntries.map(async (e) => {
          const res = await fetch(`/api/ledger/${e.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ category: bulkCategory })
          });
          if (res.ok) successCount++;
          else failCount++;
        })
      );

      setMessage(`Updated ${successCount}. ${failCount > 0 ? `${failCount} failed. ` : ""}${skipped > 0 ? `${skipped} skipped.` : ""}`);
      setStatus(failCount === 0 ? "done" : "error");
      setSelectedEntryIds(new Set());
      setBulkCategory("");
      await loadLedgerEntries();
    } catch (err) {
      console.error(err);
      setMessage("An error occurred during bulk categorise.");
      setStatus("error");
    } finally {
      setBulkMarkLoading(false);
    }
  }

  function toggleSelectEntry(id: number) {
    setSelectedEntryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() { setSelectedEntryIds(new Set()); }

  function getLedgerExceptions(entry: LedgerEntry): string[] {
    const ex: string[] = [];
    const isDraft = !entry.is_finalised;
    const missingFields = !entry.party_name || !entry.category || !entry.entry_date || !entry.entry_type || entry.amount == null || Number(entry.amount) <= 0;
    
    if (isDraft && missingFields) ex.push("Missing Info");
    if (isDraft && entry.review_status !== "reviewed") ex.push("Unreviewed");
    if (isDraft && entry.review_status === "reviewed" && !missingFields) ex.push("Ready to Finalise");
    if (!isDraft && !entry.proof_id) ex.push("Finalised w/o Proof");
    
    return ex;
  }

  // Filter entries based on the user's search text and status
  const filteredEntries = entries.filter((entry) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch = !q || (
      entry.party_name?.toLowerCase().includes(q) ||
      entry.note?.toLowerCase().includes(q) ||
      entry.category?.toLowerCase().includes(q)
    );

    if (!matchesSearch) return false;

    if (filterStatus === "exceptions") return getLedgerExceptions(entry).length > 0;

    const isConfirmed = !!entry.is_finalised;
    const missingFields = !entry.party_name || !entry.category || !entry.entry_date || !entry.entry_type || entry.amount == null || Number(entry.amount) <= 0;
    const isNeedsReview = !isConfirmed && (missingFields || entry.review_status !== "reviewed");
    const isReviewed = !isConfirmed && !missingFields && entry.review_status === "reviewed";

    if (filterStatus === "confirmed") return isConfirmed;
    if (filterStatus === "needs_review") return isNeedsReview;
    if (filterStatus === "reviewed") return isReviewed;
    
    return true;
  });

  const sortedEntries = [...filteredEntries].sort((a, b) => {
    if (filterStatus === "exceptions") {
      const aEx = getLedgerExceptions(a);
      const bEx = getLedgerExceptions(b);
      
      const aScore = aEx.includes("Missing Info") ? 4 : aEx.includes("Unreviewed") ? 3 : aEx.includes("Ready to Finalise") ? 2 : 1;
      const bScore = bEx.includes("Missing Info") ? 4 : bEx.includes("Unreviewed") ? 3 : bEx.includes("Ready to Finalise") ? 2 : 1;
      
      if (aScore !== bScore) return bScore - aScore;
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  function selectAllVisible() { setSelectedEntryIds(new Set(sortedEntries.map(e => e.id))); }

  return (
    <main className="p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Top Header Block */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Main Ledger</h1>
            <p className="text-sm text-[var(--muted)] mt-0.5">Final construction accounts and proof drafts</p>
          </div>
          <div className="flex gap-2">
            <Link href="/inbox" className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--card-muted)] transition-colors">
              ← View Proof Inbox
            </Link>
            <Link href="/uploads" className="btn-theme-accent">
              + Upload New Proof
            </Link>
          </div>
        </div>

        {message && (
          <p className={`text-sm font-medium px-4 py-2 rounded-lg ${status === "error" ? "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20" : "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20"}`}>
            {message}
          </p>
        )}

        {filterStatus === "exceptions" && (() => {
          const missingCount = entries.filter(e => getLedgerExceptions(e).includes("Missing Info")).length;
          const reviewCount = entries.filter(e => getLedgerExceptions(e).includes("Unreviewed")).length;
          const readyCount = entries.filter(e => getLedgerExceptions(e).includes("Ready to Finalise")).length;
          const noProofCount = entries.filter(e => getLedgerExceptions(e).includes("Finalised w/o Proof")).length;
          
          return (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6">
              <div className="rounded-xl border border-orange-200 bg-orange-50 dark:border-orange-500/20 dark:bg-orange-500/10 p-4 shadow-sm flex flex-col justify-center items-center text-center">
                <span className="text-3xl font-bold text-orange-700 dark:text-orange-400">{missingCount}</span>
                <span className="text-xs font-bold text-orange-800 dark:text-orange-500 uppercase tracking-widest mt-1">Missing Fields</span>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-orange-500/20 dark:bg-orange-500/10 p-4 shadow-sm flex flex-col justify-center items-center text-center">
                <span className="text-3xl font-bold text-amber-700 dark:text-orange-400">{reviewCount}</span>
                <span className="text-xs font-bold text-amber-800 dark:text-orange-500 uppercase tracking-widest mt-1">Needs Review</span>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/10 p-4 shadow-sm flex flex-col justify-center items-center text-center">
                <span className="text-3xl font-bold text-emerald-700 dark:text-emerald-400">{readyCount}</span>
                <span className="text-xs font-bold text-emerald-800 dark:text-emerald-500 uppercase tracking-widest mt-1">Ready to Finalise</span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 dark:border-[var(--border)] dark:bg-[var(--card-muted)] p-4 shadow-sm flex flex-col justify-center items-center text-center">
                <span className="text-3xl font-bold text-slate-700 dark:text-[var(--muted)]">{noProofCount}</span>
                <span className="text-xs font-bold text-slate-800 dark:text-[var(--foreground)] uppercase tracking-widest mt-1">No Proof</span>
              </div>
            </div>
          );
        })()}

        {/* Filter Toolbar Card */}
        <div className="surface-panel p-4 shadow-sm flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-[var(--muted)] font-medium whitespace-nowrap">{sortedEntries.length} entries</span>
              <button type="button" onClick={selectAllVisible} className="text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] underline transition-colors">Select all</button>
              {selectedEntryIds.size > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 overflow-x-auto max-w-[calc(100vw-40px)]">
                  <span className="text-xs font-medium text-[var(--foreground)] whitespace-nowrap">{selectedEntryIds.size} selected</span>
                  <div className="h-4 w-px bg-[var(--border)] mx-1 shrink-0"></div>
                  <button type="button" onClick={handleBulkMarkReviewed} disabled={bulkMarkLoading} className="text-xs font-medium text-[var(--foreground)] bg-[var(--card-elevated)] border border-[var(--border)] hover:bg-[var(--card-muted)] transition-colors rounded-lg px-2 py-1 disabled:opacity-50 whitespace-nowrap shrink-0">
                    {bulkMarkLoading ? "Marking..." : "Mark reviewed"}
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <input type="text" placeholder="Category" value={bulkCategory} onChange={e => setBulkCategory(e.target.value)} className="w-24 text-xs rounded-lg border border-[var(--border)] bg-[var(--input-bg)] text-[var(--input-text)] px-2 py-1 focus:outline-none focus:border-[var(--primary)]" />
                    <button type="button" onClick={() => handleBulkCategorise()} disabled={bulkMarkLoading || !bulkCategory.trim()} className="text-xs font-medium text-white bg-[var(--primary)] hover:bg-[var(--primary-hover)] transition-colors rounded-lg px-2 py-1 disabled:opacity-50">
                      Set
                    </button>
                  </div>
                  <button type="button" onClick={clearSelection} className="text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] underline transition-colors ml-1 shrink-0">Clear</button>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Exceptions", value: "exceptions", color: "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20" },
                { label: "All", value: "all" },
                { label: "Needs Review", value: "needs_review" },
                { label: "Reviewed Drafts", value: "reviewed" },
                { label: "Confirmed", value: "confirmed" },
              ].map(f => (
                <button key={f.value} type="button" onClick={() => setFilterStatus(f.value as any)}
                  className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${filterStatus === f.value ? (f.value === "exceptions" ? "bg-red-700 text-white border-red-700 dark:bg-red-600 dark:border-red-600" : "bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-700") : (f.color || "bg-[var(--card)] text-[var(--foreground)] border-[var(--border)] hover:bg-[var(--card-muted)]")}`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <input
              type="text"
              placeholder="Search party, category, or notes..."
              className="w-full sm:w-64 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--input-text)] placeholder:text-[var(--input-placeholder)] focus:outline-none focus:ring-2 focus:ring-[var(--border)]"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {/* Ledger Reconciliation Summary */}
        {!loading && filteredEntries.length > 0 && (() => {
          const draftCount = filteredEntries.filter(e => !e.is_finalised).length;
          const confirmedCount = filteredEntries.filter(e => e.is_finalised).length;
          const attentionCount = filteredEntries.filter(e => 
            !e.party_name || !e.category || !e.entry_date || !e.entry_type || e.amount == null || Number(e.amount) <= 0
          ).length;

          return (
            <div className="grid grid-cols-4 gap-4">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm text-center">
                <div className="text-2xl font-bold text-[var(--foreground)]">{filteredEntries.length}</div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)] mt-1">Total Entries</div>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-orange-500/20 dark:bg-orange-500/10 p-4 shadow-sm text-center">
                <div className="text-2xl font-bold text-amber-700 dark:text-orange-400">{draftCount}</div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-orange-500 mt-1">Drafts</div>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50 dark:border-blue-500/20 dark:bg-blue-500/10 p-4 shadow-sm text-center">
                <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{confirmedCount}</div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-500 mt-1">Confirmed</div>
              </div>
              <div className={`rounded-xl border p-4 shadow-sm text-center transition-colors ${attentionCount > 0 ? "border-rose-200 bg-rose-50 dark:border-rose-500/20 dark:bg-rose-500/10" : "border-[var(--border)] bg-[var(--card)]"}`}>
                <div className={`text-2xl font-bold ${attentionCount > 0 ? "text-rose-700 dark:text-rose-400" : "text-[var(--foreground)]"}`}>{attentionCount}</div>
                <div className={`text-[11px] font-bold uppercase tracking-wider mt-1 ${attentionCount > 0 ? "text-rose-600 dark:text-rose-500" : "text-[var(--muted)]"}`}>Needs Attention</div>
              </div>
            </div>
          );
        })()}

        {/* Ledger Transaction Rows Grid Layout */}
        {loading ? (
          <p className="text-sm text-[var(--muted)]">Loading ledger files...</p>
        ) : filteredEntries.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-center text-[var(--muted)] text-sm">
            No entries found matching your search.
          </div>
        ) : (
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-[var(--card-muted)] border-b border-[var(--border)] text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
                    <th className="p-4 w-10">
                      <input type="checkbox" onChange={selectAllVisible} checked={selectedEntryIds.size > 0 && selectedEntryIds.size === sortedEntries.length} className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]" />
                    </th>
                    <th className="p-4">Date</th>
                    <th className="p-4">Party</th>
                    <th className="p-4">Type</th>
                    <th className="p-4">Note / Category</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {sortedEntries.map((entry) => {
                    const isExpense = entry.entry_type === "expense";
                    const isDraft = !entry.is_finalised;
                    const isEditing = editingEntryId === entry.id;
                    const inputClass = "w-full rounded-md border border-[var(--border)] px-2 py-1 text-xs bg-[var(--input-bg)] text-[var(--input-text)] focus:outline-none focus:border-[var(--primary)] shadow-sm";
                    
                    const missingFields: string[] = [];
                    if (!entry.party_name) missingFields.push("Party");
                    if (!entry.category) missingFields.push("Category");
                    if (!entry.entry_date) missingFields.push("Date");
                    if (!entry.entry_type) missingFields.push("Type");
                    if (entry.amount == null || Number(entry.amount) <= 0) missingFields.push("Amount");
                    const hasMissing = missingFields.length > 0;

                    return (
                      <Fragment key={entry.id}>
                        <tr id={`ledger-entry-${entry.id}`} className={`transition-all duration-300 ${isEditing ? "bg-[var(--card-muted)] border-y-2 border-y-[var(--primary)]" : highlightEntryId === entry.id ? "!bg-[var(--primary)]/10 border-l-4 !border-l-[var(--primary)]" : selectedEntryIds.has(entry.id) ? "bg-[var(--primary)]/5 border-l-4 border-l-[var(--primary)]/50" : isDraft ? "bg-[var(--card)] hover:bg-[var(--card-muted)] border-l-4 border-l-transparent" : "bg-[var(--card)]/50 hover:bg-[var(--card-muted)] opacity-80 border-l-4 border-l-transparent"}`}>
                          <td className="p-4">
                            <input type="checkbox" checked={selectedEntryIds.has(entry.id)} onChange={() => toggleSelectEntry(entry.id)} className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]" />
                          </td>
                          {/* 1. DATE COLUMN */}
                          <td className="p-4 font-medium text-[var(--muted)] whitespace-nowrap">
                            {isEditing ? (
                              <input type="date" className={inputClass} value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                            ) : entry.entry_date ? (
                              new Date(entry.entry_date).toLocaleDateString()
                            ) : (
                              "—"
                            )}
                          </td>

                          {/* 2. PARTY COLUMN */}
                          <td className="p-4">
                            {isEditing ? (
                              <input type="text" className={inputClass} value={editParty} onChange={(e) => setEditParty(e.target.value)} />
                            ) : (
                              <span className="font-bold text-[var(--foreground)]">{entry.party_name || "—"}</span>
                            )}
                          </td>

                          {/* 3. TYPE COLUMN (INCOME / EXPENSE TOGGLE) */}
                          <td className="p-4 whitespace-nowrap">
                            {isEditing ? (
                              <select className={inputClass} value={editType} onChange={(e) => setEditType(e.target.value as "income" | "expense")}>
                                <option value="expense">Expense</option>
                                <option value="income">Income</option>
                              </select>
                            ) : (
                              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                isExpense ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 dark:border dark:border-red-500/20" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border dark:border-emerald-500/20"
                              }`}>
                                {isExpense ? "Expense" : "Income"}
                              </span>
                            )}
                          </td>

                          {/* 4. NOTE & CATEGORY COLUMN */}
                          <td className="p-4">
                            {isEditing ? (
                              <div className="space-y-1 max-w-xs">
                                <input type="text" className={inputClass} placeholder="Note description" value={editNote} onChange={(e) => setEditNote(e.target.value)} />
                                <input type="text" className={inputClass} placeholder="Project / Site" value={editProject} onChange={(e) => setEditProject(e.target.value)} />
                                <input type="text" className={inputClass} placeholder="Category" value={editCategory} onChange={(e) => setEditCategory(e.target.value)} />
                              </div>
                            ) : (
                              <>
                                <div className="text-[var(--foreground)] font-medium">{entry.note || "—"}</div>
                                {entry.project_name && (
                                  <div className="text-xs font-bold text-[var(--muted)] mt-1 uppercase tracking-wider">{entry.project_name}</div>
                                )}
                                {entry.category && (
                                  <div className="text-xs text-[var(--muted)] mt-0.5 opacity-80">{entry.category}</div>
                                )}
                                
                                {entry.proofs && (
                                  <div className="mt-2 flex items-center gap-1.5 rounded-md bg-[var(--card-elevated)] border border-[var(--border)] px-2 py-1.5 w-fit hover:bg-[var(--card-muted)] transition-colors cursor-pointer" onClick={() => window.open(`/inbox/${entry.proofs?.id}`, '_blank')}>
                                    <svg className="w-3 h-3 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                                    <span className="text-[10px] font-semibold text-[var(--foreground)] truncate max-w-[120px]">
                                      {entry.proofs.original_name}
                                    </span>
                                  </div>
                                )}
                              </>
                            )}
                          </td>

                          {/* 5. STATUS / WORKFLOW ACTION BUTTONS */}
                          <td className="p-4 whitespace-nowrap text-xs">
                            {isEditing ? (
                              <div className="flex flex-col gap-1.5 w-28">
                                <button type="button" onClick={() => handleSaveEntry(entry.id, false)} disabled={savingId === entry.id} className="rounded bg-teal-700 dark:bg-teal-600 px-2 py-1 font-semibold text-white hover:bg-teal-800 dark:hover:bg-teal-700 disabled:opacity-50 transition-colors">
                                  Save Entry
                                </button>
                                <button type="button" onClick={() => setEditingEntryId(null)} className="text-center rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1 font-medium text-[var(--foreground)] hover:bg-[var(--card-muted)] transition-colors">
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="space-y-1">
                                <div>
                                  {isDraft ? (
                                    entry.review_status === "reviewed" ? (
                                      <span className="inline-flex items-center rounded-full bg-teal-50 border border-teal-200 text-teal-700 dark:bg-teal-500/10 dark:border-teal-500/20 dark:text-teal-400 px-2 py-0.5 text-[11px] font-semibold">
                                        Reviewed
                                      </span>
                                    ) : hasMissing ? (
                                      <span className="inline-flex items-center rounded-full bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400 px-2 py-0.5 text-[11px] font-semibold">
                                        Needs Review
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 text-amber-700 dark:bg-orange-500/10 dark:border-orange-500/20 dark:text-orange-400 px-2 py-0.5 text-[11px] font-semibold">
                                        Draft
                                      </span>
                                    )
                                  ) : (
                                    <span className="inline-flex items-center rounded-full bg-blue-50 border border-blue-200 text-blue-700 dark:bg-blue-500/10 dark:border-blue-500/20 dark:text-blue-400 px-2 py-0.5 text-[11px] font-semibold">
                                      Confirmed
                                    </span>
                                  )}
                                  {hasMissing && isDraft && (
                                    <div className="mt-1.5 flex flex-col gap-1">
                                      {missingFields.slice(0, 2).map(field => (
                                        <span key={field} className="inline-block rounded bg-rose-50 border border-rose-100 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide w-fit">
                                          Missing {field}
                                        </span>
                                      ))}
                                      {missingFields.length > 2 && (
                                        <span className="inline-block rounded bg-[var(--card-elevated)] border border-[var(--border)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--muted)] w-fit">
                                          +{missingFields.length - 2} more
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  {!entry.proof_id && isDraft && (
                                    <div className="mt-1.5">
                                      <span className="inline-block rounded bg-orange-50 border border-orange-200 text-orange-700 dark:bg-orange-500/10 dark:border-orange-500/20 dark:text-orange-400 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide w-fit">
                                        No Proof
                                      </span>
                                    </div>
                                  )}
                                    
                                    {/* Exceptions List */}
                                    {getLedgerExceptions(entry).map(ex => (
                                      <div key={ex} className="mt-1.5">
                                        <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 px-2 py-0.5 text-[10px] font-bold">
                                          ⚠️ {ex}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                
                                {/* If it's a Draft, show the operational edit-trigger button */}
                                {isDraft ? (
                                  <div className="pt-2 flex flex-col gap-2">
                                    {finaliseConfirmId === entry.id ? (
                                      <div className="mt-1 rounded bg-amber-50 dark:bg-orange-500/10 border border-amber-200 dark:border-orange-500/20 p-2 shadow-sm min-w-[140px]">
                                        <p className="text-[9px] font-bold text-amber-900 dark:text-orange-400 leading-tight mb-2">Lock and confirm entry?</p>
                                        <div className="flex gap-1.5">
                                          <button type="button" onClick={() => setFinaliseConfirmId(null)} className="flex-1 rounded bg-[var(--card)] border border-[var(--border)] text-[var(--foreground)] text-[9px] font-bold py-1 hover:bg-[var(--card-muted)] transition-colors">Cancel</button>
                                          <button type="button" onClick={() => handleConfirmFinalise(entry.id)} disabled={savingId === entry.id} className="flex-1 rounded bg-amber-600 dark:bg-orange-600 text-white text-[9px] font-bold py-1 hover:bg-amber-700 dark:hover:bg-orange-700 disabled:opacity-50 transition-colors">Yes</button>
                                        </div>
                                      </div>
                                    ) : deleteConfirmId === entry.id ? (
                                      <div className="mt-1 rounded bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-2 shadow-sm min-w-[140px]">
                                        <p className="text-[9px] font-bold text-red-900 dark:text-red-400 leading-tight mb-2">Delete draft? {entry.proof_id ? "Proof is kept." : ""}</p>
                                        <div className="flex gap-1.5">
                                          <button type="button" onClick={() => setDeleteConfirmId(null)} className="flex-1 rounded bg-[var(--card)] border border-[var(--border)] text-[var(--foreground)] text-[9px] font-bold py-1 hover:bg-[var(--card-muted)] transition-colors">Cancel</button>
                                          <button type="button" onClick={() => handleDeleteEntry(entry.id)} disabled={savingId === entry.id} className="flex-1 rounded bg-red-600 dark:bg-red-700 text-white text-[9px] font-bold py-1 hover:bg-red-700 dark:hover:bg-red-600 disabled:opacity-50 transition-colors">Delete</button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="flex flex-col gap-2">
                                        {entry.review_status !== "reviewed" && !hasMissing && (
                                          <button 
                                            type="button" 
                                            onClick={() => handleMarkDraftReviewed(entry.id)} 
                                            disabled={savingId === entry.id}
                                            className="rounded bg-slate-900 dark:bg-slate-700 text-white text-[10px] font-bold px-3 py-1.5 hover:bg-slate-800 dark:hover:bg-slate-600 transition-colors shadow-sm w-full text-center"
                                          >
                                            Mark Reviewed
                                          </button>
                                        )}
                                        
                                        <button 
                                          type="button" 
                                          onClick={() => {
                                            if (entry.review_status === "reviewed" && !hasMissing) {
                                              setFinaliseConfirmId(entry.id);
                                            }
                                          }}
                                          disabled={savingId === entry.id || entry.review_status !== "reviewed" || hasMissing}
                                          className="rounded border border-[var(--border)] bg-[var(--card-elevated)] text-[var(--foreground)] text-[10px] font-bold px-3 py-1.5 hover:bg-[var(--card-muted)] transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed group relative w-full text-center"
                                        >
                                          Finalise Entry →
                                          {(entry.review_status !== "reviewed" || hasMissing) && (
                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block w-36 bg-slate-900 dark:bg-[var(--card)] dark:border dark:border-[var(--border)] text-white dark:text-[var(--foreground)] text-[9px] p-2 rounded text-center shadow-lg z-10 whitespace-normal">
                                              Must be reviewed with all fields filled
                                            </div>
                                          )}
                                        </button>
                                        
                                        <div className="flex items-center gap-3 mt-0.5">
                                          <button 
                                            type="button" 
                                            onClick={() => startEditing(entry)} 
                                            className="text-[var(--primary)] font-semibold underline hover:text-[var(--primary-hover)] transition-colors text-[10px]"
                                          >
                                            Edit Fields
                                          </button>
                                          <button 
                                            type="button" 
                                            onClick={() => setDeleteConfirmId(entry.id)} 
                                            className="text-red-600 dark:text-red-400 font-semibold underline hover:text-red-800 dark:hover:text-red-500 transition-colors text-[10px]"
                                          >
                                            Delete Draft
                                          </button>
                                          {entry.proof_id && (
                                            <a 
                                              href={`/inbox/${entry.proof_id}`} 
                                              target="_blank" 
                                              rel="noreferrer"
                                              className="text-indigo-700 dark:text-indigo-400 font-semibold underline hover:text-indigo-900 dark:hover:text-indigo-300 transition-colors text-[10px]"
                                            >
                                              Open Proof
                                            </a>
                                          )}
                                        </div>
                                        
                                        <button 
                                          type="button"
                                          onClick={() => toggleHistory(entry.id)}
                                          className="text-[var(--muted)] font-semibold underline hover:text-[var(--foreground)] transition-colors text-[10px] w-full text-left"
                                        >
                                          {expandedHistoryId === entry.id ? "Hide History" : "View History"}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  /* If it's Confirmed, hide edit tools and show the single Unlock safety toggle */
                                  <div className="pt-1 flex flex-col gap-2">
                                    <button 
                                      type="button" 
                                      onClick={() => handleUnlockEntry(entry.id)}
                                      disabled={savingId === entry.id}
                                      className="text-slate-500 font-semibold underline hover:text-slate-800 text-[10px] text-left"
                                    >
                                      Unlock row
                                    </button>
                                    <button 
                                      type="button"
                                      onClick={() => toggleHistory(entry.id)}
                                      className="text-slate-500 font-semibold underline hover:text-slate-800 text-[10px] text-left"
                                    >
                                      {expandedHistoryId === entry.id ? "Hide History" : "View History"}
                                    </button>
                                  </div>
                                )}
                                
                                {/* History Inline Render */}
                                {expandedHistoryId === entry.id && historyData[entry.id] && (
                                  <div className="mt-3 bg-slate-50 border border-slate-200 rounded p-2 shadow-inner w-48 text-left">
                                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-2 border-b border-slate-200 pb-1">Activity History</p>
                                    <div className="flex flex-col gap-2">
                                      {historyData[entry.id].length === 0 ? (
                                        <p className="text-[10px] text-slate-400">No logs found.</p>
                                      ) : (
                                        historyData[entry.id].map((log) => (
                                          <div key={log.id} className="flex gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-1 shrink-0" />
                                            <div>
                                              <p className="text-[10px] font-bold text-slate-700 capitalize leading-tight">{log.action.replace("_", " ")}</p>
                                              <p className="text-[9px] text-slate-500 mt-0.5">{new Date(log.created_at).toLocaleString()}</p>
                                              {log.details?.fields && (
                                                <p className="text-[9px] text-slate-600 mt-0.5 leading-tight">
                                                  {log.details.fields.join(", ")}
                                                </p>
                                              )}
                                            </div>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </td>

                          {/* 6. AMOUNT COLUMN */}
                          <td className="p-4 text-right font-mono font-bold">
                            {isEditing ? (
                              <input type="number" step="0.01" className={`${inputClass} text-right font-bold`} value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
                            ) : (
                              <span className={isExpense ? "text-[var(--foreground)]" : "text-emerald-700 dark:text-emerald-400"}>
                                {isExpense ? "-" : "+"}₹{Number(entry.amount).toFixed(2)}
                              </span>
                            )}
                          </td>

                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}