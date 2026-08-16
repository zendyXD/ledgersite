import { NextRequest, NextResponse } from "next/server";
import { extractFromImage } from "@/lib/extract";

// Basic in-memory IP rate limiter for MVP protection.
// Note: In Vercel serverless deployments, in-memory state is per-instance and not globally consistent.
const ipMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 60; // 60 extractions/min per IP

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
  try {
    // 1. IP Rate Limiting Check
    const clientIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "anonymous";

    if (isRateLimited(clientIp)) {
      return NextResponse.json(
        { message: "Rate limit exceeded. Please wait a moment before trying again." },
        { status: 429 }
      );
    }

    // 1.5 Server-Side Payment Boundary & Development Bypass Check
    const isDevBypass = process.env.QUICK_MODE_DEV_BYPASS_PAYMENT === "true";
    const paymentToken = request.headers.get("x-payment-token");

    if (!isDevBypass && !paymentToken) {
      return NextResponse.json(
        { message: "Payment required for full extraction. Stage 2 access denied." },
        { status: 402 }
      );
    }

    // 2. Parse FormData
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ message: "No file provided" }, { status: 400 });
    }

    // 3. Validate File Size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { message: "File exceeds 10MB limit" },
        { status: 413 }
      );
    }

    // 4. Validate File Type
    const rawType = (file.type || "").toLowerCase();

    if (rawType === "image/heic" || rawType === "image/heif") {
      return NextResponse.json(
        { message: "HEIC format not supported — please upload JPG, PNG, or WEBP" },
        { status: 400 }
      );
    }

    if (rawType === "application/pdf") {
      return NextResponse.json(
        { message: "PDF extraction deferred — please upload JPG, PNG, or WEBP images" },
        { status: 400 }
      );
    }

    if (!ALLOWED_IMAGE_TYPES.has(rawType)) {
      return NextResponse.json(
        { message: "Unsupported file type. Please upload a JPG, PNG, or WEBP image." },
        { status: 400 }
      );
    }

    // 5. Convert File to Base64 in Memory
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    // 6. Call Gemini extractFromImage with a 25-second Timeout
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
      console.error("[QuickExtract] AI Extraction Error:", err);
      if (err?.message === "TIMED_OUT") {
        return NextResponse.json(
          { message: "AI extraction timed out (25-second limit)" },
          { status: 504 }
        );
      }
      // Sanitized error response (no API keys or raw Gemini stack traces exposed)
      return NextResponse.json(
        { message: "Extraction failed for this image" },
        { status: 500 }
      );
    }

    // 7. Return Sanitized JSON Response
    return NextResponse.json({
      extracted_party: extractionResult?.extracted_party ?? null,
      extracted_amount: extractionResult?.extracted_amount ?? null,
      extracted_date: extractionResult?.extracted_date ?? null,
      extracted_utr: extractionResult?.extracted_utr ?? null,
      extracted_text: extractionResult?.extracted_text ?? null,
      guessed_category: extractionResult?.guessed_category ?? null,
      guessed_type: extractionResult?.guessed_type ?? "expense",
      extraction_confidence: extractionResult?.extraction_confidence ?? {}
    });

  } catch (err) {
    console.error("[QuickExtract] Route Server Catch Error:", err);
    return NextResponse.json(
      { message: "Server error processing file" },
      { status: 500 }
    );
  }
}
