"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

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
  source?: string | null;
  metadata?: any;
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
};

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function findDuplicates(proof: Proof, allProofs: Proof[]): { proof: Proof; score: "possible" | "likely"; reasons: string[] }[] {
  const results: { proof: Proof; score: "possible" | "likely"; reasons: string[] }[] = [];
  
  for (const p of allProofs) {
    if (p.id === proof.id) continue;
    
    const isGeneric = /^(image|photo|screenshot|img_.*|whatsapp image.*)\.(png|jpg|jpeg|webp|heic)$/i.test(proof.original_name || "");
    const sameName = !isGeneric && proof.original_name && p.original_name && proof.original_name === p.original_name;
    
    const pAmount = proof.extracted_amount;
    const pParty = proof.extracted_party?.toLowerCase().trim();
    const pDate = proof.extracted_date;
    const pInvoice = proof.invoice_number?.toLowerCase().trim();
    
    const oAmount = p.extracted_amount;
    const oParty = p.extracted_party?.toLowerCase().trim();
    const oDate = p.extracted_date;
    const oInvoice = p.invoice_number?.toLowerCase().trim();
    
    const sameAmount = pAmount != null && pAmount === oAmount;
    const sameParty = !!pParty && pParty === oParty;
    const sameDate = !!pDate && pDate === oDate;
    const sameInvoice = !!pInvoice && pInvoice === oInvoice;
    
    const reasons: string[] = [];
    if (sameAmount) reasons.push("same amount");
    if (sameParty) reasons.push("same party");
    if (sameDate) reasons.push("same date");
    if (sameInvoice) reasons.push("same invoice/receipt number");
    if (sameName) reasons.push("same original filename");

    let score: "none" | "possible" | "likely" = "none";
    
    if (sameInvoice) {
      score = "likely";
    } else if (sameAmount && sameParty && sameDate) {
      score = "likely";
    } else if (sameName && (sameAmount || sameParty || sameDate)) {
      score = "likely";
    } else if ((sameAmount && sameParty) || (sameParty && sameDate) || (sameAmount && sameDate)) {
      score = "possible";
    } else if (sameName) {
      score = "possible";
    }
    
    if (score !== "none") {
      results.push({ proof: p, score, reasons });
    }
  }
  
  return results.sort((a, b) => {
    if (a.score !== b.score) return a.score === "likely" ? -1 : 1;
    if (a.reasons.length !== b.reasons.length) return b.reasons.length - a.reasons.length;
    return new Date(b.proof.created_at).getTime() - new Date(a.proof.created_at).getTime();
  });
}

