import { NextRequest, NextResponse } from "next/server";
import { extractFromImage } from "@/lib/extract";

const ipMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 60;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = ipMap.get(ip);

  if (!record || now > record.resetAt) {
    ipMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }

  record.count += 1;
  return false;
}

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp"
]);

export async function POST(request: NextRequest) {
  const isDev = process.env.NODE_ENV === "development";

  try {
    // 1. IP Rate Limiting Check
    const clientIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "anonymous";

    if (isRateLimited(clientIp)) {
      return NextResponse.json(
        {
          ok: false,
          stage: "stage2",
          code: "RATE_LIMIT_EXCEEDED",
          message: "Rate limit exceeded. Please wait a moment before trying again.",
          retryable: true
        },
        { status: 429 }
      );
    }

    // 2. Server-Side Payment Boundary & Development Bypass Check
    const rawBypassEnv = process.env.QUICK_MODE_DEV_BYPASS_PAYMENT;
    const isDevBypass = String(rawBypassEnv || "").trim().toLowerCase() === "true";
    const paymentToken = request.headers.get("x-payment-token");

    console.log("[QUICK_MODE_PAYMENT_CHECK_DEBUG]", {
      rawEnvValue: rawBypassEnv === undefined ? "undefined" : JSON.stringify(rawBypassEnv),
      typeOfRawEnvValue: typeof rawBypassEnv,
      isDevBypass,
      hasPaymentToken: Boolean(paymentToken)
    });

    if (!isDevBypass && !paymentToken) {
      return NextResponse.json(
        {
          ok: false,
          stage: "stage2",
          code: "PAYMENT_REQUIRED",
          message: "Payment required for full extraction. Stage 2 access denied.",
          retryable: false,
          debug: {
            rawEnvValue: rawBypassEnv === undefined ? "undefined" : String(rawBypassEnv),
            typeOfRawEnvValue: typeof rawBypassEnv,
            isDevBypass
          }
        },
        { status: 402 }
      );
    }

    // 3. Parse FormData
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        {
          ok: false,
          stage: "stage2",
          code: "NO_FILE_PROVIDED",
          message: "No file provided in form data.",
          retryable: false
        },
        { status: 400 }
      );
    }

    if (isDev) {
      console.log("[QuickExtract Server Log]", {
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        hasFile: Boolean(file)
      });
    }

    // 4. Validate File Size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          stage: "stage2",
          code: "FILE_TOO_LARGE",
          message: "File exceeds 10MB limit.",
          retryable: false
        },
        { status: 413 }
      );
    }

    // 5. Validate File Type
    const rawType = (file.type || "").toLowerCase();

    if (rawType === "image/heic" || rawType === "image/heif") {
      return NextResponse.json(
        {
          ok: false,
          stage: "stage2",
          code: "UNSUPPORTED_HEIC",
          message: "HEIC format not supported — please upload JPG, PNG, or WEBP",
          retryable: false
        },
        { status: 400 }
      );
    }

    if (rawType === "application/pdf") {
      return NextResponse.json(
        {
          ok: false,
          stage: "stage2",
          code: "UNSUPPORTED_PDF",
          message: "PDF extraction deferred — please upload JPG, PNG, or WEBP images",
          retryable: false
        },
        { status: 400 }
      );
    }

    if (!ALLOWED_IMAGE_TYPES.has(rawType)) {
      return NextResponse.json(
        {
          ok: false,
          stage: "stage2",
          code: "UNSUPPORTED_MIME_TYPE",
          message: "Unsupported file type. Please upload a JPG, PNG, or WEBP image.",
          retryable: false
        },
        { status: 400 }
      );
    }

    // 6. Convert File to Base64 in Memory
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    // 7. Call Gemini extractFromImage with a 25-second Timeout
    let extractionResult: any;
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("TIMED_OUT")), 25000)
      );

      extractionResult = await Promise.race([
        extractFromImage(base64, rawType),
        timeoutPromise
      ]);
    } catch (err: any) {
      const httpStatus = err?.status || (err?.message === "TIMED_OUT" ? 504 : 500);
      const isTimeout = err?.message === "TIMED_OUT";

      if (isDev) {
        console.error("[QuickExtract Route Error Trace]", {
          fileName: file.name,
          httpStatus,
          error: err?.sanitizedBody || err?.message || String(err)
        });
      }

      return NextResponse.json(
        {
          ok: false,
          stage: "stage2",
          code: isTimeout ? "TIMEOUT" : "EXTRACTION_FAILED",
          message: isDev
            ? (err?.sanitizedBody || err?.message || "Extraction failed")
            : (isTimeout ? "AI extraction timed out (25-second limit)" : "Extraction failed for this image"),
          httpStatus,
          retryable: true
        },
        { status: httpStatus }
      );
    }

    // 8. Return Successful JSON Response
    return NextResponse.json({
      ok: true,
      extracted_party: extractionResult?.extracted_party ?? null,
      extracted_amount: extractionResult?.extracted_amount ?? null,
      extracted_date: extractionResult?.extracted_date ?? null,
      extracted_utr: extractionResult?.extracted_utr ?? null,
      extracted_text: extractionResult?.extracted_text ?? null,
      guessed_category: extractionResult?.guessed_category ?? null,
      guessed_type: extractionResult?.guessed_type ?? "expense",
      extraction_confidence: extractionResult?.extraction_confidence ?? {}
    });

  } catch (err: any) {
    if (isDev) {
      console.error("[QuickExtract Catch Error]", err);
    }
    return NextResponse.json(
      {
        ok: false,
        stage: "stage2",
        code: "SERVER_ERROR",
        message: isDev ? (err?.message || "Server error processing file") : "Server error processing file",
        httpStatus: 500,
        retryable: true
      },
      { status: 500 }
    );
  }
}
