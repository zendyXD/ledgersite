"use client";

import { useEffect, useState, use, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  extracted_category?: string | null;
  extracted_entry_type?: string | null;
  project_name?: string | null;
  invoice_number?: string | null;
  extraction_confidence?: Record<string, string> | null;
  source?: string | null;
  metadata?: any;
};

export default function SingleProofReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const isQueueMode = searchParams.get("queueMode") === "true";
  const queueCount = searchParams.get("queueCount");

  // Safely unwrap Next.js 15 params promise
  const resolvedParams = use(params);
  const proofId = parseInt(resolvedParams.id, 10);

  const [proof, setProof] = useState<Proof | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "done" | "error">("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Editing state fields
  const [isEditing, setIsEditing] = useState(false);
  const [editParty, setEditParty] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editType, setEditType] = useState("");
  const [editProject, setEditProject] = useState("");
  const [saving, setSaving] = useState(false);
  const [manuallyReviewedFields, setManuallyReviewedFields] = useState<Set<string>>(new Set());
  const [draftLoading, setDraftLoading] = useState(false);
  const [duplicates, setDuplicates] = useState<{ proof: Proof; score: "possible" | "likely"; reasons: string[] }[]>([]);
  const [unlinking, setUnlinking] = useState(false);
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [markingReviewed, setMarkingReviewed] = useState(false);

  // Split Expense State
  const [isSplit, setIsSplit] = useState(false);
  const [splitRows, setSplitRows] = useState<{ id: string; worker: string; role: string; amount: number; note: string }[]>([
    { id: `row_${Date.now()}`, worker: "", role: "", amount: 0, note: "" }
  ]);

  async function loadSingleProof() {
    try {
      setLoading(true);
      setMessage("");
      setStatus("idle");

      const res = await fetch(`/api/proofs/${proofId}`);
      const data = await res.json();

      // FIX: Instead of throwing an unhandled exception that causes the red screen modal,
      // catch the 404 or 500 error status codes and display our styled component view message.
      if (!res.ok) {
        setProof(null);
        setMessage(data.message || "Failed to fetch proof details.");
        setStatus("error");
        return; // Exit safely
      }

      let loadedProof = null;
      if (data && data.proof) {
        loadedProof = data.proof;
        setProof(data.proof);
        setPreviewUrl(data.signed_url || null);
      } else {
        loadedProof = data;
        setProof(data);
        setPreviewUrl(data.preview_url || data.signed_url || null);
      }

      if (loadedProof) {
        try {
          const inboxRes = await fetch("/api/proofs/inbox?limit=100");
          if (inboxRes.ok) {
            const inboxData = await inboxRes.json();
            const allProofs = inboxData.proofs || [];

            const dups: { proof: Proof; score: "possible" | "likely"; reasons: string[] }[] = [];

            for (const p of allProofs) {
              if (p.id === loadedProof.id) continue;

              const isGeneric = /^(image|photo|screenshot|img_.*|whatsapp image.*)\.(png|jpg|jpeg|webp|heic)$/i.test(loadedProof.original_name || "");
              const sameName = !isGeneric && loadedProof.original_name && p.original_name && loadedProof.original_name === p.original_name;

              const pAmount = loadedProof.extracted_amount;
              const pParty = loadedProof.extracted_party?.toLowerCase().trim();
              const pDate = loadedProof.extracted_date;
              const pInvoice = loadedProof.invoice_number?.toLowerCase().trim();

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
                dups.push({ proof: p, score, reasons });
              }
            }

            dups.sort((a, b) => {
              if (a.score !== b.score) return a.score === "likely" ? -1 : 1;
              if (a.reasons.length !== b.reasons.length) return b.reasons.length - a.reasons.length;
              return new Date(b.proof.created_at).getTime() - new Date(a.proof.created_at).getTime();
            });


            setDuplicates(dups);
          }
        } catch (e) {
          console.error("Failed to check duplicates", e);
        }

        // Load history logs for this proof
        try {
          const histRes = await fetch(`/api/activity?entity_type=proof&entity_id=${proofId}`);
          if (histRes.ok) {
            const histData = await histRes.json();
            setHistory(histData.logs || []);
          }
        } catch (err) {
          console.error("Failed to load history", err);
        }
      }
    } catch (err: any) {
      console.error("Load single proof error:", err);
      setMessage(err.message || "Could not find or load this specific proof.");
      setStatus("error");
    } finally {
      setLoading(false);
    }
  }

  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    async function checkUser() {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        router.push("/login");
        return;
      }
      if (proofId) {
        await loadSingleProof();
      }
    }
    checkUser();
  }, [proofId]);

  function startEditing() {
    if (!proof) return;
    setIsEditing(true);
    setEditParty(proof.extracted_party ?? "");
    setEditAmount(proof.extracted_amount != null ? String(proof.extracted_amount) : "");
    setEditDate(proof.extracted_date ?? "");
    setEditCategory(proof.extracted_category ?? "");
    setEditType(proof.extracted_entry_type ?? "");
    setEditProject(proof.project_name ?? "");
  }

  async function handleSaveExtracted() {
    const hasImportantChanges =
      editParty !== (proof?.extracted_party || "") ||
      editAmount !== (proof?.extracted_amount?.toString() || "") ||
      editDate !== (proof?.extracted_date || "") ||
      editCategory !== (proof?.extracted_category || "") ||
      editType !== (proof?.extracted_entry_type || "");

    const payload: any = {
      extracted_party: editParty,
      extracted_amount: editAmount ? parseFloat(editAmount) : null,
      extracted_date: editDate || null,
      extracted_category: editCategory,
      extracted_entry_type: editType,
      project_name: editProject,
    };

    if (hasImportantChanges && (proof?.processing_status === "reviewed" || proof?.processing_status === "needs_rework")) {
      payload.processing_status = "unprocessed";
    }

    try {
      setSaving(true);
      const res = await fetch(`/api/proofs/${proofId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to save data");

      setProof(data.proof);
      setIsEditing(false);
      setMessage("Fields updated successfully.");
      setStatus("done");

      // Refresh history to show the "edited" event
      try {
        const histRes = await fetch(`/api/activity?entity_type=proof&entity_id=${proofId}`);
        if (histRes.ok) {
          const histData = await histRes.json();
          setHistory(histData.logs || []);
        }
      } catch (e) {
        console.error("Error refreshing history after save", e);
      }
    } catch (err: any) {
      setMessage(err.message || "Error saving metadata");
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  async function handleUnlink() {
    if (!proof) return;
    try {
      setUnlinking(true);
      const res = await fetch(`/api/proofs/${proof.id}/unlink`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to unlink proof");

      setMessage("Proof unlinked successfully.");
      setStatus("done");
      setShowUnlinkConfirm(false);
      await loadSingleProof();
    } catch (err: any) {
      setMessage(err.message || "Error unlinking proof");
      setStatus("error");
      setShowUnlinkConfirm(false);
    } finally {
      setUnlinking(false);
    }
  }

  async function handleCreateLedgerDraft() {
    if (!proof) return;

    let splitAllocations: any[] = [];
    if (isSplit) {
      splitAllocations = splitRows.filter(r => r.worker.trim() && r.amount > 0);
      if (splitAllocations.length === 0) {
        setMessage("Split expense requires at least 1 valid worker allocation.");
        setStatus("error");
        return;
      }
      const sum = splitAllocations.reduce((acc, r) => acc + r.amount, 0);
      if (sum !== (proof.extracted_amount || 0)) {
        setMessage(`Split amounts must equal total (₹${proof.extracted_amount}). Currently allocated: ₹${sum}`);
        setStatus("error");
        return;
      }
    }

    try {
      setDraftLoading(true);
      const res = await fetch(`/api/proofs/${proof.id}/create-ledger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_split: isSplit, split_allocations: splitAllocations })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to generate entry");

      setMessage("Ledger draft created successfully!");
      setStatus("done");
      await loadSingleProof();
    } catch (err: any) {
      setMessage(err.message || "Error creating ledger entry");
      setStatus("error");
    } finally {
      setDraftLoading(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("Delete this proof?\n\nThis will permanently remove the uploaded proof. This cannot be undone.")) return;
    try {
      setDeleting(true);
      const res = await fetch(`/api/proofs/${proofId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to delete proof");
      router.push("/inbox");
    } catch (err: any) {
      setMessage(err.message || "Error deleting proof");
      setStatus("error");
      setDeleting(false);
    }
  }

  async function handleReExtract() {
    try {
      setExtracting(true);
      setMessage("Running AI extraction...");
      setStatus("idle");
      const res = await fetch(`/api/proofs/${proofId}/extract`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to re-extract");
      setMessage("Extraction completed successfully.");
      setStatus("done");
      await loadSingleProof();
    } catch (err: any) {
      setMessage(err.message || "Error during extraction");
      setStatus("error");
    } finally {
      setExtracting(false);
    }
  }

  async function handleSetReviewStatus(newStatus: "reviewed" | "needs_rework") {
    try {
      setMarkingReviewed(true);
      const res = await fetch(`/api/proofs/${proofId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ processing_status: newStatus })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to update status");

      setMessage(`Proof marked as ${newStatus.replace("_", " ")}.`);
      setStatus("done");
      await loadSingleProof();
    } catch (err: any) {
      setMessage(err.message || "Error updating status");
      setStatus("error");
    } finally {
      setMarkingReviewed(false);
    }
  }

  async function handleApproveQueue() {
    try {
      setMarkingReviewed(true);
      const res = await fetch(`/api/proofs/${proofId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ processing_status: "reviewed" })
      });
      if (!res.ok) throw new Error("Failed to approve");
      router.push("/review");
    } catch (err: any) {
      setMessage(err.message || "Error approving");
      setStatus("error");
      setMarkingReviewed(false);
    }
  }

  async function handleSkipQueue() {
    if (!window.confirm("Skip and permanently delete this uploaded screenshot?")) return;
    try {
      setDeleting(true);
      const res = await fetch(`/api/proofs/${proofId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      router.push("/review");
    } catch (err: any) {
      setMessage(err.message || "Error skipping");
      setStatus("error");
      setDeleting(false);
    }
  }

  const isMessy = !!(proof && (!proof.extracted_text || proof.extracted_text.length < 100));

  const flaggedFields = useMemo(() => {
    if (!proof) return [];

    const check = (name: string, label: string, value: any, isWeak: boolean) => {
      if (manuallyReviewedFields.has(name)) return null;
      if (value === null || value === undefined || value === "") return { name, label, status: "missing", value: "—" };
      if (isWeak) return { name, label, status: "needs_review", value };
      return null;
    };

    const isWeakConf = (field: string) => {
      const conf = proof.extraction_confidence?.[field];
      return conf === "low" || conf === "medium";
    };

    return [
      check("party", "Party / Vendor", proof.extracted_party, isWeakConf("party") || (proof.extracted_party?.length || 0) < 4),
      check("amount", "Amount", proof.extracted_amount, isWeakConf("amount") || (isMessy && proof.extracted_amount != null)),
      check("date", "Date", proof.extracted_date, isWeakConf("date")),
      check("category", "Category", proof.extracted_category, false)
    ].filter(Boolean) as { name: string, label: string, status: "missing" | "needs_review", value: any }[];
  }, [proof, manuallyReviewedFields, isMessy]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 p-8 flex items-center justify-center">
        <p className="text-slate-600 font-medium">Loading proof file details...</p>
      </div>
    );
  }

  if (!proof) {
    return (
      <div className="min-h-screen bg-slate-100 p-8 text-center">
        <p className="text-red-700 font-medium">{message || "Proof document not found."}</p>
        <Link href="/inbox" className="mt-4 inline-block text-sm text-teal-700 underline">
          Return to Proof Inbox
        </Link>
      </div>
    );
  }

  const isReady = !!proof.extracted_party && proof.extracted_amount != null && !!proof.extracted_date;

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900 p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Top Breadcrumb Navigation */}
        <div className="flex items-center justify-between">
          <div>
            <Link href="/inbox" className="text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800 transition-colors">
              ← Back to Proof Inbox
            </Link>
            <div className="flex items-center gap-3 mt-1">
              <h1 className="text-2xl font-bold text-slate-900">{isQueueMode ? "Review Queue" : `Review Proof #${proof.id}`}</h1>
              {isQueueMode && queueCount && (
                <span className="inline-flex items-center rounded-full bg-emerald-100 border border-emerald-300 px-3 py-1 text-xs font-bold text-emerald-800">
                  {queueCount} items left
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">Uploaded {new Date(proof.created_at).toLocaleString()}</p>
          </div>
        </div>

        {message && (
          <div className={`text-sm font-medium px-4 py-3 rounded-xl border ${status === "error" ? "bg-red-50 border-red-200 text-red-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>
            {message}
          </div>
        )}

        {/* Workspace Layout Split */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

          {/* Column A: Document File View Attachment */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">Uploaded Document Proof</h3>
              {previewUrl && (
                <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-teal-700 hover:underline">
                  Open full size ↗
                </a>
              )}
            </div>
            {previewUrl ? (
              <div className="overflow-hidden rounded-xl border border-slate-100 bg-slate-50">
                <img src={previewUrl} alt={proof.original_name || "Attachment"} className="w-full h-auto object-contain max-h-[800px]" />
              </div>
            ) : (
              <div className="rounded-xl border-2 border-dashed bg-slate-50 p-12 text-center text-sm text-slate-400">
                No automatic image preview available ({proof.original_name || "PDF Document"})
              </div>
            )}
            <div className="pt-2 text-xs text-slate-400 break-all">
              <strong>Storage File Path:</strong> {proof.file_path}
            </div>
          </div>

          {/* Column B: Structured Fields Form Card */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm flex flex-col">
            {/* 1. Status & Alerts Area */}
            <div className={`p-4 border-b ${proof.linked_entry_id ? "bg-blue-50 border-blue-200 text-blue-800 rounded-t-2xl" :
                proof.processing_status === "reviewed" ? "bg-teal-50 border-teal-200 text-teal-800 rounded-t-2xl" :
                  isReady ? "bg-emerald-50 border-emerald-200 text-emerald-800 rounded-t-2xl" : "bg-amber-50 border-amber-200 text-amber-800 rounded-t-2xl"
              }`}>
              <h2 className="text-lg font-bold">
                {proof.linked_entry_id ? "Linked to Ledger" :
                  proof.processing_status === "reviewed" ? "Reviewed" :
                    isReady ? "Ready for Ledger" : "Needs Review"}
              </h2>
              <p className="text-sm mt-1 opacity-80">
                {proof.linked_entry_id
                  ? `This proof is securely linked to Ledger Entry #${proof.linked_entry_id}.`
                  : proof.processing_status === "reviewed"
                    ? "This proof has been marked as reviewed. You can create a ledger draft when ready."
                    : isReady
                      ? "All required fields are present. You can now create a ledger draft."
                      : "Please fill out the missing fields below to proceed."}
              </p>
            </div>

            <div className="p-6 space-y-6 flex-1">
              {duplicates.length > 0 && (
                <div className={`${duplicates[0].score === "likely" ? "bg-red-50 border-red-200" : "bg-orange-50 border-orange-200"} border rounded-xl p-4`}>
                  <p className={`text-sm font-bold ${duplicates[0].score === "likely" ? "text-red-800" : "text-orange-800"}`}>
                    ⚠️ {duplicates[0].score === "likely" ? "Likely" : "Possible"} Duplicate Detected
                  </p>
                  <p className={`text-sm mt-1 ${duplicates[0].score === "likely" ? "text-red-700" : "text-orange-700"}`}>
                    This looks very similar to <Link href={`/inbox/${duplicates[0].proof.id}`} className="font-bold underline hover:opacity-80">Proof #{duplicates[0].proof.id}</Link>.
                  </p>
                  <p className={`text-xs mt-2 font-medium ${duplicates[0].score === "likely" ? "text-red-800" : "text-orange-800"}`}>
                    Matches on: {duplicates[0].reasons.join(", ")}
                  </p>
                  <div className="mt-3 flex items-center gap-3">
                    <Link href={`/inbox/${duplicates[0].proof.id}`} className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${duplicates[0].score === "likely" ? "bg-red-100 text-red-800 border-red-200 hover:bg-red-200" : "bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-200"}`}>
                      Open Proof #{duplicates[0].proof.id}
                    </Link>
                    <a href={`/inbox/${duplicates[0].proof.id}`} target="_blank" rel="noopener noreferrer" className={`text-xs hover:underline ${duplicates[0].score === "likely" ? "text-red-700" : "text-orange-700"}`}>
                      Open in new tab ↗
                    </a>
                  </div>
                </div>
              )}

              {flaggedFields.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-amber-800 font-bold text-sm">⚠️ Attention Required</span>
                    {isMessy && <span className="bg-amber-200 text-amber-900 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Handwritten / Messy</span>}
                  </div>
                  <div className="space-y-2">
                    {flaggedFields.map(f => (
                      <div key={f.name} className="flex items-center justify-between bg-white/60 px-3 py-2 rounded-lg border border-amber-100">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-700">{f.label}</span>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${f.status === "missing" ? "bg-red-100 text-red-700" : "bg-amber-200 text-amber-800"}`}>
                              {f.status === "missing" ? "Missing" : "Needs Review"}
                            </span>
                          </div>
                          <div className="text-sm font-medium mt-0.5 text-slate-900">{String(f.value)}</div>
                        </div>
                        <button
                          onClick={() => setManuallyReviewedFields(prev => new Set(prev).add(f.name))}
                          className="text-xs font-semibold bg-white text-slate-700 border border-slate-300 shadow-sm px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors"
                        >
                          Mark Reviewed
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-amber-700 mt-3 font-medium opacity-80 uppercase tracking-wide">
                    Edit missing/weak values in the form below, then mark them as reviewed here.
                  </p>
                </div>
              )}

              {proof.comment && (
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Original Upload Note</span>
                  <p className="text-sm text-slate-800 mt-1">{proof.comment}</p>
                </div>
              )}

              {proof.source === 'whatsapp' && (
                <div className="bg-[#25D366]/5 rounded-xl p-4 border border-[#25D366]/20 flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#25D366]/20 text-[#128C7E]">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" /></svg>
                  </div>
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wide text-[#128C7E]">Received via WhatsApp</span>
                    <p className="text-sm text-slate-800 font-medium">Sender: {proof.metadata?.whatsapp_sender || "Unknown Number"}</p>
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-base font-bold text-slate-900">Extracted Information</h3>
                <p className="text-xs text-slate-500 mt-0.5">Verify the fields match the document</p>
              </div>

              {!isEditing ? (
                // Display Form View Mode
                <div className="space-y-4 pt-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border bg-slate-50 p-3 col-span-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Party / Vendor</span>
                      <p className="text-lg font-bold text-slate-900 mt-0.5">{proof.extracted_party || "—"}</p>
                    </div>
                    <div className="rounded-xl border bg-emerald-50 border-emerald-100 p-3">
                      <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Amount (₹)</span>
                      <p className="text-lg font-bold text-emerald-900 mt-0.5">
                        {proof.extracted_amount != null ? `₹${proof.extracted_amount.toFixed(2)}` : "—"}
                      </p>
                    </div>
                    <div className="rounded-xl border bg-slate-50 p-3 col-span-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Project / Site</span>
                      <p className="text-sm font-semibold text-slate-900 mt-0.5">{proof.project_name || "—"}</p>
                    </div>
                    <div className="rounded-xl border bg-slate-50 p-3 flex flex-col justify-center">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Date</span>
                      <p className="text-sm font-semibold text-slate-900 mt-0.5">{proof.extracted_date || "—"}</p>
                    </div>
                    <div className="rounded-xl border bg-slate-50 p-3">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Category</span>
                      <p className="text-sm font-semibold text-slate-900 mt-0.5 capitalize">{proof.extracted_category || "—"}</p>
                    </div>
                    <div className="rounded-xl border bg-slate-50 p-3">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Type</span>
                      <p className="text-sm font-semibold text-slate-900 mt-0.5 capitalize">{proof.extracted_entry_type || "—"}</p>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button type="button" onClick={startEditing} className="flex-1 rounded-xl border border-slate-300 bg-white py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors">
                      Edit Extracted Metadata Fields
                    </button>
                    <button type="button" onClick={handleReExtract} disabled={extracting} className="rounded-xl border border-teal-300 bg-teal-50 px-4 py-2.5 text-xs font-semibold text-teal-800 hover:bg-teal-100 transition-colors disabled:opacity-50">
                      {extracting ? "Extracting..." : "Re-Extract with AI"}
                    </button>
                  </div>
                </div>
              ) : (
                // Display Edit Form Workspace Input Fields
                <div className="space-y-4 border-t pt-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Party / Vendor Name</label>
                    <input type="text" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-slate-100 outline-none" value={editParty} onChange={(e) => setEditParty(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Project / Site</label>
                    <input type="text" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-slate-100 outline-none" value={editProject} onChange={(e) => setEditProject(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Amount (₹)</label>
                    <input type="number" step="0.01" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-slate-100 outline-none" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Transaction Date</label>
                    <input type="date" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-slate-100 outline-none" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Category</label>
                      <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-slate-100 outline-none bg-white" value={editCategory} onChange={(e) => setEditCategory(e.target.value)}>
                        <option value="">-- Select --</option>
                        <option value="labour">Labour</option>
                        <option value="material">Material</option>
                        <option value="transport">Transport</option>
                        <option value="rent">Rent</option>
                        <option value="food">Food</option>
                        <option value="fuel">Fuel</option>
                        <option value="equipment">Equipment</option>
                        <option value="subcontract">Subcontract</option>
                        <option value="client_payment">Client Payment</option>
                        <option value="misc">Misc</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Type</label>
                      <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-slate-100 outline-none bg-white" value={editType} onChange={(e) => setEditType(e.target.value)}>
                        <option value="">-- Select --</option>
                        <option value="expense">Expense</option>
                        <option value="income">Income</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end pt-2">
                    <button type="button" onClick={() => setIsEditing(false)} disabled={saving} className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      Cancel
                    </button>
                    <button type="button" onClick={handleSaveExtracted} disabled={saving} className="rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
                      {saving ? "Saving Changes..." : "Save Fields"}
                    </button>
                  </div>
                </div>
              )}

              {proof.extracted_text && (
                <details className="group rounded-xl border border-slate-200 bg-slate-50 p-4 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="cursor-pointer text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center justify-between outline-none">
                    Full OCR Raw Extracted Text
                    <span className="group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <p className="mt-3 text-xs text-slate-600 leading-relaxed whitespace-pre-wrap border-t border-slate-200 pt-3">{proof.extracted_text}</p>
                </details>
              )}
            </div>

            {/* 3. Primary Actions & Danger Zone */}
            <div className="border-t border-slate-200 bg-slate-50 rounded-b-2xl p-6 space-y-8">
              {isQueueMode ? (
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Queue Actions</h3>
                  <p className="text-sm text-slate-600">Please review the extracted fields above. When correct, approve this to move it to your inbox.</p>
                  <div className="flex gap-4 flex-col sm:flex-row">
                    <button type="button" onClick={handleApproveQueue} disabled={markingReviewed || saving || deleting} className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50">
                      {markingReviewed ? "Approving..." : "Approve & Next →"}
                    </button>
                    <button type="button" onClick={handleSkipQueue} disabled={markingReviewed || saving || deleting} className="flex-1 rounded-xl border border-red-200 bg-white py-3 text-sm font-bold text-red-600 hover:bg-red-50 transition-colors shadow-sm disabled:opacity-50">
                      {deleting ? "Deleting..." : "Skip / Delete"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Next Step</h3>

                  {proof.linked_entry_id ? (
                    <>
                      <div className="flex gap-3">
                        <Link href={`/ledger?highlight=${proof.linked_entry_id}`} className="flex-1 text-center flex items-center justify-center rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700 transition-colors shadow-sm">
                          Go to Ledger Entry #{proof.linked_entry_id} →
                        </Link>
                        <button
                          type="button"
                          onClick={() => setShowUnlinkConfirm(true)}
                          disabled={unlinking}
                          className="rounded-xl border border-slate-300 bg-white text-slate-700 px-6 text-sm font-bold hover:bg-slate-100 disabled:opacity-50 transition-colors shadow-sm"
                        >
                          {unlinking ? "..." : "Unlink"}
                        </button>
                      </div>

                      {showUnlinkConfirm && (
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                          <p className="text-sm font-bold text-amber-900">Unlink this proof from the ledger draft?</p>
                          <p className="mt-1 text-sm text-amber-800">
                            This will safely remove the connection. The ledger draft will remain intact, but this proof can then be deleted or linked to something else.
                          </p>
                          <div className="mt-4 flex gap-2 justify-end">
                            <button type="button" onClick={() => setShowUnlinkConfirm(false)} disabled={unlinking} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200 bg-slate-100 border border-slate-300">
                              Cancel
                            </button>
                            <button type="button" onClick={handleUnlink} disabled={unlinking} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700">
                              {unlinking ? "Unlinking..." : "Yes, Unlink"}
                            </button>
                            <button type="button" onClick={handleDelete} disabled={deleting} className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
                              {deleting ? "Deleting..." : "Delete entirely"}
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="mb-6 p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isSplit}
                            onChange={e => setIsSplit(e.target.checked)}
                            className="w-5 h-5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                          />
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-slate-800">Mark as Split Expense</span>
                            <span className="text-xs text-slate-500 mt-0.5">You can split any expense type, not just labour/subcontract.</span>
                          </div>
                        </label>

                        {isSplit && (
                          <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
                            <div className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-200">
                              <div>
                                <span className="text-xs text-slate-500 font-semibold block">Total Payment</span>
                                <span className="text-sm font-bold text-slate-900">₹{proof.extracted_amount || 0}</span>
                              </div>
                              <div className="text-right">
                                <span className="text-xs text-slate-500 font-semibold block">Remaining to Allocate</span>
                                <span className={`text-sm font-bold ${((proof.extracted_amount || 0) - splitRows.reduce((acc, r) => acc + r.amount, 0)) === 0 ? "text-emerald-600" : "text-amber-600"}`}>
                                  ₹{(proof.extracted_amount || 0) - splitRows.reduce((acc, r) => acc + r.amount, 0)}
                                </span>
                              </div>
                            </div>

                            <div className="space-y-3">
                              {splitRows.map((row, index) => (
                                <div key={row.id} className="flex gap-2 items-start">
                                  <div className="flex-1 space-y-2">
                                    <input
                                      type="text" placeholder="Worker Name"
                                      className="w-full text-sm rounded border-slate-300 px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none"
                                      value={row.worker} onChange={e => {
                                        const newRows = [...splitRows];
                                        newRows[index].worker = e.target.value;
                                        setSplitRows(newRows);
                                      }}
                                    />
                                    <div className="flex gap-2">
                                      <input
                                        type="text" placeholder="Role (e.g., Mason)"
                                        className="w-1/2 text-sm rounded border-slate-300 px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none"
                                        value={row.role} onChange={e => {
                                          const newRows = [...splitRows];
                                          newRows[index].role = e.target.value;
                                          setSplitRows(newRows);
                                        }}
                                      />
                                      <input
                                        type="number" placeholder="Amount"
                                        className="w-1/2 text-sm rounded border-slate-300 px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none"
                                        value={row.amount || ""} onChange={e => {
                                          const newRows = [...splitRows];
                                          newRows[index].amount = parseFloat(e.target.value) || 0;
                                          setSplitRows(newRows);
                                        }}
                                      />
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => setSplitRows(splitRows.filter((_, i) => i !== index))}
                                    className="p-1.5 text-slate-400 hover:text-red-600"
                                    title="Remove row"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                            <button
                              onClick={() => setSplitRows([...splitRows, { id: `row_${Date.now()}`, worker: "", role: "", amount: 0, note: "" }])}
                              className="text-xs font-semibold text-teal-700 hover:text-teal-800"
                            >
                              + Add Worker
                            </button>
                          </div>
                        )}
                      </div>

                      <p className="text-xs text-slate-500 mb-2">Reviewed means checked by you. It does not create a ledger draft.</p>
                      <div className="flex gap-3">
                        {proof.processing_status !== "reviewed" && (
                          <button
                            type="button"
                            onClick={() => handleSetReviewStatus("reviewed")}
                            disabled={markingReviewed || draftLoading}
                            className="rounded-xl border border-slate-300 bg-white text-slate-700 px-6 py-3 text-sm font-bold hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
                          >
                            {markingReviewed ? "..." : "Mark as Reviewed"}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={handleCreateLedgerDraft}
                          disabled={draftLoading || !isReady || (isSplit && (proof.extracted_amount || 0) - splitRows.reduce((acc, r) => acc + r.amount, 0) !== 0)}
                          title={!isReady ? "Party, amount, and date must be filled" : (isSplit && (proof.extracted_amount || 0) - splitRows.reduce((acc, r) => acc + r.amount, 0) !== 0) ? "Allocated amounts must match total" : ""}
                          className="flex-1 rounded-xl bg-slate-900 py-3 text-base font-bold text-white hover:bg-slate-800 disabled:opacity-40 transition-opacity shadow-sm"
                        >
                          {draftLoading ? "Generating..." : "Create Ledger Draft Entry →"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Danger Zone */}
              <div className="pt-6 border-t border-slate-200">
                <div className="space-y-3">
                  <h3 className="text-[10px] font-bold text-red-600 uppercase tracking-widest">Danger Zone</h3>
                  <div className="flex items-center justify-between bg-white border border-red-200 rounded-xl p-4 shadow-sm">
                    <div>
                      <p className="text-sm font-bold text-slate-900">Delete this proof</p>
                      <p className="text-xs text-slate-500 mt-1">
                        {proof.linked_entry_id
                          ? "You must unlink this proof before you can delete it."
                          : "Permanently remove this file and its data. This cannot be undone."}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting || !!proof.linked_entry_id}
                      className="rounded-lg bg-red-600 text-white px-4 py-2 text-sm font-bold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                    >
                      {deleting ? "Deleting..." : "Delete Proof"}
                    </button>
                  </div>
                </div>
              </div>

              {/* Activity History */}
              {history.length > 0 && (
                <div className="pt-6 border-t border-slate-200">
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">Activity History</h3>
                  <div className="space-y-4">
                    {history.map((log: any) => (
                      <div key={log.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className="w-2 h-2 rounded-full bg-slate-300 mt-1.5" />
                          <div className="w-px h-full bg-slate-200 mt-1" />
                        </div>
                        <div className="pb-2">
                          <p className="text-sm font-semibold text-slate-800 capitalize">{log.action.replace("_", " ")}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{new Date(log.created_at).toLocaleString()}</p>
                          {log.details?.fields && (
                            <p className="text-xs text-slate-600 mt-1">
                              Fields: {log.details.fields.join(", ")}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}