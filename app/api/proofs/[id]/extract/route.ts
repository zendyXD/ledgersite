import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

import { extractFromImage } from "@/lib/extract";
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