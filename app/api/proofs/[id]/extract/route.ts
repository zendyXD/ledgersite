import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ─── OCR BOOKKEEPING EXTRACTION ENGINE ───────────
export async function extractFromImage(imageBase64: string, mimeType: string, commentContext?: string | null): Promise<{
  extracted_party: string | null;
  extracted_amount: number | null;
  extracted_date: string | null;
  extracted_text: string | null;
  guessed_category: string | null;
  guessed_type: "income" | "expense" | null;
  extraction_confidence: Record<string, string>;
}> {
  try {
    const dataPrefix = `data:${mimeType};base64,`;
    const base64ImageString = imageBase64.startsWith("data:") ? imageBase64 : dataPrefix + imageBase64;
    
    const formData = new FormData();
    formData.append("base64Image", base64ImageString);
    formData.append("language", "eng");
    // Free key fallback, can be overridden in .env
    formData.append("apikey", process.env.OCR_SPACE_API_KEY || "helloworld");

    const response = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      body: formData
    });

    const result = await response.json();
    let extractedText = "";

    if (result && !result.IsErroredOnProcessing && result.ParsedResults) {
      extractedText = result.ParsedResults.map((r: any) => r.ParsedText).join("\n").trim();
    } else {
      console.warn("OCR.space warning/error:", result);
      extractedText = `OCR Error: ${result?.ErrorMessage?.[0] || "Unknown error"}`;
    }

    let extractedParty: string | null = null;
    let extractedAmount: number | null = null;
    let extractedDate: string | null = null;

    if (extractedText) {
      // Pre-process common OCR mistakes (e.g. 'el,500' -> '1,500')
      let correctedText = extractedText.replace(/\bel,/gi, '1,').replace(/\be1,/gi, '1,');

      // 1. AMOUNT: Find the largest number that isn't a year
      let maxAmount = 0;
      const amountRegex = /(?:₹|Rs\.?|INR)?\s*(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?)/gi;
      let match;
      while ((match = amountRegex.exec(correctedText)) !== null) {
        const numStr = match[1].replace(/,/g, '');
        const num = parseFloat(numStr);
        if (num > maxAmount && num !== 2024 && num !== 2025 && num !== 2026) {
          maxAmount = num;
        }
      }
      if (maxAmount > 0) extractedAmount = maxAmount;

      // 2. DATE: Parse DD MMM YYYY safely avoiding timezone shifts
      const dateMatch = extractedText.match(/(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*(\d{2,4})/i) ||
                        extractedText.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
      if (dateMatch) {
        let year = parseInt(dateMatch[3], 10);
        if (year < 100) year += 2000;
        let monthStr = "";
        let dayStr = dateMatch[1].padStart(2, '0');
        if (dateMatch[2].match(/[a-z]/i)) {
          const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
          const mIdx = months.indexOf(dateMatch[2].toLowerCase().substring(0,3));
          monthStr = String(mIdx + 1).padStart(2, '0');
        } else {
          monthStr = dateMatch[2].padStart(2, '0');
        }
        extractedDate = `${year}-${monthStr}-${dayStr}`; // Format exactly as YYYY-MM-DD
      }

      // 3. PARTY: Stronger rule-based extraction for UPI formats
      const lines = correctedText.split('\n').map(l => l.trim()).filter(l => l);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Handle "Paid to: NAME" on same line
        const sameLineMatch = line.match(/^(?:Paid to|Sent to|To|Paying)\s*[:-]?\s*(.+)$/i);
        if (sameLineMatch && sameLineMatch[1].trim() && !sameLineMatch[1].match(/^(G Pay|PhonePe|Paytm|UPI|Bank)$/i)) {
          let partyLine = sameLineMatch[1].replace(/(?:₹|Rs\.?|INR|e[l1]|\$)\s*[\d,]+(?:\.\d{1,2})?/gi, '').trim();
          partyLine = partyLine.replace(/[\d,]+(?:\.\d{1,2})?$/, '').trim();
          if (partyLine.length > 2) {
             extractedParty = partyLine;
             break;
          }
        }

        // Handle "Paid to \n NAME"
        if (line.match(/^Paid to$/i) || line.match(/^Sent to$/i) || line.match(/^To$/i) || line.match(/^Paying$/i)) {
          for (let j = i + 1; j < lines.length; j++) {
            const nextLine = lines[j];
            if (nextLine.match(/Paid to|Sent to|To|Paying/i)) continue; // skip nested headers
            if (nextLine.match(/Transaction Successful|Processing|Pending/i)) continue;
            if (nextLine.match(/^(G Pay|PhonePe|Paytm|UPI|Bank)$/i)) continue;
            
            // Clean up the target line
            let partyLine = nextLine.replace(/(?:₹|Rs\.?|INR|e[l1]|\$)\s*[\d,]+(?:\.\d{1,2})?/gi, '').trim();
            partyLine = partyLine.replace(/[\d,]+(?:\.\d{1,2})?$/, '').trim(); 
            
            if (partyLine && partyLine.length > 2) {
              extractedParty = partyLine;
              break;
            }
          }
          if (extractedParty) break;
        }
      }

      // 4. TRANSACTION ID: Find T+digits or next line after header
      let txnId = null;
      const txnMatch = extractedText.match(/T\d{15,}/i);
      if (txnMatch) {
        txnId = txnMatch[0];
      } else {
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].match(/Transaction ID/i) && i + 1 < lines.length) {
            txnId = lines[i+1].trim();
            break;
          }
        }
      }

      // 5. UTR: Find UTR / Ref digits
      let utr = null;
      const utrMatch = extractedText.match(/(?:UTR|Ref No|UPI Ref|UPI Transaction ID|Ref\. No\.)[\s:]*(\d{10,})/i);
      if (utrMatch) {
        utr = utrMatch[1];
      }

      // 6. INJECT TXN/UTR INTO RAW TEXT FOR UI VISIBILITY
      if (txnId || utr) {
        extractedText = `--- UPI DETAILS ---\n` +
                        (txnId ? `Transaction ID: ${txnId}\n` : '') +
                        (utr ? `UTR: ${utr}\n` : '') +
                        `-------------------\n\n` + extractedText;
      }
    }

    return {
      extracted_party: extractedParty,
      extracted_amount: extractedAmount,
      extracted_date: extractedDate,
      extracted_text: extractedText || null,
      guessed_category: null,
      guessed_type: null,
      extraction_confidence: {}
    };
  } catch (err) {
    console.error("OCR.space API Error:", err);
    return {
      extracted_party: null,
      extracted_amount: null,
      extracted_date: null,
      extracted_text: `Extraction failure: ${err instanceof Error ? err.message : String(err)}`,
      guessed_category: null,
      guessed_type: null,
      extraction_confidence: {}
    };
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

    // Run extraction (mock for now, real Claude call later)
    let extractionResult;
    try {
      extractionResult = await extractFromImage(base64, mimeType, proof.comment);
    } catch {
      await supabase.from("proofs").update({ extraction_status: "failed" }).eq("id", id);
      return NextResponse.json({ message: "Extraction failed" }, { status: 500 });
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