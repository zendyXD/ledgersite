import { createWorker, Worker } from "tesseract.js";

export type Stage1OcrResult = {
  success: boolean;
  hasText: boolean;
  roughAmount: number | null;
  detectedDate: string | null;
  error?: string;
  rawText?: string;
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

    // Reuse existing idle worker
    if (this.idleWorkers.length > 0) {
      const worker = this.idleWorkers.pop()!;
      return worker;
    }

    // Create new worker if under max limit
    if (this.activeCount < this.maxWorkers) {
      this.activeCount++;
      const worker = await createWorker("eng");
      return worker;
    }

    // Wait for an idle worker if max workers reached
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
 * Safely parses raw OCR text into Stage 1 rough metrics.
 * Does not sum numbers or guess uncertain values. Returns null for amount if uncertain.
 */
export function parseStage1Metrics(rawText: string): {
  hasText: boolean;
  roughAmount: number | null;
  detectedDate: string | null;
} {
  if (!rawText || rawText.trim().length < 5) {
    return { hasText: false, roughAmount: null, detectedDate: null };
  }

  const cleanText = rawText.replace(/\r\n/g, "\n");

  // 1. Date Detection
  let detectedDate: string | null = null;
  const isoMatch = cleanText.match(/\b(20\d\d)[-/.](0[1-9]|1[0-2])[-/.](0[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) {
    detectedDate = `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
  } else {
    const dmyMatch = cleanText.match(/\b(0[1-9]|[12]\d|3[01])[-/.](0[1-9]|1[0-2])[-/.](20\d\d)\b/);
    if (dmyMatch) {
      detectedDate = `${dmyMatch[3]}-${dmyMatch[2].padStart(2, "0")}-${dmyMatch[1].padStart(2, "0")}`;
    } else {
      const monthNames: Record<string, string> = {
        jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
        jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
      };
      const textDateMatch = cleanText.match(/\b(0[1-9]|[12]\d|3[01])\s+([A-Za-z]{3,9})\s+(20\d\d)\b/i);
      if (textDateMatch) {
        const monKey = textDateMatch[2].substring(0, 3).toLowerCase();
        if (monthNames[monKey]) {
          detectedDate = `${textDateMatch[3]}-${monthNames[monKey]}-${textDateMatch[1].padStart(2, "0")}`;
        }
      }
    }
  }

  // 2. Rough Amount Detection
  const validAmounts: number[] = [];

  // Match explicit currency symbols ₹, Rs., Rs, INR followed by amount
  const currencyMatches = Array.from(
    cleanText.matchAll(/(?:₹|Rs\.?|INR)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/gi)
  );

  for (const m of currencyMatches) {
    const rawVal = m[1].replace(/,/g, "");
    const num = parseFloat(rawVal);
    // Ignore UTRs (12 digit numbers), phone numbers (10 digits), year numbers, or unreasonable amounts (> 50L)
    if (!isNaN(num) && num > 0 && num < 5000000 && !/^\d{10,12}$/.test(rawVal)) {
      validAmounts.push(num);
    }
  }

  // Secondary: Match keywords "Paid", "Total", "Amount", "Debited", "Credited"
  if (validAmounts.length === 0) {
    const keywordMatches = Array.from(
      cleanText.matchAll(/(?:Paid|Total|Amount|Debited|Credited)\s*[:\-]?\s*(?:₹|Rs\.?|INR)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/gi)
    );
    for (const m of keywordMatches) {
      const rawVal = m[1].replace(/,/g, "");
      const num = parseFloat(rawVal);
      if (!isNaN(num) && num > 0 && num < 5000000 && !/^\d{10,12}$/.test(rawVal)) {
        validAmounts.push(num);
      }
    }
  }

  let roughAmount: number | null = null;
  if (validAmounts.length === 1) {
    roughAmount = validAmounts[0];
  } else if (validAmounts.length > 1) {
    const first = validAmounts[0];
    const allSame = validAmounts.every((v) => v === first);
    if (allSame) {
      roughAmount = first;
    } else {
      roughAmount = null; // Uncertain due to conflicting amounts
    }
  }

  return {
    hasText: true,
    roughAmount,
    detectedDate
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

      const parsed = parseStage1Metrics(result.data.text);
      return {
        success: true,
        hasText: parsed.hasText,
        roughAmount: parsed.roughAmount,
        detectedDate: parsed.detectedDate,
        rawText: result.data.text
      };
    } catch (err: unknown) {
      URL.revokeObjectURL(fileUrl);
      const msg = err instanceof Error ? err.message : "OCR failed for this image";
      return {
        success: false,
        hasText: false,
        roughAmount: null,
        detectedDate: null,
        error: msg
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
      error: msg
    };
  }
}
