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
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Layers,
  Split,
  UserCheck,
  Check
} from "lucide-react";
import { TesseractPool, runClientOcr, OcrDiagnostics } from "@/lib/ocr";
import { downloadQuickExcel, QuickExportRow } from "@/lib/excel";

export type QuickApiErrorResponse = {
  ok: false;
  stage: "ocr" | "stage2";
  code: string;
  message: string;
  httpStatus?: number;
  retryable?: boolean;
};

export type QuickSplitItem = {
  id: string;
  name: string;
  amount: number | null;
};

export type DraftRowState = {
  extracted_date: string;
  extracted_party: string;
  extracted_amount: string;
  guessed_category: string;
  errors: {
    extracted_date?: string;
    extracted_party?: string;
    extracted_amount?: string;
    guessed_category?: string;
  };
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
  actual_recipient?: string | null; // Paid to account (actual bank recipient)
  extracted_party?: string | null;   // Actually for (intended payee)
  guessed_category?: string | null;
  extracted_amount?: number | null;
  extracted_utr?: string | null;    // Internal identifier (retained ONLY client-side in memory for duplicate detection)
  guessed_type?: "income" | "expense" | null;
  extraction_confidence?: Record<string, string>;
  extractErrorMessage?: string;
  errorDetail?: QuickApiErrorResponse;

  // Retry Engine State
  retryCount?: number;
  isTransientError?: boolean;

  // UX Review State
  isEdited?: boolean;
  isCollapsed?: boolean;
  isRedirectingPayee?: boolean;
  isSplitting?: boolean;
  splits?: QuickSplitItem[];
};

const MAX_BATCH_SIZE = 50;
const REVIEW_BATCH_SIZE = 10;
const AUTO_COLLAPSE_DELAY_MS = 4000;
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_CONCURRENT_WORKERS = 3;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp"
]);

// Duplicate detection normalization helper
const getNormalizedIdentifier = (utr?: string | null): string | null => {
  if (!utr) return null;
  const trimmed = utr.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!trimmed || trimmed === "UNKNOWN" || trimmed === "NULL" || trimmed === "UNDEFINED") {
    return null;
  }
  return trimmed;
};

// Split validation helper
const getRowSplitValidation = (row: QuickFileRow) => {
  const parentAmount = row.extracted_amount || 0;
  const splits = row.splits || [];
  const allocated = splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const remaining = parentAmount - allocated;
  const isComplete = splits.length > 0 && Math.abs(remaining) < 0.01 && splits.every((s) => s.name.trim() !== "" && s.amount !== null && s.amount > 0);
  return { parentAmount, allocated, remaining, isComplete };
};

// Transient error classification for automated retry
const isTransientExtractionError = (httpStatus: number, code?: string, retryableFlag?: boolean): boolean => {
  // Non-retryable status codes explicitly specified: 400, 401, 402, 403, 404
  if (httpStatus >= 400 && httpStatus <= 404) return false;
  // If backend explicitly marked retryable: false or code is non-retryable format error
  if (retryableFlag === false) return false;
  if (code === "FILE_TOO_LARGE" || code === "UNSUPPORTED_MIME" || code === "UNSUPPORTED_PDF" || code === "UNSUPPORTED_HEIC" || code === "PAYMENT_REQUIRED") {
    return false;
  }
  // Transient status codes & conditions: 429, 502, 503, 504, 0 (network failure / timeout)
  if (httpStatus === 429 || httpStatus === 502 || httpStatus === 503 || httpStatus === 504 || httpStatus === 0) {
    return true;
  }
  // Generic 500 server error: only retry if explicitly retryable !== false
  if (httpStatus === 500 && retryableFlag === true) {
    return true;
  }
  return false;
};

// User-friendly safe error messaging for production
const getProductionSafeErrorMessage = (row: QuickFileRow): string => {
  const err = row.errorDetail;
  if (!err) return "We couldn’t read this screenshot. Please check the file or try again.";
  if (err.httpStatus === 429) {
    return "Too many requests right now. We’ll try again shortly.";
  }
  if (err.httpStatus === 504 || err.code === "TIMEOUT") {
    return "This screenshot took too long to read. You can try again.";
  }
  if (err.httpStatus === 402 || err.code === "PAYMENT_REQUIRED") {
    return "Full extraction is unavailable until payment is completed.";
  }
  if (err.httpStatus === 400 || err.code?.startsWith("UNSUPPORTED")) {
    return "This file type is not supported.";
  }
  return "We couldn’t read this screenshot. Please check the file or try again.";
};

const getFlaggedRowReason = (row: QuickFileRow, isDuplicate: boolean): string => {
  if (row.ocrStatus === "failed" || row.extractStatus === "failed") {
    return "We couldn’t read this screenshot";
  }
  if (!row.extracted_amount || row.extracted_amount <= 0) {
    return "Amount is missing";
  }
  if (!row.extracted_party || row.extracted_party.trim() === "") {
    return "Payee is missing";
  }
  if (!row.extracted_date || row.extracted_date.trim() === "") {
    return "Date is missing";
  }
  if (isDuplicate) {
    return "Repeated payment account in this batch — review intended payee";
  }
  return "Please review the extracted details";
};

