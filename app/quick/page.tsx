"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import PublicHeader from "@/components/PublicHeader";
import {
  Upload,
  FileSpreadsheet,
  ListChecks,
  ArrowLeft,
  Info,
  Image as ImageIcon,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Trash2,
  Plus
} from "lucide-react";

export type QuickFileRow = {
  id: string;
  file: File;
  original_name: string;
  previewUrl: string | null;
  fileType: string;
  fileSize: number;
  status: "queued" | "extracting" | "ready" | "needs_review" | "failed";
  extracted_date?: string | null;
  extracted_party?: string | null;
  guessed_category?: string | null;
  extracted_amount?: number | null;
  extracted_utr?: string | null;
  guessed_type?: "income" | "expense" | null;
  extraction_confidence?: Record<string, string>;
  errorMessage?: string;
};

const MAX_BATCH_SIZE = 50;
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_CONCURRENT_WORKERS = 3;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp"
]);

export default function QuickPage() {
  const [files, setFiles] = useState<QuickFileRow[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [warningMessage, setWarningMessage] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Active object URL tracking for memory leak prevention
  const activeUrlsRef = useRef<Set<string>>(new Set());

  // Cleanup object URLs on component unmount
  useEffect(() => {
    const activeUrls = activeUrlsRef.current;
    return () => {
      activeUrls.forEach((url) => URL.revokeObjectURL(url));
      activeUrls.clear();
    };
  }, []);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  // Safe single-file extraction caller
  const processExtraction = useCallback(async (id: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/quick/extract", {
        method: "POST",
        body: formData
      });

      const data = await res.json();

      if (!res.ok) {
        setFiles((prev) =>
          prev.map((row) =>
            row.id === id
              ? {
                  ...row,
                  status: "failed",
                  errorMessage: data?.message || "Extraction failed"
                }
              : row
          )
        );
        return;
      }

      // Evaluate review status
      const missingCoreFields =
        !data.extracted_party ||
        data.extracted_amount == null ||
        !data.extracted_date;

      const hasLowConfidence = Object.values(
        data.extraction_confidence || {}
      ).some((val: any) => String(val).toLowerCase() === "low");

      const finalStatus: "ready" | "needs_review" =
        missingCoreFields || hasLowConfidence ? "needs_review" : "ready";

      setFiles((prev) =>
        prev.map((row) =>
          row.id === id
            ? {
                ...row,
                status: finalStatus,
                extracted_party: data.extracted_party ?? null,
                extracted_amount: data.extracted_amount ?? null,
                extracted_date: data.extracted_date ?? null,
                extracted_utr: data.extracted_utr ?? null,
                guessed_category: data.guessed_category ?? null,
                guessed_type: data.guessed_type ?? "expense",
                extraction_confidence: data.extraction_confidence ?? {}
              }
            : row
        )
      );
    } catch (err) {
      setFiles((prev) =>
        prev.map((row) =>
          row.id === id
            ? {
                ...row,
                status: "failed",
                errorMessage: "Network error during extraction"
              }
            : row
        )
      );
    }
  }, []);

  // Background Concurrency Queue Runner (3 Workers Max)
  useEffect(() => {
    const extractingCount = files.filter((f) => f.status === "extracting").length;
    const queuedRows = files.filter((f) => f.status === "queued");

    if (extractingCount < MAX_CONCURRENT_WORKERS && queuedRows.length > 0) {
      const availableSlots = MAX_CONCURRENT_WORKERS - extractingCount;
      const rowsToStart = queuedRows.slice(0, availableSlots);

      // Transition rows to 'extracting' immediately
      const startIds = new Set(rowsToStart.map((r) => r.id));
      setFiles((prev) =>
        prev.map((r) => (startIds.has(r.id) ? { ...r, status: "extracting" } : r))
      );

      // Trigger background fetches
      rowsToStart.forEach((row) => {
        processExtraction(row.id, row.file);
      });
    }
  }, [files, processExtraction]);

  const handleAddFiles = (incomingFiles: File[]) => {
    setWarningMessage("");

    if (incomingFiles.length === 0) return;

    const currentCount = files.length;
    let allowedList = incomingFiles;

    if (currentCount + incomingFiles.length > MAX_BATCH_SIZE) {
      const slotsRemaining = Math.max(0, MAX_BATCH_SIZE - currentCount);
      setWarningMessage(
        `Batch limit is 50 files maximum. Added first ${slotsRemaining} files.`
      );
      allowedList = incomingFiles.slice(0, slotsRemaining);
    }

    if (allowedList.length === 0) return;

    const newRows: QuickFileRow[] = allowedList.map((f) => {
      const fileId = crypto.randomUUID();
      const rawType = (f.type || "").toLowerCase();

      // Check size limit
      if (f.size > MAX_FILE_SIZE_BYTES) {
        return {
          id: fileId,
          file: f,
          original_name: f.name,
          previewUrl: null,
          fileType: f.type,
          fileSize: f.size,
          status: "failed",
          errorMessage: `File too large (max ${MAX_FILE_SIZE_MB}MB)`
        };
      }

      // Check format
      if (rawType === "application/pdf") {
        return {
          id: fileId,
          file: f,
          original_name: f.name,
          previewUrl: null,
          fileType: f.type,
          fileSize: f.size,
          status: "failed",
          errorMessage: "PDF extraction deferred — please upload JPG, PNG, or WEBP images"
        };
      }

      if (rawType === "image/heic" || rawType === "image/heif") {
        return {
          id: fileId,
          file: f,
          original_name: f.name,
          previewUrl: null,
          fileType: f.type,
          fileSize: f.size,
          status: "failed",
          errorMessage: "HEIC format not supported — use JPG, PNG, or WEBP"
        };
      }

      if (!ALLOWED_IMAGE_TYPES.has(rawType)) {
        return {
          id: fileId,
          file: f,
          original_name: f.name,
          previewUrl: null,
          fileType: f.type,
          fileSize: f.size,
          status: "failed",
          errorMessage: "Unsupported format (JPG/PNG/WEBP only)"
        };
      }

      // Valid image file
      const previewUrl = URL.createObjectURL(f);
      activeUrlsRef.current.add(previewUrl);

      return {
        id: fileId,
        file: f,
        original_name: f.name,
        previewUrl,
        fileType: f.type,
        fileSize: f.size,
        status: "queued"
      };
    });

    setFiles((prev) => [...prev, ...newRows]);
  };

  const handleRemoveFile = (id: string, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();

    setFiles((prev) => {
      const target = prev.find((r) => r.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
        activeUrlsRef.current.delete(target.previewUrl);
      }
      return prev.filter((r) => r.id !== id);
    });
  };

  const handleClearAll = () => {
    files.forEach((row) => {
      if (row.previewUrl) {
        URL.revokeObjectURL(row.previewUrl);
      }
    });
    activeUrlsRef.current.clear();
    setFiles([]);
    setWarningMessage("");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleAddFiles(Array.from(e.dataTransfer.files));
    }
  };

  const counts = {
    total: files.length,
    queued: files.filter((f) => f.status === "queued").length,
    extracting: files.filter((f) => f.status === "extracting").length,
    ready: files.filter((f) => f.status === "ready").length,
    needs_review: files.filter((f) => f.status === "needs_review").length,
    failed: files.filter((f) => f.status === "failed").length
  };

  const steps = [
    { number: 1, title: "Add screenshots", icon: Upload, current: true, description: "Upload payment proofs" },
    { number: 2, title: "Review extracted entries", icon: ListChecks, current: false, description: "Verify amounts & dates" },
    { number: 3, title: "Generate Excel", icon: FileSpreadsheet, current: false, description: "Download clean spreadsheet" }
  ];

  return (
    <div className="min-h-screen flex flex-col theme-page">
      <PublicHeader />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-8 py-6 md:py-10 flex flex-col gap-6">
        
        {/* Header Breadcrumb & Title */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-muted)] transition-colors"
              title="Back to Homepage"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl md:text-2xl font-bold text-[var(--foreground)] tracking-tight">
                  Quick Mode
                </h1>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)]">
                  Session Workspace
                </span>
              </div>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Batch payment screenshot processing for fast Excel export
              </p>
            </div>
          </div>

          {files.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              className="text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-500/20 transition-colors flex items-center gap-1.5 shrink-0 self-start sm:self-auto"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear Workspace
            </button>
          )}
        </div>

        {/* Session-only Workspace Notice */}
        <div className="rounded-xl bg-[var(--card-muted)] border border-[var(--border)] p-4 flex items-start gap-3">
          <Info className="w-4 h-4 text-[var(--primary)] shrink-0 mt-0.5" />
          <div className="text-xs text-[var(--muted)] leading-relaxed">
            <strong className="text-[var(--foreground)]">Session-Only Workspace:</strong> Quick Mode operates entirely in browser client memory to parse payment screenshots into a consolidated table. Proofs are not uploaded to Supabase Storage or saved to permanent database ledgers.
          </div>
        </div>

        {/* 3-Step Process Indicator */}
        <div className="surface-panel p-4 md:p-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 relative">
            {steps.map((s) => (
              <div
                key={s.number}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                  s.current
                    ? "bg-[var(--card-elevated)] border-[var(--primary)] shadow-sm"
                    : "bg-[var(--card-muted)] border-transparent opacity-75"
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                    s.current
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "bg-[var(--card)] text-[var(--muted)] border border-[var(--border)]"
                  }`}
                >
                  {s.number}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className={`text-xs font-bold truncate ${s.current ? "text-[var(--foreground)]" : "text-[var(--muted)]"}`}>
                    {s.title}
                  </span>
                  <span className="text-[10px] text-[var(--muted)] truncate">{s.description}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Warning Toast */}
        {warningMessage && (
          <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3 text-xs text-amber-800 dark:text-amber-400 font-medium flex items-center justify-between">
            <span>{warningMessage}</span>
            <button
              type="button"
              onClick={() => setWarningMessage("")}
              className="text-xs text-amber-800 dark:text-amber-400 font-bold ml-2"
            >
              ✕
            </button>
          </div>
        )}

        {/* Drop Zone Area */}
        <div
          className={`surface-panel p-6 md:p-8 flex flex-col items-center justify-center text-center transition-all ${
            dragActive
              ? "border-2 border-dashed border-[var(--primary)] bg-[var(--primary)]/5"
              : "border border-[var(--border)]"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragActive(false);
          }}
          onDrop={handleDrop}
        >
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/jpg"
            className="sr-only"
            ref={fileInputRef}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleAddFiles(Array.from(e.target.files));
              }
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          />

          {files.length === 0 ? (
            <div className="py-4 flex flex-col items-center">
              <div className="w-14 h-14 rounded-2xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center mb-4">
                <ImageIcon className="w-7 h-7" />
              </div>
              <h3 className="text-lg font-bold text-[var(--foreground)] mb-1">
                Add payment screenshots
              </h3>
              <p className="text-xs text-[var(--muted)] max-w-md mb-5 leading-relaxed">
                Drag & drop UPI payment screenshots, bank transfer slips, or receipt images here. Background extraction starts instantly upon selection.
              </p>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn-theme-accent text-xs md:text-sm px-5 py-2.5 rounded-xl font-semibold opacity-90 hover:opacity-100 transition-all flex items-center gap-2 cursor-pointer shadow-sm"
              >
                <Upload className="w-4 h-4" />
                <span>Select Screenshots</span>
              </button>

              <p className="text-[11px] text-[var(--muted)] mt-4">
                Up to 50 screenshots per batch • Max 10MB per file • JPG, PNG, WEBP supported
              </p>
            </div>
          ) : (
            <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-4 p-2">
              <div className="text-left">
                <h4 className="text-sm font-bold text-[var(--foreground)]">
                  Quick Mode Workbench ({counts.total} {counts.total === 1 ? "File" : "Files"})
                </h4>
                <p className="text-xs text-[var(--muted)]">
                  Background extraction active • Up to 3 files processing in parallel
                </p>
              </div>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn-theme-accent text-xs px-4 py-2 rounded-lg font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add More Screenshots</span>
              </button>
            </div>
          )}
        </div>

        {/* Workbench Counter Summary Bar */}
        {files.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="surface-panel p-3 rounded-xl flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">Total</span>
              <span className="text-lg font-extrabold text-[var(--foreground)] mt-0.5">{counts.total}</span>
            </div>

            <div className="surface-panel p-3 rounded-xl flex flex-col border-l-4 border-l-blue-500">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-1">
                {(counts.queued > 0 || counts.extracting > 0) && <Loader2 className="w-3 h-3 animate-spin" />}
                Processing
              </span>
              <span className="text-lg font-extrabold text-[var(--foreground)] mt-0.5">
                {counts.queued + counts.extracting}
              </span>
            </div>

            <div className="surface-panel p-3 rounded-xl flex flex-col border-l-4 border-l-emerald-500">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                Ready
              </span>
              <span className="text-lg font-extrabold text-emerald-700 dark:text-emerald-400 mt-0.5">
                {counts.ready}
              </span>
            </div>

            <div className="surface-panel p-3 rounded-xl flex flex-col border-l-4 border-l-amber-500">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Needs Review
              </span>
              <span className="text-lg font-extrabold text-amber-700 dark:text-amber-400 mt-0.5">
                {counts.needs_review}
              </span>
            </div>

            <div className="surface-panel p-3 rounded-xl flex flex-col border-l-4 border-l-red-500 col-span-2 sm:col-span-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400 flex items-center gap-1">
                <XCircle className="w-3 h-3" />
                Failed
              </span>
              <span className="text-lg font-extrabold text-red-700 dark:text-red-400 mt-0.5">
                {counts.failed}
              </span>
            </div>
          </div>
        )}

        {/* Workbench Table */}
        {files.length > 0 && (
          <div className="surface-panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--card-muted)] text-[var(--muted)] uppercase font-semibold text-[10px] tracking-wider">
                    <th className="py-3 px-4 w-12">Preview</th>
                    <th className="py-3 px-4">File Info</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Party / Payee</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                    <th className="py-3 px-4">UTR / Account</th>
                    <th className="py-3 px-4 text-center w-10">Remove</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {files.map((row) => (
                    <tr
                      key={row.id}
                      className="hover:bg-[var(--card-muted)]/50 transition-colors group"
                    >
                      {/* Preview Thumbnail */}
                      <td className="py-3 px-4 align-middle">
                        {row.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={row.previewUrl}
                            alt="preview"
                            className="w-10 h-10 object-cover rounded-lg bg-[var(--card-muted)] border border-[var(--border)] shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-[var(--card-muted)] border border-[var(--border)] flex items-center justify-center font-bold text-[9px] text-[var(--muted)] shrink-0">
                            FILE
                          </div>
                        )}
                      </td>

                      {/* File Name & Size */}
                      <td className="py-3 px-4 align-middle max-w-[160px] truncate">
                        <div className="font-semibold text-[var(--foreground)] truncate" title={row.original_name}>
                          {row.original_name}
                        </div>
                        <div className="text-[10px] text-[var(--muted)]">
                          {formatFileSize(row.fileSize)}
                        </div>
                      </td>

                      {/* Per-File Status Badge */}
                      <td className="py-3 px-4 align-middle whitespace-nowrap">
                        {row.status === "queued" && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                            Queued
                          </span>
                        )}

                        {row.status === "extracting" && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20">
                            <Loader2 className="w-3 h-3 animate-spin text-blue-600 dark:text-blue-400" />
                            Extracting...
                          </span>
                        )}

                        {row.status === "ready" && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                            Ready
                          </span>
                        )}

                        {row.status === "needs_review" && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20" title="Missing required fields or low confidence">
                            <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                            Needs Review
                          </span>
                        )}

                        {row.status === "failed" && (
                          <div className="flex flex-col">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-50 text-red-700 border border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20 w-fit">
                              <XCircle className="w-3 h-3 text-red-600 dark:text-red-400" />
                              Failed
                            </span>
                            {row.errorMessage && (
                              <span className="text-[10px] text-red-600 dark:text-red-400 mt-0.5 truncate max-w-[160px]" title={row.errorMessage}>
                                {row.errorMessage}
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Date */}
                      <td className="py-3 px-4 align-middle whitespace-nowrap text-[var(--foreground)]">
                        {row.extracted_date ? (
                          <span className="font-mono text-xs">{row.extracted_date}</span>
                        ) : (
                          <span className="text-[var(--muted)]">—</span>
                        )}
                      </td>

                      {/* Party */}
                      <td className="py-3 px-4 align-middle font-medium text-[var(--foreground)] max-w-[140px] truncate">
                        {row.extracted_party ? (
                          <span title={row.extracted_party}>{row.extracted_party}</span>
                        ) : (
                          <span className="text-[var(--muted)] italic">Unspecified</span>
                        )}
                      </td>

                      {/* Category */}
                      <td className="py-3 px-4 align-middle text-[var(--foreground)]">
                        {row.guessed_category ? (
                          <span className="px-2 py-0.5 rounded bg-[var(--card)] border border-[var(--border)] text-[10px] font-medium text-[var(--muted)]">
                            {row.guessed_category}
                          </span>
                        ) : (
                          <span className="text-[var(--muted)]">—</span>
                        )}
                      </td>

                      {/* Amount */}
                      <td className="py-3 px-4 align-middle text-right font-semibold text-[var(--foreground)] whitespace-nowrap">
                        {row.extracted_amount != null ? (
                          <span className="font-mono">
                            ₹{row.extracted_amount.toLocaleString("en-IN")}
                          </span>
                        ) : (
                          <span className="text-[var(--muted)]">—</span>
                        )}
                      </td>

                      {/* UTR / Account */}
                      <td className="py-3 px-4 align-middle font-mono text-[11px] text-[var(--muted)] max-w-[130px] truncate">
                        {row.extracted_utr ? (
                          <span title={row.extracted_utr}>{row.extracted_utr}</span>
                        ) : (
                          <span>—</span>
                        )}
                      </td>

                      {/* Remove Button */}
                      <td className="py-3 px-4 align-middle text-center">
                        <button
                          type="button"
                          onClick={(e) => handleRemoveFile(row.id, e)}
                          className="p-1 rounded text-[var(--muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                          title="Remove file"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
