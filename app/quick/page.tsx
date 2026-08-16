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
  Plus,
  Lock,
  Sparkles,
  ShieldCheck,
  ChevronDown,
  Terminal,
  RefreshCw
} from "lucide-react";
import { TesseractPool, runClientOcr, OcrDiagnostics } from "@/lib/ocr";
import { downloadQuickExcel } from "@/lib/excel";

export type QuickApiErrorResponse = {
  ok: false;
  stage: "ocr" | "stage2";
  code: string;
  message: string;
  httpStatus?: number;
  retryable?: boolean;
};

export type QuickFileRow = {
  id: string;
  file: File; // Retained original File object in memory
  original_name: string;
  previewUrl: string | null;
  fileType: string;
  fileSize: number;

  // Stage 1: Browser OCR State
  ocrStatus: "idle" | "processing" | "completed" | "failed";
  ocrHasText?: boolean;
  ocrRoughAmount?: number | null;
  ocrDetectedDate?: string | null;
  ocrErrorMessage?: string;
  diagnostics?: OcrDiagnostics;

  // Stage 2: AI Extraction State
  extractStatus: "queued" | "extracting" | "ready" | "needs_review" | "failed";
  extracted_date?: string | null;
  extracted_party?: string | null;
  guessed_category?: string | null;
  extracted_amount?: number | null;
  extracted_utr?: string | null;
  guessed_type?: "income" | "expense" | null;
  extraction_confidence?: Record<string, string>;
  extractErrorMessage?: string;
  errorDetail?: QuickApiErrorResponse;
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
  const [stage, setStage] = useState<"stage1_ocr" | "stage1_complete" | "stage2_extracting" | "stage2_complete">("stage1_ocr");
  const [stage2Error, setStage2Error] = useState<string>("");
  const [expandedDiagnostics, setExpandedDiagnostics] = useState<Record<string, boolean>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeUrlsRef = useRef<Set<string>>(new Set());
  const ocrPoolRef = useRef<TesseractPool | null>(null);

  const isDev = process.env.NODE_ENV === "development";

  // Lazy pool getter
  const getOcrPool = () => {
    if (!ocrPoolRef.current) {
      ocrPoolRef.current = new TesseractPool();
    }
    return ocrPoolRef.current;
  };

  // Terminate workers on unmount & cleanup preview URLs
  useEffect(() => {
    const activeUrls = activeUrlsRef.current;
    return () => {
      if (ocrPoolRef.current) {
        ocrPoolRef.current.terminateAll();
        ocrPoolRef.current = null;
      }
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

  const toggleDiagnostics = (id: string) => {
    setExpandedDiagnostics((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // ----------------------------------------------------
  // Stage 1: Browser Tesseract Queue (Max 3 Workers)
  // ----------------------------------------------------
  useEffect(() => {
    const idleRows = files.filter((f) => f.ocrStatus === "idle");
    const processingCount = files.filter((f) => f.ocrStatus === "processing").length;

    if (processingCount < MAX_CONCURRENT_WORKERS && idleRows.length > 0) {
      const slots = MAX_CONCURRENT_WORKERS - processingCount;
      const batchToStart = idleRows.slice(0, slots);
      const startIds = new Set(batchToStart.map((r) => r.id));

      setFiles((prev) =>
        prev.map((r) => (startIds.has(r.id) ? { ...r, ocrStatus: "processing" } : r))
      );

      const pool = getOcrPool();

      batchToStart.forEach(async (row) => {
        const res = await runClientOcr(pool, row.file);
        setFiles((prev) =>
          prev.map((r) => {
            if (r.id !== row.id) return r;
            if (res.success) {
              return {
                ...r,
                ocrStatus: "completed",
                ocrHasText: res.hasText,
                ocrRoughAmount: res.roughAmount,
                ocrDetectedDate: res.detectedDate,
                diagnostics: res.diagnostics
              };
            } else {
              return {
                ...r,
                ocrStatus: "failed",
                ocrErrorMessage: res.error || "OCR failed",
                diagnostics: res.diagnostics,
                errorDetail: {
                  ok: false,
                  stage: "ocr",
                  code: "OCR_EXECUTION_FAILED",
                  message: res.error || "OCR failed to process image text.",
                  retryable: true
                }
              };
            }
          })
        );
      });
    }
  }, [files]);

  // Check Stage 1 Queue Completion -> terminate workers
  useEffect(() => {
    if (files.length === 0) return;
    const isStage1Finished = files.every(
      (f) => f.ocrStatus === "completed" || f.ocrStatus === "failed"
    );

    if (isStage1Finished) {
      if (ocrPoolRef.current) {
        ocrPoolRef.current.terminateAll();
        ocrPoolRef.current = null;
      }
      if (stage === "stage1_ocr") {
        setStage("stage1_complete");
      }
    }
  }, [files, stage]);

  // ----------------------------------------------------
  // Stage 2: Gemini Full Extraction Handler & Queue
  // ----------------------------------------------------
  const processStage2Extraction = useCallback(async (id: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    if (isDev) {
      console.log("[QuickMode Stage2 Client Dispatch]", {
        id,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        hasFileInFormData: formData.has("file")
      });
    }

    try {
      const res = await fetch("/api/quick/extract", {
        method: "POST",
        body: formData
      });

      const data = await res.json();

      if (isDev) {
        console.log("[QuickMode Stage2 Client Response]", {
          id,
          fileName: file.name,
          httpStatus: res.status,
          responseBody: data
        });
      }

      if (!res.ok || !data.ok) {
        if (res.status === 402) {
          setStage2Error("Payment required to unlock full extraction.");
        }
        
        const errDetail: QuickApiErrorResponse = {
          ok: false,
          stage: "stage2",
          code: data?.code || "EXTRACTION_FAILED",
          message: data?.message || "Extraction failed for this file",
          httpStatus: res.status,
          retryable: data?.retryable ?? true
        };

        setFiles((prev) =>
          prev.map((row) =>
            row.id === id
              ? {
                  ...row,
                  extractStatus: "failed",
                  extractErrorMessage: errDetail.message,
                  errorDetail: errDetail
                }
              : row
          )
        );
        return;
      }

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
                extractStatus: finalStatus,
                extracted_party: data.extracted_party ?? null,
                extracted_amount: data.extracted_amount ?? null,
                extracted_date: data.extracted_date ?? null,
                extracted_utr: data.extracted_utr ?? null,
                guessed_category: data.guessed_category ?? null,
                guessed_type: data.guessed_type ?? "expense",
                extraction_confidence: data.extraction_confidence ?? {},
                errorDetail: undefined
              }
            : row
        )
      );
    } catch (err: any) {
      const errDetail: QuickApiErrorResponse = {
        ok: false,
        stage: "stage2",
        code: "NETWORK_ERROR",
        message: err?.message || "Network error during extraction",
        httpStatus: 0,
        retryable: true
      };

      setFiles((prev) =>
        prev.map((row) =>
          row.id === id
            ? {
                ...row,
                extractStatus: "failed",
                extractErrorMessage: errDetail.message,
                errorDetail: errDetail
              }
            : row
        )
      );
    }
  }, [isDev]);

  // Stage 2 Queue Runner (Max 3 Workers)
  useEffect(() => {
    if (stage !== "stage2_extracting") return;

    const extractingCount = files.filter((f) => f.extractStatus === "extracting").length;
    const queuedRows = files.filter((f) => f.extractStatus === "queued");

    if (extractingCount < MAX_CONCURRENT_WORKERS && queuedRows.length > 0) {
      const availableSlots = MAX_CONCURRENT_WORKERS - extractingCount;
      const rowsToStart = queuedRows.slice(0, availableSlots);

      const startIds = new Set(rowsToStart.map((r) => r.id));
      setFiles((prev) =>
        prev.map((r) => (startIds.has(r.id) ? { ...r, extractStatus: "extracting" } : r))
      );

      rowsToStart.forEach((row) => {
        processStage2Extraction(row.id, row.file);
      });
    }

    if (files.length > 0 && files.every((f) => f.extractStatus === "ready" || f.extractStatus === "needs_review" || f.extractStatus === "failed")) {
      setStage("stage2_complete");
    }
  }, [files, stage, processStage2Extraction]);

  const handleStartStage2 = () => {
    setStage2Error("");
    setStage("stage2_extracting");
    setFiles((prev) =>
      prev.map((r) => (r.ocrStatus === "completed" ? { ...r, extractStatus: "queued" } : r))
    );
  };

  const handleRetryRow = (id: string) => {
    setFiles((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        if (r.ocrStatus === "failed") {
          return { ...r, ocrStatus: "idle", ocrErrorMessage: undefined, errorDetail: undefined };
        }
        return { ...r, extractStatus: "queued", extractErrorMessage: undefined, errorDetail: undefined };
      })
    );
    if (stage === "stage2_complete") {
      setStage("stage2_extracting");
    }
  };

  // ----------------------------------------------------
  // File Add / Remove / Clear Handlers
  // ----------------------------------------------------
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

      if (f.size > MAX_FILE_SIZE_BYTES) {
        return {
          id: fileId,
          file: f,
          original_name: f.name,
          previewUrl: null,
          fileType: f.type,
          fileSize: f.size,
          ocrStatus: "failed",
          ocrErrorMessage: `File too large (max ${MAX_FILE_SIZE_MB}MB)`,
          extractStatus: "failed",
          errorDetail: {
            ok: false,
            stage: "ocr",
            code: "FILE_TOO_LARGE",
            message: `File exceeds maximum allowed size of ${MAX_FILE_SIZE_MB}MB.`,
            retryable: false
          }
        };
      }

      if (rawType === "application/pdf") {
        return {
          id: fileId,
          file: f,
          original_name: f.name,
          previewUrl: null,
          fileType: f.type,
          fileSize: f.size,
          ocrStatus: "failed",
          ocrErrorMessage: "PDF extraction deferred — please upload JPG, PNG, or WEBP images",
          extractStatus: "failed",
          errorDetail: {
            ok: false,
            stage: "ocr",
            code: "UNSUPPORTED_PDF",
            message: "PDF format deferred — upload JPG, PNG, or WEBP images.",
            retryable: false
          }
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
          ocrStatus: "failed",
          ocrErrorMessage: "HEIC format not supported — use JPG, PNG, or WEBP",
          extractStatus: "failed",
          errorDetail: {
            ok: false,
            stage: "ocr",
            code: "UNSUPPORTED_HEIC",
            message: "HEIC format not supported — convert to JPG, PNG, or WEBP.",
            retryable: false
          }
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
          ocrStatus: "failed",
          ocrErrorMessage: "Unsupported format (JPG/PNG/WEBP only)",
          extractStatus: "failed",
          errorDetail: {
            ok: false,
            stage: "ocr",
            code: "UNSUPPORTED_MIME",
            message: "Unsupported file format (JPG, PNG, WEBP supported).",
            retryable: false
          }
        };
      }

      const previewUrl = URL.createObjectURL(f);
      activeUrlsRef.current.add(previewUrl);

      return {
        id: fileId,
        file: f, // Preserves original File reference
        original_name: f.name,
        previewUrl,
        fileType: f.type,
        fileSize: f.size,
        ocrStatus: "idle",
        extractStatus: "queued"
      };
    });

    setFiles((prev) => [...prev, ...newRows]);
    if (stage === "stage1_complete") {
      setStage("stage1_ocr");
    }
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
    if (ocrPoolRef.current) {
      ocrPoolRef.current.terminateAll();
      ocrPoolRef.current = null;
    }
    files.forEach((row) => {
      if (row.previewUrl) {
        URL.revokeObjectURL(row.previewUrl);
      }
    });
    activeUrlsRef.current.clear();
    setFiles([]);
    setWarningMessage("");
    setStage2Error("");
    setStage("stage1_ocr");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleAddFiles(Array.from(e.dataTransfer.files));
    }
  };

  // ----------------------------------------------------
  // Aggregate Stage 1 Metrics & Counts
  // ----------------------------------------------------
  const filesReadCount = files.filter((f) => f.ocrStatus === "completed").length;
  const approxTransactionsDetected = files.filter((f) => f.ocrStatus === "completed" && f.ocrHasText).length;

  const validDates = files
    .map((f) => f.ocrDetectedDate)
    .filter((d): d is string => Boolean(d))
    .sort();

  let dateRangeLabel = "Detected";
  if (validDates.length === 1) {
    dateRangeLabel = validDates[0];
  } else if (validDates.length > 1) {
    dateRangeLabel = `${validDates[0]} – ${validDates[validDates.length - 1]}`;
  }

  const validAmounts = files
    .map((f) => f.ocrRoughAmount)
    .filter((a): a is number => a != null && !isNaN(a));

  const roughTotalSum = validAmounts.length > 0 ? validAmounts.reduce((acc, v) => acc + v, 0) : null;

  const counts = {
    total: files.length,
    ocrProcessing: files.filter((f) => f.ocrStatus === "processing" || f.ocrStatus === "idle").length,
    ocrCompleted: files.filter((f) => f.ocrStatus === "completed").length,
    extracting: files.filter((f) => f.extractStatus === "extracting").length,
    ready: files.filter((f) => f.extractStatus === "ready").length,
    needs_review: files.filter((f) => f.extractStatus === "needs_review").length,
    failed: files.filter((f) => f.ocrStatus === "failed" || f.extractStatus === "failed").length
  };

  const steps = [
    { number: 1, title: "Client OCR Scan", icon: Upload, current: stage === "stage1_ocr" || stage === "stage1_complete", description: "Free browser-side text read" },
    { number: 2, title: "Full AI Extraction", icon: ListChecks, current: stage === "stage2_extracting", description: "Payment-gated Gemini Vision" },
    { number: 3, title: "Export Excel", icon: FileSpreadsheet, current: stage === "stage2_complete", description: "Download verified spreadsheet" }
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
                {isDev && (
                  <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400">
                    DEV DIAGNOSTICS ACTIVE
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Two-stage payment screenshot processing for fast Excel export
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
            <strong className="text-[var(--foreground)]">Session-Only & Free Stage 1 OCR:</strong> Quick Mode operates entirely in browser client memory to verify payment screenshots. Files are not uploaded to Supabase Storage or saved to permanent database ledgers.
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

        {/* Warnings & Errors */}
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

        {stage2Error && (
          <div className="rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 text-xs text-red-800 dark:text-red-400 font-medium flex items-center justify-between">
            <span>{stage2Error}</span>
            <button
              type="button"
              onClick={() => setStage2Error("")}
              className="text-xs text-red-800 dark:text-red-400 font-bold ml-2"
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
                Drag & drop UPI payment screenshots or receipt images. Browser-side free OCR starts instantly upon selection.
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
                <h4 className="text-sm font-bold text-[var(--foreground)] flex items-center gap-2">
                  <span>Quick Mode Workbench ({counts.total} {counts.total === 1 ? "File" : "Files"})</span>
                  {stage === "stage1_ocr" && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Client OCR Scanning...
                    </span>
                  )}
                  {stage === "stage1_complete" && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      Stage 1 Complete (Locked)
                    </span>
                  )}
                  {stage === "stage2_extracting" && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Full AI Extraction...
                    </span>
                  )}
                  {stage === "stage2_complete" && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Stage 2 Unlocked
                    </span>
                  )}
                </h4>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  Browser Tesseract OCR worker pool active (up to 3 workers parallel)
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

        {/* Stage 1 Summary Banner (Client-side Rough OCR Estimates) */}
        {files.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="surface-panel p-3.5 rounded-xl flex flex-col border-l-4 border-l-blue-500">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] flex items-center justify-between">
                <span>Files Read</span>
                <span className="text-[9px] bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded font-mono">Session-only</span>
              </span>
              <span className="text-lg font-extrabold text-[var(--foreground)] mt-1">
                {filesReadCount} <span className="text-xs font-normal text-[var(--muted)]">/ {counts.total}</span>
              </span>
            </div>

            <div className="surface-panel p-3.5 rounded-xl flex flex-col border-l-4 border-l-indigo-500">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] flex items-center justify-between">
                <span>Approx. transactions detected</span>
                <span className="text-[9px] bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded font-mono">OCR estimate</span>
              </span>
              <span className="text-lg font-extrabold text-[var(--foreground)] mt-1">
                {approxTransactionsDetected}
              </span>
            </div>

            <div className="surface-panel p-3.5 rounded-xl flex flex-col border-l-4 border-l-teal-500">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] flex items-center justify-between">
                <span>Approx. Date Range</span>
                <span className="text-[9px] bg-teal-50 dark:bg-teal-500/10 text-teal-600 dark:text-teal-400 px-1.5 py-0.5 rounded font-mono">Detected</span>
              </span>
              <span className="text-sm font-extrabold text-[var(--foreground)] mt-1.5 truncate" title={dateRangeLabel}>
                {dateRangeLabel}
              </span>
            </div>

            <div className="surface-panel p-3.5 rounded-xl flex flex-col border-l-4 border-l-purple-500">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] flex items-center justify-between">
                <span>Estimated Total</span>
                <span className="text-[9px] bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded font-mono">OCR estimate</span>
              </span>
              <span className="text-lg font-extrabold text-[var(--foreground)] mt-1">
                {roughTotalSum != null ? (
                  <span className="font-mono">₹{roughTotalSum.toLocaleString("en-IN")}</span>
                ) : (
                  <span className="text-xs font-semibold text-[var(--muted)] italic">Estimate unavailable</span>
                )}
              </span>
            </div>
          </div>
        )}

        {/* Workbench Table */}
        {files.length > 0 && (
          <div className="surface-panel overflow-hidden relative">
            
            {/* Locked Preview Overlay for Stage 1 */}
            {stage !== "stage2_complete" && stage !== "stage2_extracting" && (
              <div className="p-6 bg-[var(--card)]/90 backdrop-blur-md border-b border-[var(--border)] flex flex-col items-center justify-center text-center z-10">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-3">
                  <Lock className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-[var(--foreground)] mb-1">
                  Stage 1 OCR Scan Complete
                </h3>
                <p className="text-xs text-[var(--muted)] max-w-lg mb-4 leading-relaxed">
                  Uploaded files were successfully read in your browser. Full editable ledger rows, exact transaction amounts, payee names, UTR numbers, and Excel export require payment.
                </p>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleStartStage2}
                    className="btn-theme-accent text-xs md:text-sm px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 cursor-pointer shadow-md"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Continue to Full Extraction</span>
                    <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-black/20 text-white">
                      Dev Bypass Active
                    </span>
                  </button>
                </div>
              </div>
            )}

            <div className={`overflow-x-auto ${stage !== "stage2_complete" ? "opacity-40 select-none blur-[1px]" : ""}`}>
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
                      className="hover:bg-[var(--card-muted)]/50 transition-colors group flex-col"
                    >
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

                        {/* Dev Diagnostics Toggle Button */}
                        {isDev && row.diagnostics && (
                          <button
                            type="button"
                            onClick={() => toggleDiagnostics(row.id)}
                            className="text-[9px] font-mono text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1 mt-1"
                          >
                            <Terminal className="w-3 h-3" />
                            <span>{expandedDiagnostics[row.id] ? "Hide Diagnostics" : "Inspect Diagnostics"}</span>
                            <ChevronDown className={`w-3 h-3 transition-transform ${expandedDiagnostics[row.id] ? "rotate-180" : ""}`} />
                          </button>
                        )}
                      </td>

                      {/* Per-File Status Badge */}
                      <td className="py-3 px-4 align-middle whitespace-nowrap">
                        {stage !== "stage2_complete" && stage !== "stage2_extracting" ? (
                          row.ocrStatus === "processing" ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20">
                              <Loader2 className="w-3 h-3 animate-spin text-blue-600 dark:text-blue-400" />
                              OCR Reading...
                            </span>
                          ) : row.ocrStatus === "completed" ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-teal-50 text-teal-700 border border-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/20">
                              <ShieldCheck className="w-3 h-3 text-teal-600 dark:text-teal-400" />
                              OCR Verified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-50 text-red-700 border border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20">
                              <XCircle className="w-3 h-3 text-red-600 dark:text-red-400" />
                              OCR Failed
                            </span>
                          )
                        ) : (
                          <>
                            {row.extractStatus === "queued" && (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/20">
                                Queued
                              </span>
                            )}

                            {row.extractStatus === "extracting" && (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20">
                                <Loader2 className="w-3 h-3 animate-spin text-purple-600 dark:text-purple-400" />
                                Extracting...
                              </span>
                            )}

                            {row.extractStatus === "ready" && (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                Ready
                              </span>
                            )}

                            {row.extractStatus === "needs_review" && (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20">
                                <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                Needs Review
                              </span>
                            )}

                            {row.extractStatus === "failed" && (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-50 text-red-700 border border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20">
                                <XCircle className="w-3 h-3 text-red-600 dark:text-red-400" />
                                Failed
                              </span>
                            )}
                          </>
                        )}
                      </td>

                      {/* Date */}
                      <td className="py-3 px-4 align-middle whitespace-nowrap text-[var(--foreground)]">
                        {stage === "stage2_complete" ? (
                          row.extracted_date ? (
                            <span className="font-mono text-xs">{row.extracted_date}</span>
                          ) : (
                            <span className="text-[var(--muted)]">—</span>
                          )
                        ) : (
                          <span className="font-mono text-xs text-[var(--muted)]">••••-••-••</span>
                        )}
                      </td>

                      {/* Party */}
                      <td className="py-3 px-4 align-middle font-medium text-[var(--foreground)] max-w-[140px] truncate">
                        {stage === "stage2_complete" ? (
                          row.extracted_party ? (
                            <span title={row.extracted_party}>{row.extracted_party}</span>
                          ) : (
                            <span className="text-[var(--muted)] italic">Unspecified</span>
                          )
                        ) : (
                          <span className="text-[var(--muted)] font-mono">••••••••••••</span>
                        )}
                      </td>

                      {/* Category */}
                      <td className="py-3 px-4 align-middle text-[var(--foreground)]">
                        {stage === "stage2_complete" ? (
                          row.guessed_category ? (
                            <span className="px-2 py-0.5 rounded bg-[var(--card)] border border-[var(--border)] text-[10px] font-medium text-[var(--muted)]">
                              {row.guessed_category}
                            </span>
                          ) : (
                            <span className="text-[var(--muted)]">—</span>
                          )
                        ) : (
                          <span className="text-[var(--muted)] font-mono">••••••</span>
                        )}
                      </td>

                      {/* Amount */}
                      <td className="py-3 px-4 align-middle text-right font-semibold text-[var(--foreground)] whitespace-nowrap">
                        {stage === "stage2_complete" ? (
                          row.extracted_amount != null ? (
                            <span className="font-mono">₹{row.extracted_amount.toLocaleString("en-IN")}</span>
                          ) : (
                            <span className="text-[var(--muted)]">—</span>
                          )
                        ) : (
                          <span className="text-[var(--muted)] font-mono">₹•••••</span>
                        )}
                      </td>

                      {/* UTR / Account */}
                      <td className="py-3 px-4 align-middle font-mono text-[11px] text-[var(--muted)] max-w-[130px] truncate">
                        {stage === "stage2_complete" ? (
                          row.extracted_utr ? (
                            <span title={row.extracted_utr}>{row.extracted_utr}</span>
                          ) : (
                            <span>—</span>
                          )
                        ) : (
                          <span>••••••••••••</span>
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

              {/* Dev Diagnostics Expandable Panels */}
              {isDev && files.some((r) => expandedDiagnostics[r.id]) && (
                <div className="p-4 bg-slate-900 text-slate-200 border-t border-slate-800 text-xs font-mono flex flex-col gap-4">
                  <div className="font-bold text-purple-400 flex items-center gap-2">
                    <Terminal className="w-4 h-4" />
                    <span>Stage 1 Dev Diagnostics Inspection Panel</span>
                  </div>
                  {files.filter((r) => expandedDiagnostics[r.id]).map((row) => {
                    const diag = row.diagnostics;
                    return (
                      <div key={`diag-${row.id}`} className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex flex-col gap-2">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-1 text-slate-300">
                          <strong>File: {row.original_name}</strong>
                          <span className={diag?.ocrSuccess ? "text-emerald-400" : "text-red-400"}>
                            {diag?.ocrSuccess ? "OCR SUCCESS" : "OCR FAILED"}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                          <div>
                            <span className="text-slate-400 block mb-1">Date Candidates:</span>
                            <div className="bg-slate-900 p-2 rounded max-h-24 overflow-y-auto">
                              {diag?.dateCandidates.length ? (
                                diag.dateCandidates.map((d, i) => (
                                  <div key={i}>Raw: {d} → Normalized: {diag.normalizedDateCandidates[i]}</div>
                                ))
                              ) : (
                                <span className="text-slate-500 italic">No date candidates found</span>
                              )}
                            </div>
                            <div className="mt-1 text-teal-400 font-bold">
                              Selected Date: {diag?.selectedDate || "None"}
                            </div>
                          </div>

                          <div>
                            <span className="text-slate-400 block mb-1">Accepted Amount Candidates:</span>
                            <div className="bg-slate-900 p-2 rounded max-h-24 overflow-y-auto">
                              {diag?.amountCandidates.length ? (
                                diag.amountCandidates.map((a, i) => (
                                  <div key={i} className="text-emerald-400">Accepted: {a.raw} (₹{a.value})</div>
                                ))
                              ) : (
                                <span className="text-slate-500 italic">No accepted amounts</span>
                              )}
                            </div>
                            <div className="mt-1 text-purple-400 font-bold">
                              Selected Total: {diag?.selectedRoughAmount != null ? `₹${diag.selectedRoughAmount}` : "null (Estimate unavailable)"}
                            </div>
                          </div>
                        </div>

                        {diag?.rejectedAmountCandidates.length ? (
                          <div>
                            <span className="text-slate-400 block mb-1">Rejected Candidates & Reasons:</span>
                            <div className="bg-slate-900 p-2 rounded max-h-24 overflow-y-auto text-[10px] text-amber-300">
                              {diag.rejectedAmountCandidates.map((r, i) => (
                                <div key={i}>Candidate: "{r.raw}" → Reason: {r.reason}</div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div>
                          <span className="text-slate-400 block mb-1">Raw Tesseract OCR Text Snippet:</span>
                          <pre className="bg-slate-900 p-2 rounded text-[10px] max-h-32 overflow-y-auto text-slate-300 whitespace-pre-wrap">
                            {diag?.rawText || "No text extracted"}
                          </pre>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Inline Expandable Error Drawers */}
              {files.some((r) => r.ocrStatus === "failed" || r.extractStatus === "failed") && (
                <div className="p-4 bg-red-950/20 border-t border-red-500/20 flex flex-col gap-2">
                  <div className="font-bold text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Row Failure Details & Diagnostics</span>
                  </div>

                  {files.filter((r) => r.ocrStatus === "failed" || r.extractStatus === "failed").map((row) => (
                    <div key={`err-${row.id}`} className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs flex flex-col gap-1.5">
                      <div className="flex items-center justify-between font-semibold text-red-700 dark:text-red-400">
                        <span>{row.original_name} — Stage: {row.errorDetail?.stage?.toUpperCase() || (row.ocrStatus === "failed" ? "STAGE 1 OCR" : "STAGE 2 EXTRACTION")}</span>
                        {row.errorDetail?.retryable && (
                          <button
                            type="button"
                            onClick={() => handleRetryRow(row.id)}
                            className="px-2 py-0.5 rounded bg-red-600 text-white font-bold text-[10px] flex items-center gap-1 hover:bg-red-700 transition-colors"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>Retry Row</span>
                          </button>
                        )}
                      </div>

                      {/* User Safe Message */}
                      <p className="text-xs text-red-800 dark:text-red-300">
                        {row.extractErrorMessage || row.ocrErrorMessage || "Processing failed for this screenshot."}
                      </p>

                      {/* Dev Detailed Error Info */}
                      {isDev && row.errorDetail && (
                        <div className="mt-1 p-2 bg-slate-900 text-slate-200 rounded-lg text-[11px] font-mono flex flex-col gap-1">
                          <div><strong>Code:</strong> {row.errorDetail.code}</div>
                          {row.errorDetail.httpStatus ? <div><strong>HTTP Status:</strong> {row.errorDetail.httpStatus}</div> : null}
                          <div><strong>Sanitized Error:</strong> {row.errorDetail.message}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Export Excel Action Bar in Stage 2 Complete */}
            {stage === "stage2_complete" && (
              <div className="p-4 bg-[var(--card-muted)] border-t border-[var(--border)] flex items-center justify-between">
                <div className="text-xs text-[var(--muted)]">
                  Full extraction complete. Ready to download clean Excel spreadsheet.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const validRows = files
                      .filter((f) => f.extractStatus === "ready" || f.extractStatus === "needs_review")
                      .map((f) => ({
                        original_name: f.original_name,
                        extracted_date: f.extracted_date || null,
                        extracted_party: f.extracted_party || null,
                        guessed_category: f.guessed_category || null,
                        extracted_amount: f.extracted_amount || null,
                        extracted_utr: f.extracted_utr || null,
                        guessed_type: f.guessed_type || "expense",
                        status: f.extractStatus
                      }));
                    downloadQuickExcel(validRows);
                  }}
                  className="btn-theme-accent text-xs px-4 py-2 rounded-lg font-bold flex items-center gap-2 cursor-pointer shadow-sm"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Download Quick Excel</span>
                </button>
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
}