export default function QuickPage() {
  const [files, setFiles] = useState<QuickFileRow[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [warningMessage, setWarningMessage] = useState<string>("");
  const [stage, setStage] = useState<"stage1_ocr" | "stage1_complete" | "stage2_extracting" | "stage2_complete">("stage1_ocr");
  const [stage2Error, setStage2Error] = useState<string>("");
  const [expandedDiagnostics, setExpandedDiagnostics] = useState<Record<string, boolean>>({});

  // Chunked Review UX State
  const [currentBatchIndex, setCurrentBatchIndex] = useState(0);
  const [collapsedRowIds, setCollapsedRowIds] = useState<Record<string, boolean>>({});
  const [interactedRowIds, setInteractedRowIds] = useState<Record<string, boolean>>({});
  const [editingDrafts, setEditingDrafts] = useState<Record<string, DraftRowState>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeUrlsRef = useRef<Set<string>>(new Set());
  const ocrPoolRef = useRef<TesseractPool | null>(null);
  const collapseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | HTMLDivElement | null>>({});

  const isDev = process.env.NODE_ENV === "development";

  // Lazy pool getter
  const getOcrPool = () => {
    if (!ocrPoolRef.current) {
      ocrPoolRef.current = new TesseractPool();
    }
    return ocrPoolRef.current;
  };

  // Terminate workers on unmount & cleanup preview URLs & timers
  useEffect(() => {
    const activeUrls = activeUrlsRef.current;
    return () => {
      if (collapseTimerRef.current) {
        clearTimeout(collapseTimerRef.current);
        collapseTimerRef.current = null;
      }
      if (ocrPoolRef.current) {
        ocrPoolRef.current.terminateAll();
        ocrPoolRef.current = null;
      }
      activeUrls.forEach((url) => URL.revokeObjectURL(url));
      activeUrls.clear();
    };
  }, []);

  // Delayed 4-second auto-collapse timer engine for active batch
  useEffect(() => {
    if (stage !== "stage2_complete") return;

    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }

    collapseTimerRef.current = setTimeout(() => {
      const activeEl = document.activeElement;
      const isInputFocused = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "SELECT" || activeEl.tagName === "TEXTAREA");

      setCollapsedRowIds((prev) => {
        const next = { ...prev };
        const activeBatch = files.slice(currentBatchIndex * REVIEW_BATCH_SIZE, (currentBatchIndex + 1) * REVIEW_BATCH_SIZE);
        
        activeBatch.forEach((row) => {
          const isFlagged = row.extractStatus === "needs_review" || row.extractStatus === "failed" || row.ocrStatus === "failed";
          const isUserEdited = row.isEdited || interactedRowIds[row.id];

          const rowNode = rowRefs.current[row.id];
          const hasFocusedInput = isInputFocused && rowNode && rowNode.contains(activeEl);

          if (!isFlagged && !isUserEdited && !hasFocusedInput && row.extractStatus === "ready") {
            next[row.id] = true;
          }
        });
        return next;
      });
    }, AUTO_COLLAPSE_DELAY_MS);

    return () => {
      if (collapseTimerRef.current) {
        clearTimeout(collapseTimerRef.current);
        collapseTimerRef.current = null;
      }
    };
  }, [currentBatchIndex, stage, files, interactedRowIds]);

  // Focus & auto-scroll first flagged row upon batch load
  useEffect(() => {
    if (stage !== "stage2_complete") return;

    const activeBatch = files.slice(currentBatchIndex * REVIEW_BATCH_SIZE, (currentBatchIndex + 1) * REVIEW_BATCH_SIZE);
    if (activeBatch.length === 0) return;

    const targetRow = activeBatch.find(
      (r) => r.extractStatus === "needs_review" || r.extractStatus === "failed" || r.ocrStatus === "failed"
    ) || activeBatch[0];

    if (targetRow && rowRefs.current[targetRow.id]) {
      const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      rowRefs.current[targetRow.id]?.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "nearest"
      });
    }
  }, [currentBatchIndex, stage, files]);

  const handleRowInteraction = useCallback((rowId: string) => {
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    setInteractedRowIds((prev) => ({ ...prev, [rowId]: true }));
  }, []);

  const toggleRowCollapse = useCallback((rowId: string) => {
    handleRowInteraction(rowId);
    setCollapsedRowIds((prev) => {
      const isCurrentlyCollapsed = prev[rowId] !== undefined ? prev[rowId] : false;
      return { ...prev, [rowId]: !isCurrentlyCollapsed };
    });
  }, [handleRowInteraction]);

  const handleStartEditRow = useCallback((rowId: string) => {
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    const row = files.find((r) => r.id === rowId);
    if (!row) return;

    setInteractedRowIds((prev) => ({ ...prev, [rowId]: true }));
    setCollapsedRowIds((prev) => ({ ...prev, [rowId]: false }));

    setEditingDrafts((prev) => ({
      ...prev,
      [rowId]: {
        extracted_date: row.extracted_date || "",
        extracted_party: row.extracted_party || "",
        extracted_amount: row.extracted_amount != null ? String(row.extracted_amount) : "",
        guessed_category: row.guessed_category || "",
        errors: {}
      }
    }));
  }, [files]);

  const handleUpdateDraft = useCallback((rowId: string, updates: Partial<DraftRowState>) => {
    setEditingDrafts((prev) => {
      const current = prev[rowId];
      if (!current) return prev;
      return {
        ...prev,
        [rowId]: {
          ...current,
          ...updates,
          errors: {
            ...current.errors,
            ...Object.keys(updates).reduce((acc, key) => ({ ...acc, [key]: undefined }), {})
          }
        }
      };
    });
  }, []);

  const handleCancelEditRow = useCallback((rowId: string) => {
    setEditingDrafts((prev) => {
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
  }, []);

  const handleSaveRow = useCallback((rowId: string) => {
    const draft = editingDrafts[rowId];
    if (!draft) return;

    const errors: DraftRowState["errors"] = {};

    if (!draft.extracted_date || draft.extracted_date.trim() === "") {
      errors.extracted_date = "Date is required";
    }

    if (!draft.extracted_party || draft.extracted_party.trim() === "") {
      errors.extracted_party = "Payee is required";
    }

    const numVal = parseFloat(draft.extracted_amount);
    if (!draft.extracted_amount || isNaN(numVal) || numVal <= 0) {
      errors.extracted_amount = "Amount must be greater than 0";
    }

    const isValid = Object.keys(errors).length === 0;

    if (!isValid) {
      setEditingDrafts((prev) => ({
        ...prev,
        [rowId]: {
          ...draft,
          errors
        }
      }));
      setFiles((prev) =>
        prev.map((r) => (r.id === rowId ? { ...r, extractStatus: "needs_review" } : r))
      );
      setCollapsedRowIds((prev) => ({ ...prev, [rowId]: false }));
      return;
    }

    setFiles((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;

        // Check if duplicate account identifier warning exists for this row
        const norm = getNormalizedIdentifier(r.extracted_utr);
        let isDuplicateAccount = false;
        if (norm) {
          const matchCount = prev.filter((other) => getNormalizedIdentifier(other.extracted_utr) === norm).length;
          isDuplicateAccount = matchCount > 1;
        }

        let isInvalidSplit = false;
        if (r.isSplitting || (r.splits && r.splits.length > 0)) {
          const val = getRowSplitValidation(r);
          isInvalidSplit = !val.isComplete;
        }

        // Set status to ready ONLY if no remaining review warning exists on this row
        const hasRemainingWarning = isDuplicateAccount || isInvalidSplit;
        const targetStatus = hasRemainingWarning ? "needs_review" : "ready";

        return {
          ...r,
          extracted_date: draft.extracted_date.trim(),
          extracted_party: draft.extracted_party.trim(),
          actual_recipient: r.actual_recipient || draft.extracted_party.trim(),
          extracted_amount: numVal,
          guessed_category: draft.guessed_category.trim() || null,
          extractStatus: targetStatus,
          isEdited: true,
          ocrStatus: r.ocrStatus === "failed" ? "completed" : r.ocrStatus,
          extractErrorMessage: hasRemainingWarning ? r.extractErrorMessage : undefined
        };
      })
    );

    setEditingDrafts((prev) => {
      const next = { ...prev };
      delete next[rowId];
      return next;
    });

    setCollapsedRowIds((prev) => ({ ...prev, [rowId]: true }));
  }, [editingDrafts]);

  const toggleRedirectPayee = useCallback((rowId: string) => {
    handleRowInteraction(rowId);
    setFiles((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, isRedirectingPayee: !r.isRedirectingPayee } : r))
    );
  }, [handleRowInteraction]);

  const toggleSplitting = useCallback((rowId: string) => {
    handleRowInteraction(rowId);
    setFiles((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const nextIsSplitting = !r.isSplitting;
        let nextSplits = r.splits;
        if (nextIsSplitting && (!nextSplits || nextSplits.length === 0)) {
          nextSplits = [
            {
              id: crypto.randomUUID(),
              name: r.extracted_party || "",
              amount: r.extracted_amount || null
            }
          ];
        }
        return {
          ...r,
          isSplitting: nextIsSplitting,
          splits: nextSplits
        };
      })
    );
  }, [handleRowInteraction]);

  const handleAddSplitPerson = (rowId: string) => {
    handleRowInteraction(rowId);
    setFiles((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const currentSplits = r.splits || [];
        const newSplit: QuickSplitItem = {
          id: crypto.randomUUID(),
          name: "",
          amount: null
        };
        return {
          ...r,
          splits: [...currentSplits, newSplit],
          isEdited: true
        };
      })
    );
  };

  const handleUpdateSplitPerson = (rowId: string, splitId: string, updates: Partial<QuickSplitItem>) => {
    handleRowInteraction(rowId);
    setFiles((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const currentSplits = r.splits || [];
        return {
          ...r,
          splits: currentSplits.map((s) => (s.id === splitId ? { ...s, ...updates } : s)),
          isEdited: true
        };
      })
    );
  };

  const handleRemoveSplitPerson = (rowId: string, splitId: string) => {
    handleRowInteraction(rowId);
    setFiles((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const currentSplits = r.splits || [];
        const updated = currentSplits.filter((s) => s.id !== splitId);
        return {
          ...r,
          splits: updated,
          isEdited: true
        };
      })
    );
  };

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
                ocrErrorMessage: res.error || "Reading screenshot failed",
                diagnostics: res.diagnostics,
                errorDetail: {
                  ok: false,
                  stage: "ocr",
                  code: "OCR_EXECUTION_FAILED",
                  message: res.error || "Could not read screenshot text.",
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

  const setRowRef = useCallback((id: string, el: HTMLTableRowElement | HTMLDivElement | null) => {
    rowRefs.current[id] = el;
  }, []);

  // ----------------------------------------------------
  // Stage 2: AI Full Extraction Handler with Exponential Backoff Auto-Retry
  // ----------------------------------------------------
  const processStage2Extraction = useCallback(async (id: string, file: File, currentRetryCount = 0) => {
    const formData = new FormData();
    formData.append("file", file);

    if (isDev) {
      console.log("[QuickMode Stage2 Client Dispatch]", {
        id,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        retryCount: currentRetryCount
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
          responseBody: { ok: data.ok, extracted_party: data.extracted_party, extracted_amount: data.extracted_amount }
        });
      }

      if (!res.ok || !data.ok) {
        if (res.status === 402) {
          setStage2Error("Payment required to unlock full extraction.");
        }

        const httpStatus = res.status;
        const code = data?.code || "EXTRACTION_FAILED";
        const retryable = data?.retryable ?? true;
        const transient = isTransientExtractionError(httpStatus, code, retryable);

        // Auto-retry transient errors up to 2 times with exponential backoff & jitter
        if (transient && currentRetryCount < 2) {
          const nextRetryCount = currentRetryCount + 1;
          const backoffMs = nextRetryCount === 1 ? 1500 + Math.random() * 300 : 4000 + Math.random() * 500;

          if (isDev) {
            console.log(`[QuickMode Auto-Retry Scheduling] Row ${id} -> Retry #${nextRetryCount} in ${Math.round(backoffMs)}ms`);
          }

          setFiles((prev) =>
            prev.map((row) =>
              row.id === id
                ? {
                    ...row,
                    extractStatus: "extracting",
                    retryCount: nextRetryCount,
                    isTransientError: true
                  }
                : row
            )
          );

          setTimeout(() => {
            processStage2Extraction(id, file, nextRetryCount);
          }, backoffMs);
          return;
        }

        // Final failure after retries exhausted or non-retryable error
        const errDetail: QuickApiErrorResponse = {
          ok: false,
          stage: "stage2",
          code,
          message: data?.message || "We couldn’t read this screenshot. Please check the file or try again.",
          httpStatus,
          retryable: transient
        };

        setFiles((prev) =>
          prev.map((row) =>
            row.id === id
              ? {
                  ...row,
                  extractStatus: "failed",
                  extractErrorMessage: errDetail.message,
                  errorDetail: errDetail,
                  isTransientError: transient
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
      ).some((val: unknown) => String(val).toLowerCase() === "low");

      const finalStatus: "ready" | "needs_review" =
        missingCoreFields || hasLowConfidence ? "needs_review" : "ready";

      setFiles((prev) =>
        prev.map((row) =>
          row.id === id
            ? {
                ...row,
                extractStatus: finalStatus,
                actual_recipient: data.extracted_party ?? null,
                extracted_party: data.extracted_party ?? null,
                extracted_amount: data.extracted_amount ?? null,
                extracted_date: data.extracted_date ?? null,
                extracted_utr: data.extracted_utr ?? null,
                guessed_category: data.guessed_category ?? null,
                guessed_type: data.guessed_type ?? "expense",
                extraction_confidence: data.extraction_confidence ?? {},
                retryCount: 0,
                isTransientError: undefined,
                errorDetail: undefined
              }
            : row
        )
      );
    } catch (err: unknown) {
      const transient = true;
      if (transient && currentRetryCount < 2) {
        const nextRetryCount = currentRetryCount + 1;
        const backoffMs = nextRetryCount === 1 ? 1500 + Math.random() * 300 : 4000 + Math.random() * 500;

        setFiles((prev) =>
          prev.map((row) =>
            row.id === id
              ? {
                  ...row,
                  extractStatus: "extracting",
                  retryCount: nextRetryCount,
                  isTransientError: true
                }
              : row
          )
        );

        setTimeout(() => {
          processStage2Extraction(id, file, nextRetryCount);
        }, backoffMs);
        return;
      }

      const errDetail: QuickApiErrorResponse = {
        ok: false,
        stage: "stage2",
        code: "NETWORK_ERROR",
        message: err instanceof Error ? err.message : "Network error during extraction",
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
                errorDetail: errDetail,
                isTransientError: true
              }
            : row
        )
      );
    }
  }, [isDev]);

  // Stage 2 Queue Runner (Max 3 Workers, Never Exceeding 3 Active Requests)
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
        processStage2Extraction(row.id, row.file, row.retryCount || 0);
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
      prev.map((r) => (r.ocrStatus === "completed" ? { ...r, extractStatus: "queued", retryCount: 0 } : r))
    );
  };

  const handleRetryRow = (id: string) => {
    setFiles((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        if (r.ocrStatus === "failed") {
          return { ...r, ocrStatus: "idle", ocrErrorMessage: undefined, errorDetail: undefined };
        }
        return { ...r, extractStatus: "queued", retryCount: 0, extractErrorMessage: undefined, errorDetail: undefined };
      })
    );
    if (stage === "stage2_complete") {
      setStage("stage2_extracting");
    }
  };

  // Bulk retry action for eligible transient failed rows
  const handleRetryFailedRows = () => {
    setFiles((prev) =>
      prev.map((r) => {
        if (r.extractStatus === "failed" && r.isTransientError !== false && r.errorDetail?.httpStatus !== 402) {
          return {
            ...r,
            extractStatus: "queued",
            retryCount: 0,
            extractErrorMessage: undefined,
            errorDetail: undefined
          };
        }
        return r;
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
          isTransientError: false,
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
          ocrErrorMessage: "PDF format deferred — upload JPG, PNG, or WEBP images",
          extractStatus: "failed",
          isTransientError: false,
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
          isTransientError: false,
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
          isTransientError: false,
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
        extractStatus: "queued",
        retryCount: 0
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

    const targetRow = files.find((r) => r.id === id);
    if (targetRow?.splits && targetRow.splits.length > 0) {
      const confirmed = window.confirm("This row has split allocations. Remove this entry and its split data from Quick Mode?");
      if (!confirmed) return;
    }

    setFiles((prev) => {
      const target = prev.find((r) => r.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
        activeUrlsRef.current.delete(target.previewUrl);
      }
      return prev.filter((r) => r.id !== id);
    });

    setCollapsedRowIds((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setInteractedRowIds((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setEditingDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
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
    setCollapsedRowIds({});
    setInteractedRowIds({});
    setEditingDrafts({});
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
  // Aggregate Metrics & Counts
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

  // User-facing Step Labels (No technical Stage 1/2 terms)
  const steps = [
    { number: 1, title: "Add screenshots", icon: Upload, current: stage === "stage1_ocr" || stage === "stage1_complete", description: "Select UPI images or receipts" },
    { number: 2, title: "Check your entries", icon: ListChecks, current: stage === "stage2_extracting", description: "Review extracted payee & amount" },
    { number: 3, title: "Download Excel", icon: FileSpreadsheet, current: stage === "stage2_complete", description: "Save clean verified spreadsheet" }
  ];

  // Excel download handler with incomplete row guard
  const handleDownloadExcel = () => {
    // Identify rows missing required bookkeeping fields (Date, Payee, Amount > 0, or ready status)
    const incompleteRows = files.filter((r) => {
      const isMissingDate = !r.extracted_date || r.extracted_date.trim() === "";
      const isMissingParty = !r.extracted_party || r.extracted_party.trim() === "";
      const isMissingAmount = r.extracted_amount == null || isNaN(Number(r.extracted_amount)) || Number(r.extracted_amount) <= 0;
      const isNotReady = r.extractStatus !== "ready";
      let isInvalidSplit = false;
      if (r.isSplitting || (r.splits && r.splits.length > 0)) {
        const val = getRowSplitValidation(r);
        isInvalidSplit = !val.isComplete;
      }
      return isMissingDate || isMissingParty || isMissingAmount || isNotReady || isInvalidSplit;
    });

    if (incompleteRows.length > 0) {
      const count = incompleteRows.length;
      setWarningMessage(
        `Finish reviewing the highlighted entries before downloading. (${count} ${count === 1 ? "entry needs" : "entries need"} review)`
      );

      // Auto-scroll to the first incomplete row so the user can easily review & edit
      const firstIncomplete = incompleteRows[0];
      if (firstIncomplete && rowRefs.current[firstIncomplete.id]) {
        const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        rowRefs.current[firstIncomplete.id]?.scrollIntoView({
          behavior: prefersReducedMotion ? "auto" : "smooth",
          block: "nearest"
        });
      }
      return;
    }

    const validRows: QuickExportRow[] = files.map((f) => ({
      original_name: f.original_name,
      extracted_date: f.extracted_date || null,
      extracted_party: f.extracted_party || null,
      guessed_category: f.guessed_category || null,
      extracted_amount: f.extracted_amount != null ? Number(f.extracted_amount) : null,
      guessed_type: f.guessed_type || "expense",
      splits: f.splits && f.splits.length > 0 ? f.splits : undefined,
    }));

    downloadQuickExcel(validRows);
  };

  // Derived Display Order for active batch
  const totalBatches = Math.max(1, Math.ceil(files.length / REVIEW_BATCH_SIZE));
  const activeBatchOriginal = files.slice(currentBatchIndex * REVIEW_BATCH_SIZE, (currentBatchIndex + 1) * REVIEW_BATCH_SIZE);

  // Check for eligible transient failed rows in active workspace
  const eligibleFailedRowsInBatch = activeBatchOriginal.filter(
    (r) => r.extractStatus === "failed" && r.isTransientError !== false && r.errorDetail?.httpStatus !== 402
  );
  
  // Calculate duplicates in active batch (using normalized in-memory identifiers)
  const countMap: Record<string, number> = {};
  activeBatchOriginal.forEach((r) => {
    const norm = getNormalizedIdentifier(r.extracted_utr);
    if (norm) {
      countMap[norm] = (countMap[norm] || 0) + 1;
    }
  });
  const duplicateRowIdsInBatch = new Set<string>();
  activeBatchOriginal.forEach((r) => {
    const norm = getNormalizedIdentifier(r.extracted_utr);
    if (norm && countMap[norm] > 1) {
      duplicateRowIdsInBatch.add(r.id);
    }
  });

  // Derived Display Array for Active Batch (Priority: 1. failed, 2. needs_review, 3. edited/touched, 4. ready)
  const activeBatchDisplay = [...activeBatchOriginal].sort((a, b) => {
    const getPriority = (row: QuickFileRow) => {
      const isFailed = row.ocrStatus === "failed" || row.extractStatus === "failed";
      if (isFailed) return 1;
      if (row.extractStatus === "needs_review") return 2;
      if (row.isEdited || interactedRowIds[row.id]) return 3;
      return 4;
    };
    return getPriority(a) - getPriority(b);
  });

  const readyInBatchCount = activeBatchOriginal.filter((r) => r.extractStatus === "ready").length;
  const collapsedInBatch = activeBatchOriginal.filter((r) => Boolean(collapsedRowIds[r.id]));

  // Check if any row in active batch has an incomplete split
  const invalidSplitRowInBatch = activeBatchOriginal.find((r) => {
    if (r.isSplitting || (r.splits && r.splits.length > 0)) {
      const val = getRowSplitValidation(r);
      return !val.isComplete;
    }
    return false;
  });

  const isFinalBatch = currentBatchIndex >= totalBatches - 1;

  const handleExpandAllReadyInBatch = () => {
    setCollapsedRowIds((prev) => {
      const next = { ...prev };
      activeBatchOriginal.forEach((r) => {
        next[r.id] = false;
      });
      return next;
    });
  };

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
                  Temporary Workspace
                </span>
                {isDev && (
                  <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400">
                    DEV DIAGNOSTICS ACTIVE
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Fast screenshot processing for clean Excel exports
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

        {/* Temporary Workspace Notice (No technical session wording) */}
        <div className="rounded-xl bg-[var(--card-muted)] border border-[var(--border)] p-4 flex items-start gap-3">
          <Info className="w-4 h-4 text-[var(--primary)] shrink-0 mt-0.5" />
          <div className="text-xs text-[var(--muted)] leading-relaxed">
            <strong className="text-[var(--foreground)]">Temporary workspace:</strong> Your files are used only for this batch. Nothing is saved to your account or ledger. Closing or refreshing this tab clears the batch.
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
                Drag & drop UPI payment screenshots or receipt images to process instantly.
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
                      Reading screenshots...
                    </span>
                  )}
                  {stage === "stage1_complete" && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      Ready to check
                    </span>
                  )}
                  {stage === "stage2_extracting" && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Reading screenshots...
                    </span>
                  )}
                  {stage === "stage2_complete" && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Ready to check
                    </span>
                  )}
                </h4>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  Screenshots are processed in temporary browser memory
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

        {/* Stage 1 Summary Banner */}
        {files.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="surface-panel p-3.5 rounded-xl flex flex-col border-l-4 border-l-blue-500">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] flex items-center justify-between">
                <span>Files Read</span>
                <span className="text-[9px] bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded font-mono">Temporary</span>
              </span>
              <span className="text-lg font-extrabold text-[var(--foreground)] mt-1">
                {filesReadCount} <span className="text-xs font-normal text-[var(--muted)]">/ {counts.total}</span>
              </span>
            </div>

            <div className="surface-panel p-3.5 rounded-xl flex flex-col border-l-4 border-l-indigo-500">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] flex items-center justify-between">
                <span>Approx. transactions</span>
                <span className="text-[9px] bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded font-mono">Estimate</span>
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
                <span className="text-[9px] bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded font-mono">Estimate</span>
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
                  Screenshots read successfully
                </h3>
                <p className="text-xs text-[var(--muted)] max-w-lg mb-4 leading-relaxed">
                  Uploaded files were read in your browser. Full editable ledger rows, exact transaction amounts, payee names, and Excel export require unlocking extraction.
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

            {/* Chunked Review Progress Header */}
            {stage === "stage2_complete" && (
              <div className="p-4 bg-[var(--card-muted)] border-b border-[var(--border)] flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-[var(--foreground)] flex items-center gap-1.5">
                        <Layers className="w-4 h-4 text-[var(--primary)]" />
                        <span>Batch {currentBatchIndex + 1} of {totalBatches}</span>
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--card)] border border-[var(--border)] text-[var(--muted)]">
                        Showing {currentBatchIndex * REVIEW_BATCH_SIZE + 1}–{Math.min((currentBatchIndex + 1) * REVIEW_BATCH_SIZE, files.length)} of {files.length} entries
                      </span>
                    </div>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1">
                      {readyInBatchCount}/{activeBatchOriginal.length} Rows look ready — review highlighted entries.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    <button
                      type="button"
                      disabled={currentBatchIndex === 0}
                      onClick={() => setCurrentBatchIndex((prev) => Math.max(0, prev - 1))}
                      className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--card-muted)] transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      aria-label="Previous batch"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Previous Batch</span>
                    </button>

                    {!isFinalBatch ? (
                      <button
                        type="button"
                        disabled={Boolean(invalidSplitRowInBatch)}
                        onClick={() => setCurrentBatchIndex((prev) => Math.min(totalBatches - 1, prev + 1))}
                        className="px-3.5 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-sm"
                        aria-label="Review next batch"
                      >
                        <span>Review next batch</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={Boolean(invalidSplitRowInBatch)}
                        onClick={handleDownloadExcel}
                        className="px-4 py-1.5 rounded-lg btn-theme-accent text-xs font-extrabold flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-sm"
                        aria-label="Review complete — Generate Excel"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        <span>Review complete — Generate Excel</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Bulk Failed Row Retry Action Banner */}
                {eligibleFailedRowsInBatch.length > 0 && (
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3 text-xs text-amber-800 dark:text-amber-300 font-semibold flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span>Some screenshots could not be processed. You can retry them individually.</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleRetryFailedRows}
                      className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm shrink-0"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Retry failed rows</span>
                    </button>
                  </div>
                )}

                {invalidSplitRowInBatch && (
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-2.5 text-xs text-amber-800 dark:text-amber-300 font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>
                      Cannot proceed: Entry &quot;{invalidSplitRowInBatch.original_name}&quot; has an incomplete split allocation. Allocated sum must equal total payment.
                    </span>
                  </div>
                )}

                {collapsedInBatch.length > 1 && (
                  <div className="flex items-center justify-between bg-[var(--card)] p-2 rounded-lg border border-[var(--border)] text-xs">
                    <span className="text-[var(--muted)] font-medium">
                      {collapsedInBatch.length} extracted rows collapsed
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleExpandAllReadyInBatch}
                        className="text-xs font-semibold text-[var(--primary)] hover:underline flex items-center gap-1"
                      >
                        Expand ready rows
                      </button>
                    </div>
                  </div>
                )}

                <div className="w-full h-1.5 bg-[var(--border)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--primary)] transition-all duration-300"
                    style={{ width: `${((currentBatchIndex + 1) / totalBatches) * 100}%` }}
                  />
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
                    <th className="py-3 px-4">Actions / Redirection</th>
                    <th className="py-3 px-4 text-center w-10">Remove</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {/* eslint-disable-next-line react-hooks/refs */}
                  {(stage === "stage2_complete" ? activeBatchDisplay : files).map((row) => {
                    const isDuplicate = duplicateRowIdsInBatch.has(row.id);
                    const draft = editingDrafts[row.id];
                    const isEditing = Boolean(draft);
                    const isFlagged = row.extractStatus === "needs_review" || row.extractStatus === "failed" || row.ocrStatus === "failed";
                    
                    const isCollapsed = !isEditing && (collapsedRowIds[row.id] !== undefined ? collapsedRowIds[row.id] : row.extractStatus === "ready");
                    const flaggedReason = getFlaggedRowReason(row, isDuplicate);

                    // MODE 1: READ MODE (COLLAPSED)
                    if (stage === "stage2_complete" && isCollapsed) {
                      return (
                        <tr
                          key={row.id}
                          ref={(el) => setRowRef(row.id, el)}
                          className="bg-[var(--card)] hover:bg-[var(--card-muted)]/60 transition-colors border-b border-[var(--border)]"
                        >
                          <td className="py-2.5 px-4 align-middle">
                            {row.previewUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={row.previewUrl} alt="" className="w-9 h-9 object-cover rounded-lg bg-[var(--card-muted)] border border-[var(--border)] shrink-0" />
                            ) : (
                              <div className="w-9 h-9 rounded-lg bg-[var(--card-muted)] border border-[var(--border)] flex items-center justify-center font-bold text-[9px] text-[var(--muted)] shrink-0">
                                FILE
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-4 align-middle max-w-[140px]">
                            <div className="font-semibold text-[var(--foreground)] truncate text-xs" title={row.original_name}>
                              {row.original_name}
                            </div>
                            <div className="text-[10px] text-[var(--muted)]">{formatFileSize(row.fileSize)}</div>
                          </td>
                          <td className="py-2.5 px-4 align-middle whitespace-nowrap">
                            {row.extractStatus === "ready" ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                Ready to check
                              </span>
                            ) : row.extractStatus === "needs_review" ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20">
                                <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                Needs your review
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 border border-red-200 dark:border-red-500/20">
                                <XCircle className="w-3 h-3 text-red-600 dark:text-red-400" />
                                Couldn’t read
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 align-middle text-xs font-mono text-[var(--foreground)]">
                            {row.extracted_date || "—"}
                          </td>
                          <td className="py-2.5 px-4 align-middle text-xs font-medium text-[var(--foreground)] truncate max-w-[140px]" title={row.extracted_party || ""}>
                            {row.extracted_party || row.actual_recipient || "—"}
                          </td>
                          <td className="py-2.5 px-4 align-middle text-xs text-[var(--muted)]">
                            {row.guessed_category || "—"}
                          </td>
                          <td className="py-2.5 px-4 align-middle text-xs text-right font-mono font-bold text-[var(--foreground)]">
                            {row.extracted_amount != null ? `₹${row.extracted_amount.toLocaleString("en-IN")}` : "—"}
                          </td>
                          <td className="py-2.5 px-4 align-middle whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              {row.isEdited && (
                                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/20 flex items-center gap-1">
                                  <Check className="w-3 h-3" />
                                  <span>Saved for this batch ✓</span>
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => toggleRowCollapse(row.id)}
                                className="px-2.5 py-1 rounded-md text-xs font-semibold text-[var(--primary)] hover:bg-[var(--card-muted)] transition-colors flex items-center gap-1 cursor-pointer"
                                aria-expanded="false"
                                aria-label={`Expand row for ${row.extracted_party || row.original_name}`}
                              >
                                <span>Expand row</span>
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleStartEditRow(row.id)}
                                className="px-2.5 py-1 rounded-md text-xs font-semibold bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 transition-all flex items-center gap-1 cursor-pointer shadow-sm"
                                aria-label={`Edit row for ${row.extracted_party || row.original_name}`}
                              >
                                <span>Edit</span>
                              </button>
                            </div>
                          </td>
                          <td className="py-2.5 px-4 align-middle text-center">
                            <button
                              type="button"
                              onClick={(e) => handleRemoveFile(row.id, e)}
                              className="p-1.5 rounded text-[var(--muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
                              title="Remove this entry from the Quick Mode export"
                              aria-label={`Remove ${row.original_name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    }

                    // MODE 3: EDIT MODE
                    if (stage === "stage2_complete" && isEditing && draft) {
                      return (
                        <tr key={`edit-${row.id}`} ref={(el) => setRowRef(row.id, el)} className="bg-[var(--card-elevated)] border-l-4 border-l-[var(--primary)] border-b border-[var(--border)]">
                          <td colSpan={9} className="p-4">
                            <div className="flex flex-col gap-4">
                              <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-[var(--foreground)]">Edit entry:</span>
                                  <span className="text-xs text-[var(--muted)] font-mono">{row.original_name}</span>
                                </div>
                                <span className="text-[10px] uppercase font-bold text-[var(--primary)] tracking-wider px-2 py-0.5 rounded bg-[var(--primary)]/10">
                                  Edit Mode
                                </span>
                              </div>

                              {/* Editable Input Fields */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                                {/* Date */}
                                <div className="flex flex-col gap-1">
                                  <label className="text-[11px] font-bold text-[var(--foreground)]">
                                    Date <span className="text-red-500">*</span>
                                  </label>
                                  <input
                                    type="date"
                                    value={draft.extracted_date}
                                    onChange={(e) => handleUpdateDraft(row.id, { extracted_date: e.target.value })}
                                    className={`px-3 py-1.5 rounded-lg border text-xs font-mono bg-[var(--card)] text-[var(--foreground)] focus:ring-2 focus:ring-[var(--primary)] outline-none ${
                                      draft.errors.extracted_date ? "border-red-500 ring-1 ring-red-500" : "border-[var(--border)]"
                                    }`}
                                    aria-label="Transaction date"
                                  />
                                  {draft.errors.extracted_date && (
                                    <span className="text-[10px] font-semibold text-red-600 dark:text-red-400 flex items-center gap-1">
                                      <AlertTriangle className="w-3 h-3 shrink-0" />
                                      <span>{draft.errors.extracted_date}</span>
                                    </span>
                                  )}
                                </div>

                                {/* Intended Payee */}
                                <div className="flex flex-col gap-1">
                                  <label className="text-[11px] font-bold text-[var(--foreground)]">
                                    Intended Payee <span className="text-red-500">*</span>
                                  </label>
                                  <input
                                    type="text"
                                    value={draft.extracted_party}
                                    placeholder="Intended Payee"
                                    autoFocus
                                    onChange={(e) => handleUpdateDraft(row.id, { extracted_party: e.target.value })}
                                    className={`px-3 py-1.5 rounded-lg border text-xs bg-[var(--card)] text-[var(--foreground)] focus:ring-2 focus:ring-[var(--primary)] outline-none ${
                                      draft.errors.extracted_party ? "border-red-500 ring-1 ring-red-500" : "border-[var(--border)]"
                                    }`}
                                    aria-label="Intended payee"
                                  />
                                  {draft.errors.extracted_party && (
                                    <span className="text-[10px] font-semibold text-red-600 dark:text-red-400 flex items-center gap-1">
                                      <AlertTriangle className="w-3 h-3 shrink-0" />
                                      <span>{draft.errors.extracted_party}</span>
                                    </span>
                                  )}
                                </div>

                                {/* Amount */}
                                <div className="flex flex-col gap-1">
                                  <label className="text-[11px] font-bold text-[var(--foreground)]">
                                    Amount (₹) <span className="text-red-500">*</span>
                                  </label>
                                  <input
                                    type="number"
                                    value={draft.extracted_amount}
                                    placeholder="Amount"
                                    step="any"
                                    onChange={(e) => handleUpdateDraft(row.id, { extracted_amount: e.target.value })}
                                    className={`px-3 py-1.5 rounded-lg border text-xs font-mono text-right bg-[var(--card)] text-[var(--foreground)] focus:ring-2 focus:ring-[var(--primary)] outline-none ${
                                      draft.errors.extracted_amount ? "border-red-500 ring-1 ring-red-500" : "border-[var(--border)]"
                                    }`}
                                    aria-label="Amount"
                                  />
                                  {draft.errors.extracted_amount && (
                                    <span className="text-[10px] font-semibold text-red-600 dark:text-red-400 flex items-center gap-1">
                                      <AlertTriangle className="w-3 h-3 shrink-0" />
                                      <span>{draft.errors.extracted_amount}</span>
                                    </span>
                                  )}
                                </div>

                                {/* Category */}
                                <div className="flex flex-col gap-1">
                                  <label className="text-[11px] font-bold text-[var(--foreground)]">
                                    Category
                                  </label>
                                  <input
                                    type="text"
                                    value={draft.guessed_category}
                                    placeholder="e.g. Supplies, Rent"
                                    onChange={(e) => handleUpdateDraft(row.id, { guessed_category: e.target.value })}
                                    className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-xs bg-[var(--card)] text-[var(--foreground)] focus:ring-2 focus:ring-[var(--primary)] outline-none"
                                    aria-label="Category"
                                  />
                                </div>
                              </div>

                              {/* Action Buttons */}
                              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
                                <button
                                  type="button"
                                  onClick={() => handleCancelEditRow(row.id)}
                                  className="px-4 py-1.5 rounded-lg text-xs font-semibold text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-muted)] transition-colors cursor-pointer"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSaveRow(row.id)}
                                  className="px-5 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold transition-all shadow-sm hover:opacity-90 cursor-pointer flex items-center gap-1.5"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Save changes</span>
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    // MODE 2: EXPANDED READ MODE
                    return (
                      <tr
                        key={`exp-${row.id}`}
                        ref={(el) => setRowRef(row.id, el)}
                        className={`border-b border-[var(--border)] transition-all ${
                          isFlagged ? "bg-amber-500/5 border-l-4 border-l-amber-500" : "bg-[var(--card-muted)]/30"
                        }`}
                      >
                        <td colSpan={9} className="p-4">
                          <div className="flex flex-col gap-4">
                            
                            {/* Flagged Row Notice Header */}
                            {isFlagged && (
                              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="flex items-start gap-2.5">
                                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                  <div>
                                    <h4 className="text-xs font-bold text-amber-900 dark:text-amber-300">
                                      Needs your review
                                    </h4>
                                    <p className="text-xs text-amber-800 dark:text-amber-400 mt-0.5 font-medium">
                                      {flaggedReason}
                                    </p>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                                  {row.extractStatus === "failed" && row.isTransientError !== false && row.errorDetail?.httpStatus !== 402 && (
                                    <button
                                      type="button"
                                      onClick={() => handleRetryRow(row.id)}
                                      className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 shadow-sm"
                                    >
                                      <RefreshCw className="w-3.5 h-3.5" />
                                      <span>Retry</span>
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleStartEditRow(row.id)}
                                    className="px-4 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 text-xs font-bold transition-colors cursor-pointer shadow-sm"
                                  >
                                    Edit row
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Detail Panel Summary Grid */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[var(--card)] p-3.5 rounded-xl border border-[var(--border)]">
                              <div>
                                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] block mb-0.5">
                                  Date
                                </span>
                                <span className="text-xs font-mono font-semibold text-[var(--foreground)]">
                                  {row.extracted_date || <span className="text-amber-600 dark:text-amber-400 italic">Missing</span>}
                                </span>
                              </div>

                              <div>
                                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] block mb-0.5">
                                  Payee / Intended Payee
                                </span>
                                <span className="text-xs font-semibold text-[var(--foreground)] truncate block" title={row.extracted_party || ""}>
                                  {row.extracted_party || <span className="text-amber-600 dark:text-amber-400 italic">Missing</span>}
                                </span>
                                {row.actual_recipient && row.actual_recipient !== row.extracted_party && (
                                  <span className="text-[9px] text-[var(--muted)] font-mono block mt-0.5">
                                    Paid to: {row.actual_recipient}
                                  </span>
                                )}
                              </div>

                              <div>
                                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] block mb-0.5">
                                  Amount
                                </span>
                                <span className="text-xs font-mono font-bold text-[var(--foreground)]">
                                  {row.extracted_amount != null ? `₹${row.extracted_amount.toLocaleString("en-IN")}` : <span className="text-amber-600 dark:text-amber-400 italic">Missing</span>}
                                </span>
                              </div>

                              <div>
                                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] block mb-0.5">
                                  Category
                                </span>
                                <span className="text-xs text-[var(--foreground)]">
                                  {row.guessed_category || "Uncategorized"}
                                </span>
                              </div>
                            </div>

                            {/* Safe Duplicate Account Warning */}
                            {isDuplicate && (
                              <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-xs text-amber-800 dark:text-amber-300 font-semibold flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                                <span>Repeated payment account in this batch — review intended payee.</span>
                              </div>
                            )}

                            {/* Actions Toolbar */}
                            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-[var(--border)]">
                              <div className="flex items-center gap-2 flex-wrap">
                                {!isFlagged && (
                                  <button
                                    type="button"
                                    onClick={() => handleStartEditRow(row.id)}
                                    className="px-3.5 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold hover:opacity-90 transition-all cursor-pointer shadow-sm"
                                  >
                                    Edit
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => toggleSplitting(row.id)}
                                  className="px-3.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-xs font-semibold text-amber-700 dark:text-amber-400 hover:bg-[var(--card-muted)] transition-colors flex items-center gap-1.5 cursor-pointer"
                                >
                                  <Split className="w-3.5 h-3.5" />
                                  <span>{row.isSplitting ? "Close Split Editor" : "Split payment across people"}</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={(e) => handleRemoveFile(row.id, e)}
                                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors flex items-center gap-1 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Remove</span>
                                </button>
                              </div>

                              <button
                                type="button"
                                onClick={() => toggleRowCollapse(row.id)}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-muted)] transition-colors flex items-center gap-1 cursor-pointer"
                                aria-expanded="true"
                                aria-label={`Collapse row for ${row.original_name}`}
                              >
                                <span>Collapse row</span>
                                <ChevronDown className="w-3.5 h-3.5 rotate-180" />
                              </button>
                            </div>

                            {/* Multi-Person Split Drawer */}
                            {row.isSplitting && (() => {
                              const val = getRowSplitValidation(row);
                              return (
                                <div className="p-4 bg-[var(--card)] rounded-xl border border-[var(--border)] flex flex-col gap-3">
                                  <div className="flex items-center justify-between text-xs font-bold text-[var(--foreground)] border-b border-[var(--border)] pb-2">
                                    <span>Split payment across people</span>
                                    <span className="text-xs font-mono font-bold text-purple-600 dark:text-purple-400">
                                      Original Total: ₹{(row.extracted_amount || 0).toLocaleString("en-IN")}
                                    </span>
                                  </div>

                                  <p className="text-xs text-[var(--muted)] italic">
                                    Use this for one lump-sum payment that covers multiple people.
                                  </p>

                                  <div className="flex flex-col gap-2">
                                    {(row.splits || []).map((s, idx) => (
                                      <div key={s.id} className="flex items-center gap-2">
                                        <span className="text-xs font-bold text-[var(--muted)] w-4 shrink-0">
                                          {idx + 1}.
                                        </span>
                                        <input
                                          type="text"
                                          placeholder="Person Name"
                                          value={s.name}
                                          onChange={(e) => handleUpdateSplitPerson(row.id, s.id, { name: e.target.value })}
                                          className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-xs text-[var(--foreground)] flex-1 min-w-0"
                                          aria-label={`Split person ${idx + 1} name`}
                                        />
                                        <input
                                          type="number"
                                          placeholder="Amount"
                                          value={s.amount ?? ""}
                                          onChange={(e) => handleUpdateSplitPerson(row.id, s.id, { amount: e.target.value ? parseFloat(e.target.value) : null })}
                                          className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] font-mono text-xs text-[var(--foreground)] w-28 text-right"
                                          aria-label={`Split person ${idx + 1} amount`}
                                        />
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveSplitPerson(row.id, s.id)}
                                          className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg cursor-pointer"
                                          title="Remove split person"
                                          aria-label={`Remove split person ${idx + 1}`}
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    ))}
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => handleAddSplitPerson(row.id)}
                                    className="text-xs font-bold text-[var(--primary)] hover:underline flex items-center gap-1 self-start mt-1 cursor-pointer"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                    <span>Add another person</span>
                                  </button>

                                  <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between text-xs font-bold">
                                    <span className="text-[var(--muted)]">
                                      Allocated: ₹{val.allocated.toLocaleString("en-IN")}
                                    </span>
                                    <span className={val.remaining !== 0 ? "text-amber-600 dark:text-amber-400 font-mono" : "text-emerald-600 dark:text-emerald-400 font-mono"}>
                                      Remaining: ₹{val.remaining.toLocaleString("en-IN")}
                                    </span>
                                  </div>

                                  {val.remaining !== 0 && (
                                    <p className="text-xs text-amber-700 dark:text-amber-400 font-semibold bg-amber-50 dark:bg-amber-500/10 p-2 rounded-lg border border-amber-200 dark:border-amber-500/20">
                                      Remaining balance must be ₹0 to complete split allocation.
                                    </p>
                                  )}

                                  <button
                                    type="button"
                                    disabled={!val.isComplete}
                                    onClick={() => toggleSplitting(row.id)}
                                    className="w-full py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    <span>Complete Split Allocation</span>
                                  </button>
                                </div>
                              );
                            })()}

                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Dev Diagnostics Expandable Panels (Safe Redacted Metadata Only) */}
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

                        {/* Redacted Safe Metadata */}
                        <div className="mt-1 p-2 bg-slate-900 rounded text-[11px] text-purple-300 border border-slate-800 flex flex-col gap-0.5">
                          <div>accountIdentifierDetected: {Boolean(row.extracted_utr) ? "true" : "false"}</div>
                          <div>identifierType: {row.extracted_utr ? "UTR" : "unknown"}</div>
                          <div>identifierFingerprint: &quot;[redacted]&quot;</div>
                          <div>retryCount: {row.retryCount || 0}</div>
                        </div>

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

              {/* Inline Expandable Error Drawers (Safe Production Messages) */}
              {files.some((r) => r.ocrStatus === "failed" || r.extractStatus === "failed") && (
                <div className="p-4 bg-red-950/20 border-t border-red-500/20 flex flex-col gap-2">
                  <div className="font-bold text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Row Failure Details</span>
                  </div>

                  {files.filter((r) => r.ocrStatus === "failed" || r.extractStatus === "failed").map((row) => (
                    <div key={`err-${row.id}`} className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs flex flex-col gap-1.5">
                      <div className="flex items-center justify-between font-semibold text-red-700 dark:text-red-400">
                        <span>{row.original_name}</span>
                        {(row.errorDetail?.retryable || row.isTransientError !== false) && row.errorDetail?.httpStatus !== 402 && (
                          <button
                            type="button"
                            onClick={() => handleRetryRow(row.id)}
                            className="px-2 py-0.5 rounded bg-red-600 text-white font-bold text-[10px] flex items-center gap-1 hover:bg-red-700 transition-colors cursor-pointer"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>Retry</span>
                          </button>
                        )}
                      </div>

                      {/* User Safe Production Message */}
                      <p className="text-xs text-red-800 dark:text-red-300">
                        {getProductionSafeErrorMessage(row)}
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
              <div className="p-4 bg-[var(--card-muted)] border-t border-[var(--border)] flex flex-col sm:flex-row items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-[var(--foreground)]">
                    Extraction complete. Ready to download clean Excel spreadsheet.
                  </div>
                  <div className="text-[11px] text-[var(--muted)] italic mt-0.5">
                    By downloading, you confirm you’ve reviewed the entries above.
                  </div>
                </div>
                {isFinalBatch ? (
                  <button
                    type="button"
                    disabled={Boolean(invalidSplitRowInBatch)}
                    onClick={handleDownloadExcel}
                    className="btn-theme-accent text-xs px-4 py-2 rounded-lg font-extrabold flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-sm shrink-0"
                    aria-label="Review complete — Generate Excel"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>Review complete — Generate Excel</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={Boolean(invalidSplitRowInBatch)}
                    onClick={() => setCurrentBatchIndex((prev) => Math.min(totalBatches - 1, prev + 1))}
                    className="px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-sm shrink-0 flex items-center gap-1.5"
                    aria-label="Review next batch"
                  >
                    <span>Review next batch</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
}
