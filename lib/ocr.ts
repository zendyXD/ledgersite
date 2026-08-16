import { createWorker, Worker } from "tesseract.js";

export type OcrDiagnostics = {
  originalFileName?: string;
  ocrSuccess: boolean;
  rawText: string;
  dateCandidates: string[];
  normalizedDateCandidates: string[];
  amountCandidates: { raw: string; value: number }[];
  rejectedAmountCandidates: { raw: string; reason: string }[];
  selectedRoughAmount: number | null;
  selectedDate: string | null;
};

export type Stage1OcrResult = {
  success: boolean;
  hasText: boolean;
  roughAmount: number | null;
  detectedDate: string | null;
  error?: string;
  rawText?: string;
  diagnostics?: OcrDiagnostics;
};

/**
 * Reusable pool of up to 3 Tesseract.js workers.
 * Manages worker lifecycle lazily, reuses instances across queued files,
 * and handles termination on completion, clear batch, or component unmount.
 */
export class TesseractPool {
  private idleWorkers: Worker[] = [];
  private activeCount = 0;
  private maxWorkers = 3;
  private isTerminated = false;

  async acquireWorker(): Promise<Worker> {
    if (this.isTerminated) {
      throw new Error("Tesseract pool has been terminated");
    }

    if (this.idleWorkers.length > 0) {
      const worker = this.idleWorkers.pop()!;
      return worker;
    }

    if (this.activeCount < this.maxWorkers) {
      this.activeCount++;
      const worker = await createWorker("eng");
      return worker;
    }

    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (this.isTerminated) {
          clearInterval(checkInterval);
          reject(new Error("Tesseract pool has been terminated"));
          return;
        }
        if (this.idleWorkers.length > 0) {
          clearInterval(checkInterval);
          const worker = this.idleWorkers.pop()!;
          resolve(worker);
        }
      }, 50);
    });
  }

  releaseWorker(worker: Worker) {
    if (this.isTerminated) {
      worker.terminate().catch(() => {});
      return;
    }
    this.idleWorkers.push(worker);
  }

  async terminateAll() {
    this.isTerminated = true;
    const toTerminate = [...this.idleWorkers];
    this.idleWorkers = [];
    this.activeCount = 0;
    await Promise.all(toTerminate.map((w) => w.terminate().catch(() => {})));
  }

  getActiveCount(): number {
    return this.activeCount;
  }
}

/**
 * Safely parses raw OCR text into Stage 1 rough metrics and dev diagnostics.
 * Scans all candidates, applies strict rejection filters, and returns null if uncertain.
 */
