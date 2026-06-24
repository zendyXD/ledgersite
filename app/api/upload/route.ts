import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { extractFromImage } from "../proofs/[id]/extract/route";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const admin = createAdminClient();

    // Verify authentication session first
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const comment = formData.get("comment") as string | null;
    const isQueue = formData.get("is_queue") === "true";

    if (!file) {
      return Response.json({ message: "No file provided" }, { status: 400 });
    }

    // Prepare structural storage filepaths
    const safeName = file.name.replace(/\s+/g, "-").toLowerCase();
    const filePath = `uploads/${Date.now()}-${safeName}`;

    // Upload asset to Supabase Storage bucket
    const { error: uploadError } = await admin.storage
      .from("proofs")
      .upload(filePath, file, {
        contentType: file.type || undefined,
        upsert: false,
      });

    if (uploadError) {
      return Response.json(
        {
          step: "storage-upload",
          message: uploadError.message || "Upload failed",
        },
        { status: 500 }
      );
    }

    // 1. Convert file data array to base64 directly during upload processing
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = file.type || "image/jpeg";

    let finalParty: string | null = null;
    let finalAmount: number | null = null;
    let finalDate: string | null = null;
    let finalRawText: string | null = "";
    let finalCategory: string | null = "Other";
    let finalType: string = "expense";

    try {
      const extractionResult = (await extractFromImage(base64, mimeType, comment)) as any;
      if (extractionResult) {
        finalParty = extractionResult.extracted_party;
        finalAmount = extractionResult.extracted_amount;
        finalDate = extractionResult.extracted_date;
        finalRawText = extractionResult.extracted_text;
        finalCategory = extractionResult.guessed_category;
        finalType = extractionResult.guessed_type;
      }
    } catch (aiErr) {
      console.error("Auto-extraction silent background error:", aiErr);
    }

    // 3. Insert parameters securely, auto-populating category and transaction type fields directly!
    const { data: insertedRow, error: insertError } = await admin
      .from("proofs")
      .insert({
        user_id: user.id,
        file_path: filePath,
        original_name: file.name,
        comment: comment ?? "",
        extracted_party: finalParty,
        extracted_amount: finalAmount,
        extracted_date: finalDate,
        extracted_text: finalRawText,
        extracted_category: finalCategory,
        extracted_entry_type: finalType,
        processing_status: isQueue ? "queue" : "unprocessed"
      })
      .select("id")
      .single();

    if (insertError) {
      return Response.json(
        {
          step: "db-insert",
          message: insertError.message || "Database insert failed",
        },
        { status: 500 }
      );
    }

    return Response.json({
      message: "File uploaded, auto-extracted, and saved successfully",
      id: insertedRow?.id,
      path: filePath,
      fileName: file.name,
      comment: comment ?? "",
      userId: user.id,
    });

  } catch (err) {
    console.error("UPLOAD_ROUTE_ERROR", err);
    return Response.json(
      {
        step: "server-catch",
        message: err instanceof Error ? err.message : "Unknown server error",
      },
      { status: 500 }
    );
  }
}