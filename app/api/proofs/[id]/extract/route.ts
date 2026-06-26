import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ─── GEMINI VISION EXTRACTION ENGINE ───────────
export async function extractFromImage(imageBase64: string, mimeType: string, commentContext?: string | null): Promise<{
  extracted_party: string | null;
  extracted_amount: number | null;
  extracted_date: string | null;
  extracted_text: string | null;
  guessed_category: string | null;
  guessed_type: "income" | "expense" | null;
  extraction_confidence: Record<string, string>;
}> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in the environment variables.");
  }

  // Ensure base64 string doesn't contain the data URL prefix
  const base64Data = imageBase64.replace(/^data:.*?;base64,/, "");

  const prompt = `Extract bookkeeping details from the provided invoice/receipt image.
Additional context from user: ${commentContext || "None"}

Return a JSON object with EXACTLY the following fields:
- extracted_party (string or null): the person or business paid or received from.
- extracted_amount (number or null): the total amount of the transaction.
- extracted_date (string or null): the date of the transaction in YYYY-MM-DD format.
- extracted_text (string or null): all relevant text found in the image.
- guessed_category (string or null): a suggested category for this transaction (e.g., Food, Travel, Utilities, Software).
- guessed_type ("income", "expense", or null): whether this represents an income or an expense.
- extraction_confidence (object): key-value pairs of string to string indicating your confidence for each extracted field (e.g., "amount": "high").`;

  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: mimeType || "image/jpeg",
              data: base64Data
            }
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  let textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!textResponse) {
    console.error("Gemini Response Error:", JSON.stringify(result, null, 2));
    throw new Error("Gemini returned an empty or invalid response.");
  }

  // Gemini sometimes wraps JSON in markdown blocks even with responseMimeType
  textResponse = textResponse.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    const parsed = JSON.parse(textResponse);
    return {
      extracted_party: parsed.extracted_party ?? null,
      extracted_amount: parsed.extracted_amount ?? null,
      extracted_date: parsed.extracted_date ?? null,
      extracted_text: parsed.extracted_text ?? null,
      guessed_category: parsed.guessed_category ?? null,
      guessed_type: (parsed.guessed_type === "income" || parsed.guessed_type === "expense") ? parsed.guessed_type : "expense",
      extraction_confidence: parsed.extraction_confidence ?? {}
    };
  } catch (err) {
    console.error("Failed to parse Gemini JSON output. Raw text:", textResponse);
    throw new Error("Failed to parse Gemini JSON output: " + (err instanceof Error ? err.message : String(err)));
  }
}
// ─── ROUTE ────────────────────────────────────────────────────────────────────
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const admin = createAdminClient();

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Fetch proof
    const { data: proof, error: proofError } = await supabase
      .from("proofs")
      .select("id, user_id, file_path, original_name, comment")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (proofError || !proof) {
      return NextResponse.json({ message: "Proof not found" }, { status: 404 });
    }

    if (!proof.file_path) {
      return NextResponse.json({ message: "Proof has no file" }, { status: 400 });
    }


    // Download file from Supabase Storage
    const { data: fileData, error: downloadError } = await admin.storage
      .from("proofs")
      .download(proof.file_path);

    if (downloadError || !fileData) {
      await supabase.from("proofs").update({ extraction_status: "failed" }).eq("id", id);
      return NextResponse.json({ message: "Failed to download proof file" }, { status: 500 });
    }

    // Convert to base64
    const arrayBuffer = await fileData.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = fileData.type || "image/jpeg";

    // Run extraction
    let extractionResult;
    try {
      extractionResult = await extractFromImage(base64, mimeType, proof.comment);
    } catch (error) {
      console.error("Extraction process failed:", error);
      await supabase.from("proofs").update({ extraction_status: "failed" }).eq("id", id);
      return NextResponse.json({ message: "Extraction failed", error: String(error) }, { status: 500 });
    }

    // Save results back to proof row without hitting the non-existent extraction_status column
    const { data: updatedProof, error: updateError } = await admin
      .from("proofs")
      .update({
        // We only save columns that actually exist in your Supabase schema!
        extracted_party: extractionResult.extracted_party,
        extracted_amount: extractionResult.extracted_amount,
        extracted_date: extractionResult.extracted_date,
        extracted_text: extractionResult.extracted_text,
        extracted_category: extractionResult.guessed_category,
        extracted_entry_type: extractionResult.guessed_type,
        extraction_confidence: extractionResult.extraction_confidence,
      })
      .eq("id", id)
      .select("id, extracted_party, extracted_amount, extracted_date, extracted_text, extracted_category, extracted_entry_type, extraction_confidence")
      .single();
   if (updateError) {
      // PRINT DETAILED POSTGRES SCHEMA ERRORS DIRECTLY TO YOUR RUNNING SERVER TERMINAL LOGS
      console.error("SUPABASE_ROW_UPDATE_DATABASE_FAIL:", {
        code: updateError.code,
        message: updateError.message,
        details: updateError.details,
        hint: updateError.hint
      });

      return Response.json({ 
        message: `Failed to save extraction results: ${updateError.message || "Schema constraint mismatch"}` 
      }, { status: 500 });
    }

    return Response.json({
      message: "Extraction complete",
      proof: {
        ...updatedProof,
        // Manually append the status so your frontend UI hooks switch from "Extracting..." to finished safely
        extraction_status: "extracted"
      },
    });

  } catch (error) {
    console.error("POST /api/proofs/[id]/extract error:", error);
    
    // Safety fallback state sync: reset extraction status on database failure
    try {
      const { id } = await params;
      const supabase = await createClient();
      await supabase.from("proofs").update({ extraction_status: "failed" }).eq("id", id);
    } catch (silentErr) {
      console.error("Failed to safely reset status to failed:", silentErr);
    }

    return Response.json({ message: "Internal server error executing extraction" }, { status: 500 });
  }
}