export function parseStage1Metrics(
  rawText: string,
  fileName?: string
): {
  hasText: boolean;
  roughAmount: number | null;
  detectedDate: string | null;
  diagnostics: OcrDiagnostics;
} {
  const emptyDiag: OcrDiagnostics = {
    originalFileName: fileName,
    ocrSuccess: false,
    rawText: rawText || "",
    dateCandidates: [],
    normalizedDateCandidates: [],
    amountCandidates: [],
    rejectedAmountCandidates: [],
    selectedRoughAmount: null,
    selectedDate: null
  };

  if (!rawText || rawText.trim().length < 5) {
    return { hasText: false, roughAmount: null, detectedDate: null, diagnostics: emptyDiag };
  }

  const cleanText = rawText.replace(/\r\n/g, "\n");
  const dateCandidates: string[] = [];
  const normalizedDateCandidates: string[] = [];

  // 1. Date Candidate Scanning & Consistency Normalization
  // ISO format: YYYY-MM-DD
  const isoMatches = Array.from(cleanText.matchAll(/\b(20\d\d)[-/.](0[1-9]|1[0-2])[-/.](0[1-9]|[12]\d|3[01])\b/g));
  for (const m of isoMatches) {
    dateCandidates.push(m[0]);
    normalizedDateCandidates.push(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
  }

  // Indian numeric format: DD/MM/YYYY or DD-MM-YYYY
  const dmyMatches = Array.from(cleanText.matchAll(/\b(0[1-9]|[12]\d|3[01])[-/.](0[1-9]|1[0-2])[-/.](20\d\d)\b/g));
  for (const m of dmyMatches) {
    dateCandidates.push(m[0]);
    normalizedDateCandidates.push(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  }

  // Text month format: 14 Aug 2026 / 14 August 2026
  const monthNames: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
  };
  const textDateMatches = Array.from(cleanText.matchAll(/\b(0[1-9]|[12]\d|3[01])\s+([A-Za-z]{3,9})\s+(20\d\d)\b/gi));
  for (const m of textDateMatches) {
    const monKey = m[2].substring(0, 3).toLowerCase();
    if (monthNames[monKey]) {
      dateCandidates.push(m[0]);
      normalizedDateCandidates.push(`${m[3]}-${monthNames[monKey]}-${m[1].padStart(2, "0")}`);
    }
  }

  // Deduplicate dates
  const uniqueNormalizedDates = Array.from(new Set(normalizedDateCandidates)).sort();
  const selectedDate = uniqueNormalizedDates.length > 0 ? uniqueNormalizedDates[0] : null;

  // 2. Amount Candidate Scanning & Strict Rejection Classification
  const amountCandidates: { raw: string; value: number }[] = [];
  const rejectedAmountCandidates: { raw: string; reason: string }[] = [];

  // Match all numbers / currency-like tokens:
  // Branch 1: Indian comma format (e.g. 1,00,000 or 10,00,000.50)
  // Branch 2: Standard comma format (e.g. 1,000 or 10,000.50)
  // Branch 3: Greedy unformatted digits (e.g. 1000, 10000, 100000)
  // End boundary (?![0-9]) prevents partial digit truncation
  const allNumberMatches = Array.from(
    cleanText.matchAll(
      /(?:₹|Rs\.?|INR)?\s*([0-9]{1,2}(?:,[0-9]{2})*,[0-9]{3}(?:\.[0-9]{1,2})?|[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)(?![0-9])/gi
    )
  );

  for (const m of allNumberMatches) {
    const rawMatch = m[0].trim();
    const rawVal = m[1].replace(/,/g, "");
    const num = parseFloat(rawVal);

    if (!rawMatch || isNaN(num) || num <= 0) continue;

    // Check Rejection Criteria:
    // a. 12-digit UTR / UPI Reference ID
    if (/^\d{12}$/.test(rawVal)) {
      rejectedAmountCandidates.push({ raw: rawMatch, reason: "Excluded 12-digit UTR/UPI reference ID" });
      continue;
    }

    // b. 10-digit Phone Number (India 6-9 prefix)
    if (/^[6-9]\d{9}$/.test(rawVal)) {
      rejectedAmountCandidates.push({ raw: rawMatch, reason: "Excluded 10-digit mobile phone number" });
      continue;
    }

    // c. Year number (e.g. 2024, 2025, 2026)
    if (/^20\d\d$/.test(rawVal)) {
      rejectedAmountCandidates.push({ raw: rawMatch, reason: "Excluded 4-digit year number" });
      continue;
    }

    // d. Timestamp pattern nearby (e.g. 14:25:30)
    if (new RegExp(`\\b${rawVal}:\\d{2}\\b|\\b\\d{2}:${rawVal}\\b`).test(cleanText)) {
      rejectedAmountCandidates.push({ raw: rawMatch, reason: "Excluded timestamp fragment" });
      continue;
    }

    // e. Account number fragment (e.g. XXXXX1234 or A/C 1234)
    if (new RegExp(`(?:x{2,}|a/c|account)\\s*[:\\-]?\\s*${rawVal}`, "i").test(cleanText)) {
      rejectedAmountCandidates.push({ raw: rawMatch, reason: "Excluded masked account number fragment" });
      continue;
    }

    // f. Unreasonable amount (> 5,000,000)
    if (num >= 5000000) {
      rejectedAmountCandidates.push({ raw: rawMatch, reason: "Excluded amount exceeding reasonable limit" });
      continue;
    }

    // Acceptance condition: Must have currency prefix (₹/Rs/INR) OR explicit keyword (Paid/Total/Amount/Debited)
    const hasCurrencyPrefix = /(?:₹|Rs\.?|INR)/i.test(rawMatch);
    const hasKeywordContext = /(?:Paid|Total|Amount|Debited|Credited)\s*[:\-]?\s*(?:₹|Rs\.?|INR)?\s*/i.test(
      cleanText.substring(Math.max(0, cleanText.indexOf(rawMatch) - 20), cleanText.indexOf(rawMatch) + rawMatch.length + 5)
    );

    if (hasCurrencyPrefix || hasKeywordContext) {
      // Prevent duplicate additions
      if (!amountCandidates.some((c) => c.value === num)) {
        amountCandidates.push({ raw: rawMatch, value: num });
      }
    } else {
      rejectedAmountCandidates.push({ raw: rawMatch, reason: "Excluded number lacking currency symbol or payment keyword context" });
    }
  }

  // Evaluate final rough amount
  let selectedRoughAmount: number | null = null;
  if (amountCandidates.length === 1) {
    selectedRoughAmount = amountCandidates[0].value;
  } else if (amountCandidates.length > 1) {
    const firstVal = amountCandidates[0].value;
    const allIdentical = amountCandidates.every((c) => c.value === firstVal);
    if (allIdentical) {
      selectedRoughAmount = firstVal;
    } else {
      // Ambiguous multiple conflicting amounts -> return null ("Estimate unavailable")
      selectedRoughAmount = null;
    }
  }

  const diagnostics: OcrDiagnostics = {
    originalFileName: fileName,
    ocrSuccess: true,
    rawText,
    dateCandidates,
    normalizedDateCandidates: uniqueNormalizedDates,
    amountCandidates,
    rejectedAmountCandidates,
    selectedRoughAmount,
    selectedDate
  };

  return {
    hasText: true,
    roughAmount: selectedRoughAmount,
    detectedDate: selectedDate,
    diagnostics
  };
}

/**
 * Runs browser-side Tesseract.js OCR on a File using a worker from the provided pool.
 */
export async function runClientOcr(
  pool: TesseractPool,
  file: File
): Promise<Stage1OcrResult> {
  let worker: Worker | null = null;
  try {
    worker = await pool.acquireWorker();
    const fileUrl = URL.createObjectURL(file);

    try {
      const result = await worker.recognize(fileUrl);
      URL.revokeObjectURL(fileUrl);

      const parsed = parseStage1Metrics(result.data.text, file.name);
      return {
        success: true,
        hasText: parsed.hasText,
        roughAmount: parsed.roughAmount,
        detectedDate: parsed.detectedDate,
        rawText: result.data.text,
        diagnostics: parsed.diagnostics
      };
    } catch (err: unknown) {
      URL.revokeObjectURL(fileUrl);
      const msg = err instanceof Error ? err.message : "OCR failed for this image";
      return {
        success: false,
        hasText: false,
        roughAmount: null,
        detectedDate: null,
        error: msg,
        diagnostics: {
          originalFileName: file.name,
          ocrSuccess: false,
          rawText: "",
          dateCandidates: [],
          normalizedDateCandidates: [],
          amountCandidates: [],
          rejectedAmountCandidates: [],
          selectedRoughAmount: null,
          selectedDate: null
        }
      };
    } finally {
      if (worker) {
        pool.releaseWorker(worker);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to acquire OCR worker";
    return {
      success: false,
      hasText: false,
      roughAmount: null,
      detectedDate: null,
      error: msg,
      diagnostics: {
        originalFileName: file.name,
        ocrSuccess: false,
        rawText: "",
        dateCandidates: [],
        normalizedDateCandidates: [],
        amountCandidates: [],
        rejectedAmountCandidates: [],
        selectedRoughAmount: null,
        selectedDate: null
      }
    };
  }
}

/**
 * Development regression check suite testing all required amount parsing cases.
 */
export function runOcrRegressionChecks(): { input: string; expected: number; got: number | null; passed: boolean }[] {
  const testCases = [
    { input: "Paid ₹1000 to Merchant", expected: 1000 },
    { input: "Amount: Rs 10000", expected: 10000 },
    { input: "Received ₹100000 from Bank", expected: 100000 },
    { input: "Transfer ₹1,000 successful", expected: 1000 },
    { input: "Debited ₹10,000 from A/C", expected: 10000 },
    { input: "Total ₹1,00,000 paid", expected: 100000 },
    { input: "Bill amount ₹1,250.50", expected: 1250.50 }
  ];

  return testCases.map((tc) => {
    const res = parseStage1Metrics(tc.input);
    const passed = res.roughAmount === tc.expected;
    return { input: tc.input, expected: tc.expected, got: res.roughAmount, passed };
  });
}