export default function InboxPage() {
  const router = useRouter();
  const supabase = createClient();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [highlightProofId, setHighlightProofId] = useState<number | null>(null);
  const [readinessFilter, setReadinessFilter] = useState("all");
  const [proofSearch, setProofSearch] = useState("");
  const [sortOrder, setSortOrder] = useState("newest");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [draftLoadingId, setDraftLoadingId] = useState<number | null>(null);
  const [bulkDraftLoading, setBulkDraftLoading] = useState(false);
  const [bulkUnlinkLoading, setBulkUnlinkLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "done" | "success" | "error">("idle");
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [loadingProofs, setLoadingProofs] = useState(true);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);

  async function loadProofs() {
    try {
      setLoadingProofs(true);
      const res = await fetch(`/api/proofs/inbox?t=${Date.now()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to load proofs");
      setProofs(data.proofs || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingProofs(false);
    }
  }

  async function loadLedgerEntries() {
    try {
      const res = await fetch("/api/ledger");
      const data = await res.json();
      if (res.ok) setLedgerEntries(data.entries || []);
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    async function init() {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) { router.push("/login"); return; }
      await Promise.all([loadProofs(), loadLedgerEntries()]);
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loadingProofs && proofs.length > 0) {
      const params = new URLSearchParams(window.location.search);
      const highlight = params.get("highlight");
      if (highlight) {
        const id = Number(highlight);
        setHighlightProofId(id);
        setTimeout(() => {
          const el = document.getElementById(`proof-card-${id}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            window.history.replaceState(null, "", window.location.pathname);
            setTimeout(() => setHighlightProofId(null), 3000);
          }
        }, 100);
      }
    }
  }, [loadingProofs, proofs]);

  async function handleCreateLedgerDraft(proofId: number) {
    try {
      setDraftLoadingId(proofId);
      const res = await fetch(`/api/proofs/${proofId}/create-ledger`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setMessage(data.message || "Failed to create draft"); setStatus("error"); return; }
      setMessage("Ledger draft created");
      setStatus("done");
      await Promise.all([loadProofs(), loadLedgerEntries()]);
    } catch (err) { console.error(err); }
    finally { setDraftLoadingId(null); }
  }

  async function handleBulkUnlink() {
    const selectedProofs = proofs.filter((p) => selectedIds.has(p.id));
    const linkedProofs = selectedProofs.filter((p) => p.linked_entry_id);
    const skipped = selectedProofs.length - linkedProofs.length;

    if (linkedProofs.length === 0) {
      setMessage(`No linked proofs selected. (${skipped} skipped)`);
      setStatus("error");
      return;
    }

    if (!window.confirm(`Unlink ${linkedProofs.length} proof(s)?\n\nThis will safely disconnect them from their draft ledger entries. Finalized ledger entries will be blocked and skip unlinking.`)) return;

    try {
      setBulkUnlinkLoading(true);
      setMessage(`Unlinking ${linkedProofs.length} proof(s)...`);
      
      let successCount = 0;
      let failCount = 0;

      await Promise.allSettled(
        linkedProofs.map(async (p) => {
          const res = await fetch(`/api/proofs/${p.id}/unlink`, { method: "POST" });
          if (res.ok) successCount++;
          else failCount++;
        })
      );

      setMessage(`Updated ${successCount}. ${failCount > 0 ? `${failCount} failed. ` : ""}${skipped > 0 ? `${skipped} skipped.` : ""}`);
      setStatus(failCount === 0 ? "done" : "error");

      setSelectedIds(new Set());
      await Promise.all([loadProofs(), loadLedgerEntries()]);
    } catch (err) {
      console.error(err);
      setMessage("An error occurred during bulk unlinking.");
      setStatus("error");
    } finally {
      setBulkUnlinkLoading(false);
    }
  }

  async function handleBulkCreateDrafts() {
    const selectedProofs = proofs.filter((p) => selectedIds.has(p.id));
    const readyProofs = selectedProofs.filter((p) => {
      const isMissing = !p.extracted_party || p.extracted_amount == null;
      const isLinked = !!p.linked_entry_id;
      const hasDuplicate = findDuplicates(p, proofs).some(d => d.score === "likely");
      return !isLinked && !isMissing && !hasDuplicate;
    });
    const skipped = selectedProofs.length - readyProofs.length;

    if (readyProofs.length === 0) {
      setMessage(`No eligible proofs selected. (${skipped} skipped)`);
      setStatus("error");
      return;
    }

    try {
      setBulkDraftLoading(true);
      setMessage(`Generating ${readyProofs.length} draft ledger entries...`);
      
      let successCount = 0;
      let failCount = 0;

      await Promise.allSettled(
        readyProofs.map(async (p) => {
          const res = await fetch(`/api/proofs/${p.id}/create-ledger`, { method: "POST" });
          if (res.ok) successCount++;
          else failCount++;
        })
      );

      setMessage(`Created ${successCount} drafts. ${failCount > 0 ? `${failCount} failed. ` : ""}${skipped > 0 ? `${skipped} skipped.` : ""}`);
      setStatus(failCount === 0 ? "done" : "error");

      setSelectedIds(new Set());
      
      await Promise.all([loadProofs(), loadLedgerEntries()]);
    } catch (err) {
      console.error(err);
      setMessage("An error occurred during bulk creation.");
      setStatus("error");
    } finally {
      setBulkDraftLoading(false);
    }
  }

  function toggleSelectProof(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function clearSelection() { setSelectedIds(new Set()); }

  function handleInitiateDelete() {
    const selectedProofs = proofs.filter(p => selectedIds.has(p.id));
    const linkedProofs = selectedProofs.filter(p => p.linked_entry_id);
    
    if (linkedProofs.length > 0) {
      setMessage(`Cannot delete ${linkedProofs.length} proof(s) because they are linked to ledger entries. Deselect them first.`);
      setStatus("error");
      return;
    }
    setShowDeleteConfirm(true);
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    try {
      const results = await Promise.all(Array.from(selectedIds).map(async (id) => {
        const res = await fetch(`/api/proofs/${id}`, { method: "DELETE" });
        return { id, ok: res.ok };
      }));
      
      const successIds = results.filter(r => r.ok).map(r => r.id);
      const successCount = successIds.length;
      
      setProofs((prev) => prev.filter((p) => !successIds.includes(p.id)));
      
      setMessage(`${successCount} proof(s) permanently deleted.`);
      setStatus(successCount === selectedIds.size ? "done" : "error");
      
      clearSelection();
      setShowDeleteConfirm(false);
      await loadProofs();
    } catch (err) {
      console.error(err);
      setMessage("An error occurred while deleting.");
      setStatus("error");
    } finally {
      setDeleting(false);
    }
  }

  async function handleBulkReviewStatus(newStatus: "reviewed" | "needs_rework") {
    const selectedProofs = proofs.filter((p) => selectedIds.has(p.id));
    const eligibleProofs = selectedProofs.filter((p) => p.processing_status !== newStatus);
    const skipped = selectedProofs.length - eligibleProofs.length;

    if (eligibleProofs.length === 0) {
      setMessage(`No eligible proofs selected. (${skipped} skipped)`);
      setStatus("error");
      return;
    }

    try {
      let successCount = 0;
      let failCount = 0;

      await Promise.allSettled(
        eligibleProofs.map(async (p) => {
          const res = await fetch(`/api/proofs/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ processing_status: newStatus }) });
          if (res.ok) successCount++;
          else failCount++;
        })
      );
      
      setMessage(`Updated ${successCount}. ${failCount > 0 ? `${failCount} failed. ` : ""}${skipped > 0 ? `${skipped} skipped.` : ""}`);
      setStatus(failCount === 0 ? "done" : "error");
      clearSelection();
      await loadProofs();
    } catch (err) {
      console.error(err);
      setMessage("An error occurred during bulk update.");
      setStatus("error");
    }
  }

  async function handleReviewSingle(id: number) {
    try {
      await fetch(`/api/proofs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ processing_status: "reviewed" }) });
      setMessage(`Proof #${id} marked as reviewed.`);
      setStatus("done");
      await loadProofs();
    } catch (err) { console.error(err); }
  }

  function clearAllControls() { setProofSearch(""); setReadinessFilter("all"); setSortOrder("newest"); }

  function isLedgerStale(proof: Proof): boolean {
    if (!proof.linked_entry_id) return false;
    const entry = ledgerEntries.find((e) => e.id === proof.linked_entry_id);
    if (!entry?.updated_at) return false;
    const ledgerUpdated = new Date(entry.updated_at);
    const lastChecked = proof.reviewed_at ? new Date(proof.reviewed_at) : new Date(proof.created_at);
    return ledgerUpdated > lastChecked;
  }

  function getConfidence(proof: Proof): { label: string; color: string } {
    if (proof.processing_status === "reviewed" || (!!proof.extracted_party && proof.extracted_amount != null && !!proof.extracted_date))
      return { label: "High confidence", color: "bg-emerald-50 border-emerald-200 text-emerald-700" };
    if (!!proof.extracted_party && proof.extracted_amount != null)
      return { label: "Medium confidence", color: "bg-yellow-50 border-yellow-200 text-yellow-700" };
    return { label: "Low confidence", color: "bg-red-50 border-red-200 text-red-700" };
  }


  const searchedProofs = proofs.filter((proof) => {
    if (!proofSearch.trim()) return true;
    const q = proofSearch.toLowerCase();
    return proof.original_name?.toLowerCase().includes(q) || proof.extracted_party?.toLowerCase().includes(q);
  });

  function getProofExceptions(p: Proof): string[] {
    const ex: string[] = [];
    const dups = findDuplicates(p, proofs);
    if (dups.length > 0 && dups[0].score === "likely") ex.push("Duplicate Detected");
    if (p.processing_status !== "unprocessed" && (!p.extracted_amount || !p.extracted_date || !p.extracted_party)) ex.push("Missing Info");
    if (p.processing_status === "reviewed" && !p.linked_entry_id) ex.push("Stalled at Review");
    return ex;
  }

  const proofCounts = {
    all: searchedProofs.length,
    exceptions: searchedProofs.filter(p => getProofExceptions(p).length > 0).length,
    exceptions_duplicates: searchedProofs.filter(p => getProofExceptions(p).includes("Duplicate Detected")).length,
    exceptions_missing: searchedProofs.filter(p => getProofExceptions(p).includes("Missing Info")).length,
    exceptions_stalled: searchedProofs.filter(p => getProofExceptions(p).includes("Stalled at Review")).length,
    ready: searchedProofs.filter((p) => !!p.extracted_party && p.extracted_amount != null).length,
    needs_review: searchedProofs.filter((p) => !p.extracted_party || p.extracted_amount == null).length,
    unreviewed: searchedProofs.filter((p) => p.processing_status === "unprocessed" || !p.processing_status).length,
    reviewed: searchedProofs.filter((p) => p.processing_status === "reviewed").length,
    drafted: searchedProofs.filter((p) => p.processing_status === "drafted").length,
    linked: searchedProofs.filter((p) => p.processing_status === "linked" || !!p.linked_entry_id).length,
  };

  const filteredProofs = searchedProofs.filter((proof) => {
    const isReady = !!proof.extracted_party && proof.extracted_amount != null;
    const isDrafted = proof.processing_status === "drafted";
    const isLinked = proof.processing_status === "linked" || !!proof.linked_entry_id;
    if (readinessFilter === "exceptions") return getProofExceptions(proof).length > 0;
    if (readinessFilter === "ready") return isReady;
    if (readinessFilter === "needs_review") return !isReady;
    if (readinessFilter === "unreviewed") return proof.processing_status === "unprocessed" || !proof.processing_status;
    if (readinessFilter === "drafted") return isDrafted;
    if (readinessFilter === "linked") return isLinked;
    if (readinessFilter === "reviewed") return proof.processing_status === "reviewed";
    return true;
  });

  const sortedProofs = [...filteredProofs].sort((a, b) => {
    // If viewing exceptions, use priority ordering
    if (readinessFilter === "exceptions") {
      const aEx = getProofExceptions(a);
      const bEx = getProofExceptions(b);
      
      const aScore = aEx.includes("Duplicate Detected") ? 3 : aEx.includes("Missing Info") ? 2 : aEx.includes("Stalled at Review") ? 1 : 0;
      const bScore = bEx.includes("Duplicate Detected") ? 3 : bEx.includes("Missing Info") ? 2 : bEx.includes("Stalled at Review") ? 1 : 0;
      
      if (aScore !== bScore) return bScore - aScore;
      // Fallback to normal sort if scores are same
    }

    if (sortOrder === "newest") {
      const diff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return diff !== 0 ? diff : b.id - a.id;
    }
    if (sortOrder === "oldest") {
      const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return diff !== 0 ? diff : a.id - b.id;
    }
    
    if (sortOrder === "amount_high" || sortOrder === "amount_low") {
      const aMissing = a.extracted_amount == null;
      const bMissing = b.extracted_amount == null;
      
      if (aMissing && bMissing) return b.id - a.id;
      if (aMissing) return 1;
      if (bMissing) return -1;
      
      const diff = sortOrder === "amount_high" 
        ? b.extracted_amount! - a.extracted_amount!
        : a.extracted_amount! - b.extracted_amount!;
        
      return diff !== 0 ? diff : b.id - a.id;
    }
    
    return b.id - a.id;
  });

  function selectAllVisible() { setSelectedIds(new Set(sortedProofs.map((p) => p.id))); }

  const isFiltered = proofSearch.trim() !== "" || readinessFilter !== "all" || sortOrder !== "newest";
  const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200";
  const cardClass = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900 p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Proof Inbox</h1>
            <p className="text-sm text-slate-500 mt-0.5">Review, extract, and convert proofs to ledger entries</p>
          </div>
          <a href="/uploads" className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800">
            + Upload proof
          </a>
        </div>

        {message && (
          <p className={`text-sm font-medium px-4 py-2 rounded-lg ${status === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
            {message}
          </p>
        )}

        {/* Exception Summary Bar */}
        <div className="grid grid-cols-3 gap-3 md:gap-6">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm flex flex-col justify-center items-center text-center">
            <span className="text-3xl font-bold text-red-700">{proofCounts.exceptions_duplicates}</span>
            <span className="text-xs font-bold text-red-800 uppercase tracking-widest mt-1">Duplicates</span>
          </div>
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 shadow-sm flex flex-col justify-center items-center text-center">
            <span className="text-3xl font-bold text-orange-700">{proofCounts.exceptions_missing}</span>
            <span className="text-xs font-bold text-orange-800 uppercase tracking-widest mt-1">Missing Info</span>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm flex flex-col justify-center items-center text-center">
            <span className="text-3xl font-bold text-amber-700">{proofCounts.exceptions_stalled}</span>
            <span className="text-xs font-bold text-amber-800 uppercase tracking-widest mt-1">Stalled at Review</span>
          </div>
        </div>

        {/* Filters + search */}
        <section className={cardClass}>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-slate-600">{sortedProofs.length} proofs</span>
              <button type="button" onClick={selectAllVisible} className="text-xs font-medium text-slate-600 hover:text-slate-900 underline">Select all</button>
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5">
                  <span className="text-xs font-medium text-slate-700">{selectedIds.size} selected</span>
                  <button type="button" onClick={handleBulkCreateDrafts} disabled={bulkDraftLoading} className="text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-600 rounded-lg px-2 py-1 disabled:opacity-50">
                    {bulkDraftLoading ? "Creating..." : "Create drafts"}
                  </button>
                  <button type="button" onClick={handleBulkUnlink} disabled={bulkUnlinkLoading} className="text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg px-2 py-1 disabled:opacity-50">
                    {bulkUnlinkLoading ? "Unlinking..." : "Unlink"}
                  </button>
                  <button type="button" onClick={() => handleBulkReviewStatus("reviewed")} className="text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 rounded-lg px-2 py-1">Mark reviewed</button>
                  <button type="button" onClick={handleInitiateDelete} className="text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg px-2 py-1">Delete</button>
                  <button type="button" onClick={clearSelection} className="text-xs font-medium text-slate-500 hover:text-slate-900 underline">Clear</button>
                </div>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <input type="text" placeholder="Search..." className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 w-48 focus:outline-none focus:ring-2 focus:ring-slate-200" value={proofSearch} onChange={(e) => setProofSearch(e.target.value)} />
              <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="amount_high">Amount ↓</option>
                <option value="amount_low">Amount ↑</option>
              </select>
              {isFiltered && <button type="button" onClick={clearAllControls} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100">Clear all</button>}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-3">
            {[
              { label: "Exceptions", value: "exceptions", count: proofCounts.exceptions, color: "bg-red-50 text-red-700 border-red-200" },
              { label: "All", value: "all", count: proofCounts.all },
              { label: "Unreviewed", value: "unreviewed", count: proofCounts.unreviewed },
              { label: "Reviewed", value: "reviewed", count: proofCounts.reviewed },
              { label: "Ready", value: "ready", count: proofCounts.ready },
              { label: "Needs extraction", value: "needs_review", count: proofCounts.needs_review },
              { label: "Drafted", value: "drafted", count: proofCounts.drafted },
              { label: "Linked", value: "linked", count: proofCounts.linked },
            ].map((f) => (
              <button key={f.value} type="button" onClick={() => setReadinessFilter(f.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${readinessFilter === f.value ? (f.value === "exceptions" ? "bg-red-700 text-white border-red-700" : "bg-slate-900 text-white border-slate-900") : (f.color || "bg-white text-slate-700 border-slate-300 hover:bg-slate-100")}`}>
                {f.label} <span className={`ml-1 opacity-70 ${readinessFilter === f.value ? "text-white" : ""}`}>{f.count}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Proof cards */}
        {loadingProofs ? (
          <p className="text-sm text-slate-600">Loading proofs...</p>
        ) : sortedProofs.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
            <p className="text-sm font-medium text-slate-700">No proofs found</p>
            <p className="mt-1 text-xs text-slate-500">Try clearing your search or switching filter.</p>
            {isFiltered && <button type="button" onClick={clearAllControls} className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100">Clear all</button>}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {sortedProofs.map((proof) => {
              const isReady = proof.extracted_party && proof.extracted_amount != null;
              const isNeedsReview = !isReady && proof.processing_status !== 'reviewed' && proof.processing_status !== 'drafted' && proof.processing_status !== 'linked';
              const missingFields: string[] = [];
              if (isNeedsReview) {
                if (!proof.extracted_party) missingFields.push("party");
                if (proof.extracted_amount == null) missingFields.push("amount");
                if (!proof.extracted_date) missingFields.push("date");
                if (!proof.extracted_category) missingFields.push("category");
                if (!proof.extracted_entry_type) missingFields.push("type");
              }
              const visibleMissing = missingFields.slice(0, 2);
              const extraMissingCount = missingFields.length - 2;
              
              const duplicates = findDuplicates(proof, proofs);

              return (
              <div key={proof.id} id={`proof-card-${proof.id}`}
                className={`rounded-xl border p-4 transition-all duration-1000 ${highlightProofId === proof.id ? "border-teal-400 bg-teal-50 shadow-md" : selectedIds.has(proof.id) ? "border-slate-400 bg-slate-100" : "border-slate-200 bg-white"}`}>

                {/* Checkbox */}
                <div className="flex items-center gap-2 mb-2">
                  <input type="checkbox" checked={selectedIds.has(proof.id)} onChange={() => toggleSelectProof(proof.id)} className="h-4 w-4 rounded border-slate-300 accent-slate-800" />
                  <span className="text-xs text-slate-400">Select</span>
                </div>

                {/* Thumbnail */}
                {proof.preview_url && (
                  <div className="mb-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                    <img src={proof.preview_url} alt={proof.original_name || "Proof"} className="h-40 w-full object-cover" />
                  </div>
                )}

                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-medium text-slate-500">Proof #{proof.id}</p>
                      {proof.processing_status === "reviewed" ? (
                        <span className="inline-flex items-center rounded-full bg-blue-100 border border-blue-300 px-2 py-0.5 text-[10px] font-bold text-blue-800">Reviewed</span>
                      ) : proof.processing_status === "linked" ? (
                        <span className="inline-flex items-center rounded-full bg-indigo-100 border border-indigo-300 px-2 py-0.5 text-[10px] font-bold text-indigo-800">Linked</span>
                      ) : proof.processing_status === "needs_rework" ? (
                        <span className="inline-flex items-center rounded-full bg-red-100 border border-red-300 px-2 py-0.5 text-[10px] font-bold text-red-800">Needs Rework</span>
                      ) : proof.processing_status === "drafted" ? (
                        <span className="inline-flex items-center rounded-full bg-purple-100 border border-purple-300 px-2 py-0.5 text-[10px] font-bold text-purple-800">Drafted</span>
                      ) : proof.extracted_party && proof.extracted_amount != null ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 border border-emerald-300 px-2 py-0.5 text-[10px] font-bold text-emerald-800">Ready</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-[10px] font-bold text-amber-800">Needs review</span>
                      )}
                      {proof.reviewed_at && <span className="text-[10px] text-slate-500">Reviewed {timeAgo(proof.reviewed_at)}</span>}
                      {duplicates.length > 0 && (
                        <Link href={`/inbox/${duplicates[0].proof.id}`} title={duplicates[0].reasons.join(", ")} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold transition-colors ${duplicates[0].score === 'likely' ? 'bg-red-100 border-red-300 text-red-800 hover:bg-red-200' : 'bg-orange-100 border-orange-300 text-orange-800 hover:bg-orange-200'}`}>
                          ⚠️ {duplicates[0].score === 'likely' ? 'Likely' : 'Possible'} duplicate of #{duplicates[0].proof.id}
                        </Link>
                      )}
                      {proof.processing_status !== "reviewed" && (() => {
                        const conf = getConfidence(proof);
                        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${conf.color}`}>{conf.label}</span>;
                      })()}
                      
                      {/* Exceptions List */}
                      {getProofExceptions(proof).map(ex => (
                        <span key={ex} className="inline-flex items-center rounded-full border border-red-200 bg-red-50 text-red-700 px-2 py-0.5 text-[10px] font-bold">
                          ⚠️ {ex}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs text-slate-400">{new Date(proof.created_at).toLocaleString()}</span>
                    {proof.source === 'whatsapp' && (
                      <span className="inline-flex items-center rounded-full bg-[#25D366]/10 px-2 py-0.5 text-[10px] font-bold text-[#128C7E] border border-[#25D366]/20">
                        WhatsApp
                      </span>
                    )}
                  </div>
                </div>

                {proof.comment && <p className="mt-2 text-sm text-slate-700">{proof.comment}</p>}

                {/* Extracted fields */}
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: "Party", value: proof.extracted_party || "—" },
                    { label: "Project / Site", value: proof.project_name || "—" },
                    { label: "Amount", value: proof.extracted_amount != null ? `₹${proof.extracted_amount.toFixed(2)}` : "—" },
                    { label: "Date", value: proof.extracted_date || "—" },
                  ].map((f) => (
                    <div key={f.label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{f.label}</p>
                      <p className="mt-0.5 text-sm font-semibold text-slate-900">{f.value}</p>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div className="mt-4 flex gap-2 flex-wrap items-center">
                  <a href={`/inbox/${proof.id}`} className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-bold text-white hover:bg-teal-800">
                    Edit Proof
                  </a>

                  {proof.processing_status !== "reviewed" && !proof.linked_entry_id && (
                    <button type="button" onClick={() => handleReviewSingle(proof.id)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100">
                      Mark reviewed
                    </button>
                  )}

                  {!proof.linked_entry_id && proof.extracted_party && proof.extracted_amount != null && (
                    <button type="button" onClick={() => handleCreateLedgerDraft(proof.id)} disabled={draftLoadingId === proof.id}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-60">
                      {draftLoadingId === proof.id ? "Creating..." : "Create ledger draft"}
                    </button>
                  )}

                  {proof.linked_entry_id && (
                    <>
                      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-800">
                        Linked #{proof.linked_entry_id}
                      </span>
                      <a href={`/ledger?highlight=${proof.linked_entry_id}`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100">
                        Go to ledger
                      </a>
                    </>
                  )}
                </div>
              </div>
            )})}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900">
              {selectedIds.size === 1 ? "Delete this proof from everywhere?" : `Delete ${selectedIds.size} proofs from everywhere?`}
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              This action removes the proof record and stored file permanently.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setShowDeleteConfirm(false)} disabled={deleting} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-700 bg-slate-100 border border-slate-300 hover:bg-slate-200">
                NO, CANCEL
              </button>
              <button type="button" onClick={handleBulkDelete} disabled={deleting} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60">
                {deleting ? "DELETING..." : "YES, DELETE"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}