import { createAdminClient } from "@/lib/supabase/admin";
import { extractFromImage, reviseExtractedDetails, splitExtractedDetails } from "@/lib/extract";
import { generateLedgerExcelBuffer, generateDetailedExportBuffer } from "@/lib/excel";
import { logActivity } from "@/lib/activity_logger";
import crypto from "crypto";
import { Jimp } from "jimp";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioFrom = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";

async function sendWhatsAppMessage(to: string, body: string, mediaUrl?: string) {
  if (!accountSid || !authToken) return;
  const authHeader = "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const params = new URLSearchParams({ To: to, From: twilioFrom, Body: body });
  if (mediaUrl) {
    params.append("MediaUrl", mediaUrl);
  }

  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: { "Authorization": authHeader, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
}

// Public Beta: Send a Twilio WhatsApp typing indicator.
// If this fails or is not supported by the account, it fails silently and the bot continues.
async function sendTypingIndicator(to: string) {
  // The fallback text indicator is sent immediately alongside this attempt.
  // You may need to adjust the payload based on the exact Twilio beta documentation if this throws.
  if (!accountSid || !authToken) return;
  const authHeader = "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  
  // Note: Standard way to trigger typing in Conversations API is well known,
  // but for Programmable Messaging beta it may vary. This is a best-effort call.
  // We don't await/throw on this.
  fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: { "Authorization": authHeader, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: twilioFrom, Action: "typing" }).toString()
  }).catch(() => {});
}

export async function processWhatsAppMessage(
  fromNumber: string,
  messageSid: string,
  bodyText: string,
  numMedia: string,
  mediaUrl0: string,
  mimeType: string,
  baseUrl: string
) {
  const admin = createAdminClient();

  // 1. Deduplication using processed messages table
  const { error: dedupError } = await admin
    .from("whatsapp_processed_messages")
    .insert({ message_sid: messageSid });
    
  if (dedupError) {
    if (dedupError.code === "23505") {
      console.log(`Duplicate message ignored: ${messageSid}`);
      return; // Already processed
    }
    console.error("Dedup insert error:", dedupError);
  }

  // 2. Check if number is linked
  const { data: link, error: linkError } = await admin
    .from("whatsapp_links")
    .select("user_id")
    .eq("whatsapp_number", fromNumber)
    .single();

  if (linkError || !link) {
    const linkUrl = `${baseUrl}/dashboard/link-whatsapp?number=${encodeURIComponent(fromNumber)}`;
    await sendWhatsAppMessage(
      fromNumber,
      `Welcome to LedgerSite! Please link your WhatsApp number to save proofs automatically.\n\nGo to: ${linkUrl}`
    );
    return;
  }
  
  const userId = link.user_id;

  // 3. Load or create session
  let { data: session } = await admin
    .from("whatsapp_sessions")
    .select("*")
    .eq("whatsapp_number", fromNumber)
    .single();

  if (!session) {
    const { data: newSession } = await admin
      .from("whatsapp_sessions")
      .insert({ whatsapp_number: fromNumber, user_id: userId, current_state: "IDLE" })
      .select()
      .single();
    session = newSession;
  }

  // 4. Handle Interruptions: If it's a new image, restart session
  const hasMedia = numMedia && numMedia !== "0" && mediaUrl0;
  
  if (hasMedia) {
    if (session && session.current_state !== "IDLE") {
      await sendWhatsAppMessage(fromNumber, "New image received. Discarding previous prompt...");
    }
    await processNewProofUpload(fromNumber, userId, mediaUrl0, mimeType, bodyText, admin, messageSid);
    return;
  }

  // 5. Route based on state
  const state = session?.current_state || "IDLE";
  const command = bodyText.trim().toLowerCase();

  console.log(`[WhatsApp State Router] Sender: ${fromNumber} | State: '${state}' | Input: '${bodyText}' | Command: '${command}'`);

  if (state === "AWAITING_ACTION") {
    console.log(`[WhatsApp Bot] Entered branch: AWAITING_ACTION for ${fromNumber}`);
    if (command === "1" || command === "save") {
      const payload = session.context_data?.pending_proof_payload;
      if (payload) {
        // Move file from pending to permanent
        const oldPath = payload.file_path;
        const newPath = oldPath.replace('pending/whatsapp/', 'uploads/');
        const { error: moveError } = await admin.storage.from("proofs").move(oldPath, newPath);
        if (!moveError) {
          payload.file_path = newPath;
        }

        // Create proof
        const { data: proof, error: insertError } = await admin.from("proofs").insert(payload).select().single();
        if (proof) {
          // Create ledger draft
          await saveProofAsLedgerDraft(admin, proof, session.user_id, []);
        }
      }
      
      await admin
        .from("whatsapp_sessions")
        .update({ current_state: "IDLE", active_proof_id: null, pending_message_sid: null, context_data: {} })
        .eq("whatsapp_number", fromNumber);
        
      await sendWhatsAppMessage(fromNumber, "✅ Proof saved and draft ledger entry created!");
    } else if (command === "2" || command === "cancel" || command === "3" || command === "delete") {
      await admin
        .from("whatsapp_sessions")
        .update({ current_state: "IDLE", active_proof_id: null, pending_message_sid: null, context_data: {} })
        .eq("whatsapp_number", fromNumber);
        
      await sendWhatsAppMessage(fromNumber, "❌ Cancelled. No data was saved.");
    } else {
      // Treat this as a note to revise extracted details
      await sendTypingIndicator(fromNumber);
      await sendWhatsAppMessage(fromNumber, "Revising details based on your note... ⏳");
      
      try {
        const payload = session.context_data?.pending_proof_payload;
        if (payload) {
          const revised = await reviseExtractedDetails(payload, bodyText);
          
          payload.extracted_party = revised.extracted_party ?? payload.extracted_party;
          payload.extracted_amount = revised.extracted_amount ?? payload.extracted_amount;
          payload.extracted_date = revised.extracted_date ?? payload.extracted_date;
          payload.extracted_category = revised.guessed_category ?? payload.extracted_category;
          payload.extracted_entry_type = revised.guessed_type ?? payload.extracted_entry_type;
          // Note: we leave UTR alone
          
          await admin
            .from("whatsapp_sessions")
            .update({ context_data: { pending_proof_payload: payload } })
            .eq("whatsapp_number", fromNumber);
            
          let summary = `🧾 *Revised Details*\nParty: ${payload.extracted_party || "Unknown"}\nAmount: ₹${payload.extracted_amount || "0.00"}\nDate: ${payload.extracted_date || "Unknown"}\n`;
          if (payload.metadata?.extracted_utr) summary += `UTR/Ref: ${payload.metadata.extracted_utr}\n`;
          summary += `\nReply with *1* to Save, *2* to Cancel, or type another note to fix again.`;
          
          await sendWhatsAppMessage(fromNumber, summary);
        } else {
          await sendWhatsAppMessage(fromNumber, "Lost context. Please reply with *1* to Save or *2* to Cancel.");
        }
      } catch (err) {
        console.error("Revision error", err);
        await sendWhatsAppMessage(fromNumber, "Sorry, I had trouble understanding that. Please reply with *1* to Save, *2* to Cancel, or try your note again.");
      }
    }
  } else if (state === "AWAITING_NOTE") {
    console.log(`[WhatsApp Bot] Entered branch: AWAITING_NOTE for ${fromNumber}`);
    const skipWords = ["skip", "no", "none"];
    const userNote = skipWords.includes(command) ? "" : bodyText;
    
    const ctx = session.context_data || {};
    const filePath = ctx.pending_file_path;
    const pendingMimeType = ctx.pending_mime_type || "image/jpeg";
    const originalName = ctx.original_name || "whatsapp_upload.jpg";

    if (!filePath) {
      await admin.from("whatsapp_sessions").update({ current_state: "IDLE", context_data: {} }).eq("whatsapp_number", fromNumber);
      await sendWhatsAppMessage(fromNumber, "Sorry, I lost the image context. Please upload it again.");
      return;
    }

    await sendTypingIndicator(fromNumber);
    await sendWhatsAppMessage(fromNumber, "Extracting details... ⏳");

    const { data, error } = await admin.storage.from("proofs").download(filePath);
    if (error || !data) {
      console.error("Failed to download pending image", error);
      await admin.from("whatsapp_sessions").update({ current_state: "IDLE", context_data: {} }).eq("whatsapp_number", fromNumber);
      await sendWhatsAppMessage(fromNumber, "Sorry, I had trouble retrieving the image. Please upload it again.");
      return;
    }

    const arrayBuffer = await data.arrayBuffer();
    const imageBase64 = Buffer.from(new Uint8Array(arrayBuffer)).toString("base64");

    await runExtractionAndPreview(fromNumber, userId, messageSid, imageBase64, pendingMimeType, filePath, originalName, userNote, admin, arrayBuffer);
  } else if (state === "AWAITING_MENU_CHOICE") {
    console.log(`[WhatsApp Bot] Entered branch: AWAITING_MENU_CHOICE for ${fromNumber}`);
    if (command === "1") {
      await admin.from("whatsapp_sessions").update({ current_state: "IDLE" }).eq("whatsapp_number", fromNumber);
      await sendWhatsAppMessage(fromNumber, "Please send your payment screenshot now. 📸");
    } else if (command === "2") {
      await admin.from("whatsapp_sessions").update({ current_state: "AWAITING_MONTHLY_MONTH" }).eq("whatsapp_number", fromNumber);
      await sendWhatsAppMessage(fromNumber, "Please reply with the month and year (e.g., 'June 2026'). 📅");
    } else if (command === "3") {
      await sendWhatsAppMessage(fromNumber, "Coming next, please use Upload for now.");
    } else if (command === "4" || command === "cancel" || command === "done") {
      await admin.from("whatsapp_sessions").update({ current_state: "IDLE" }).eq("whatsapp_number", fromNumber);
      await sendWhatsAppMessage(fromNumber, "Done! Feel free to say 'hi' whenever you need the menu again. 👋");
    } else {
      await sendWhatsAppMessage(fromNumber, "Please reply with 1, 2, 3, or 4.");
    }
  } else if (state === "AWAITING_MONTHLY_MONTH") {
    console.log(`[WhatsApp Bot] Entered branch: AWAITING_MONTHLY_MONTH for ${fromNumber}`);
    if (command === "cancel") {
      await admin.from("whatsapp_sessions").update({ current_state: "IDLE" }).eq("whatsapp_number", fromNumber);
      await sendWhatsAppMessage(fromNumber, "Cancelled. Say 'hi' to see the menu again.");
      return;
    }

    const t = bodyText.trim().toLowerCase();
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    let m = null;
    let y = null;

    const mmMatch = t.match(/^(0?[1-9]|1[0-2])[\/\- ](\d{4})$/);
    if (mmMatch) {
      m = parseInt(mmMatch[1]);
      y = parseInt(mmMatch[2]);
    } else {
      for (let i = 0; i < months.length; i++) {
        if (t.startsWith(months[i])) {
          const yearMatch = t.match(/\d{4}$/);
          if (yearMatch) {
            m = i + 1;
            y = parseInt(yearMatch[0]);
            break;
          }
        }
      }
    }

    if (!m || !y) {
      await sendWhatsAppMessage(fromNumber, "I didn't understand that format. Please try again (e.g., 'June 2026' or '06/2026') or type 'cancel'.");
      return;
    }

    await sendTypingIndicator(fromNumber);
    await sendWhatsAppMessage(fromNumber, "Fetching your ledger... ⏳");

    const monthStr = `${y}-${m.toString().padStart(2, '0')}`;

    console.log(`[DEBUG] Raw input: "${bodyText}"`);
    console.log(`[DEBUG] Parsed year/month: y=${y}, m=${m}`);
    console.log(`[DEBUG] monthStr: ${monthStr}`);

    const { data: allEntries, error } = await admin
      .from("ledger_entries")
      .select("*")
      .eq("user_id", userId)
      .order("entry_date", { ascending: true });

    const entries = allEntries?.filter(e => e.entry_date?.startsWith(monthStr)) || [];
    
    console.log(`[DEBUG] Supabase error:`, error);
    console.log(`[DEBUG] Returned row count:`, entries.length);
    if (entries.length > 0) {
      console.log(`[DEBUG] First 3 entries' entry_date:`, entries.slice(0, 3).map(e => e.entry_date));
    }

    if (error || !entries || entries.length === 0) {
      await admin.from("whatsapp_sessions").update({ current_state: "IDLE" }).eq("whatsapp_number", fromNumber);
      await sendWhatsAppMessage(fromNumber, "No entries found for that month. 📉");
      return;
    }

    try {
      const monthStr = `${y}-${m.toString().padStart(2, '0')}`;
      const excelBuffer = await generateDetailedExportBuffer(entries, { month: monthStr });
      const fileName = `exports/monthly_${y}_${m}_${Date.now()}.xlsx`;
      await admin.storage.from("proofs").upload(fileName, excelBuffer, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", upsert: true });
      const { data: signedData } = await admin.storage.from("proofs").createSignedUrl(fileName, 3600);
      
      if (signedData?.signedUrl) {
        await sendWhatsAppMessage(fromNumber, `Found ${entries.length} entries. Here is your Excel export! 📊`, signedData.signedUrl);
      } else {
        await sendWhatsAppMessage(fromNumber, "Failed to sign URL for export.");
      }
    } catch (err) {
      console.error("Export failed", err);
      await sendWhatsAppMessage(fromNumber, "Failed to generate the export.");
    }

    await admin.from("whatsapp_sessions").update({ current_state: "IDLE" }).eq("whatsapp_number", fromNumber);
  } else {
    // IDLE but received text
    console.log(`[WhatsApp Bot] Entered branch: IDLE (fallback) for ${fromNumber}`);
    await admin.from("whatsapp_sessions").update({ current_state: "AWAITING_MENU_CHOICE" }).eq("whatsapp_number", fromNumber);
    const menu = `👋 *LedgerSite Home*\n\n1️⃣ Upload payment screenshot\n2️⃣ Get monthly ledger\n3️⃣ Get worker / party ledger\n4️⃣ Help / Done\n\nPlease reply with a number.`;
    await sendWhatsAppMessage(fromNumber, menu);
  }
}

async function processNewProofUpload(fromNumber: string, userId: string, mediaUrl: string, mimeType: string, bodyText: string, admin: any, messageSid: string) {
  // Send typing indicator + text status
  await sendTypingIndicator(fromNumber);
  await sendWhatsAppMessage(fromNumber, "Extracting details... ⏳");

  // Fetch image
  const authHeader = "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const mediaResponse = await fetch(mediaUrl, { headers: { Authorization: authHeader } });
  
  if (!mediaResponse.ok) {
    await sendWhatsAppMessage(fromNumber, "Failed to download your image. Please try again.");
    return;
  }

  const arrayBuffer = await mediaResponse.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    console.error("Downloaded image is 0 bytes!");
    await sendWhatsAppMessage(fromNumber, "Failed to download your image properly. Please try again.");
    return;
  }
  const base64Image = Buffer.from(new Uint8Array(arrayBuffer)).toString("base64");
  const safeName = `whatsapp-${Date.now()}.jpg`;
  const filePath = `pending/whatsapp/${safeName}`;

  // Upload to Supabase Storage
  const { error: uploadError } = await admin.storage
    .from("proofs")
    .upload(filePath, arrayBuffer, { contentType: mimeType || "image/jpeg", upsert: false });

  if (uploadError) {
    await sendWhatsAppMessage(fromNumber, "Failed to save your proof image. Please try again.");
    return;
  }

  if (!bodyText) {
    // No caption, wait for note
    await admin
      .from("whatsapp_sessions")
      .update({
        current_state: "AWAITING_NOTE",
        active_proof_id: null,
        pending_message_sid: messageSid,
        context_data: { 
          pending_file_path: filePath,
          pending_mime_type: mimeType,
          original_name: safeName
        }
      })
      .eq("whatsapp_number", fromNumber);
    await sendWhatsAppMessage(fromNumber, "Any note for this payment? Example: Rs 1500 Rakesh a/c Roshan k liye kharcha\n\nReply with note or type Skip.");
    return;
  }

  // Caption exists, run extraction immediately
  await runExtractionAndPreview(fromNumber, userId, messageSid, base64Image, mimeType, filePath, safeName, bodyText, admin, arrayBuffer);
}

async function runExtractionAndPreview(fromNumber: string, userId: string, messageSid: string, base64Image: string, mimeType: string, filePath: string, originalName: string, userNote: string, admin: any, arrayBuffer: ArrayBuffer) {
  let finalParty = null;
  let finalBeneficiary = null;
  let finalExtractedNote = null;
  let finalAmount = null;
  let finalDate = null;
  let finalUtr = null;
  let finalCategory = "Other";
  let finalType = "expense";

  try {
    const extractionResult = await extractFromImage(base64Image, mimeType || "image/jpeg", userNote);
    finalParty = extractionResult.extracted_party;
    finalBeneficiary = extractionResult.extracted_beneficiary;
    finalExtractedNote = extractionResult.extracted_note;
    finalAmount = extractionResult.extracted_amount;
    finalDate = extractionResult.extracted_date;
    finalUtr = extractionResult.extracted_utr || null;
    finalCategory = extractionResult.guessed_category || "Other";
    finalType = extractionResult.guessed_type || "expense";
  } catch (err) {
    console.error("Extraction failed", err);
    await sendWhatsAppMessage(fromNumber, "Failed to extract fields, but image was saved.");
    return;
  }

  if (finalParty === null && finalAmount === null && finalDate === null) {
    await sendWhatsAppMessage(fromNumber, "Could not extract details from this image. Please try a clearer screenshot.");
    await admin
      .from("whatsapp_sessions")
      .update({ current_state: "IDLE", active_proof_id: null, pending_message_sid: null, context_data: {} })
      .eq("whatsapp_number", fromNumber);
    return;
  }

  // Calculate hashes
  let sha256Hash = "";
  let pHash = "";
  try {
    sha256Hash = crypto.createHash("sha256").update(new Uint8Array(arrayBuffer)).digest("hex");
    const img = await Jimp.read(Buffer.from(arrayBuffer));
    pHash = img.hash(2);
  } catch (err) {
    console.error("Hashing failed", err);
  }

  let isExactDuplicate = false;

  if (finalUtr) {
    const { data: utrMatch } = await admin
      .from("proofs")
      .select("id")
      .eq("user_id", userId)
      .contains("metadata", { extracted_utr: finalUtr })
      .limit(1)
      .maybeSingle();

    if (utrMatch) {
      isExactDuplicate = true;
    }
  }

  // Build combined comment
  let finalComment = userNote || "";
  if (finalBeneficiary) {
    finalComment = `[Beneficiary: ${finalBeneficiary}] ` + finalComment;
  }

  const proofPayload = {
    user_id: userId,
    file_path: filePath,
    original_name: originalName,
    comment: finalComment.trim(),
    extracted_party: finalParty,
    extracted_amount: finalAmount,
    extracted_date: finalDate,
    extracted_category: finalCategory,
    extracted_entry_type: finalType,
    processing_status: "unprocessed",
    source: "whatsapp",
    metadata: { 
      whatsapp_sender: fromNumber,
      sha256_hash: sha256Hash,
      phash_binary: pHash,
      beneficiary: finalBeneficiary || null,
      user_note_raw: userNote || null,
      extracted_utr: finalUtr
    }
  };
  
  await admin
    .from("whatsapp_sessions")
    .update({ 
      current_state: "AWAITING_ACTION", 
      active_proof_id: null,
      pending_message_sid: messageSid,
      context_data: { pending_proof_payload: proofPayload }
    })
    .eq("whatsapp_number", fromNumber);

  if (isExactDuplicate) {
    const summary = `This image (UTR: ${finalUtr}) already exists.\n\n1️⃣ Save anyway\n2️⃣ Delete\n3️⃣ Cancel`;
    await sendWhatsAppMessage(fromNumber, summary);
  } else {
    let summary = ``;
    summary += `🧾 *Extracted Details*\nParty: ${finalParty || "Unknown"}\nAmount: ₹${finalAmount || "0.00"}\nDate: ${finalDate || "Unknown"}\n`;
    if (finalUtr) summary += `UTR/Ref: ${finalUtr}\n`;
    summary += `\n`;
    if (finalBeneficiary) summary += `Beneficiary: ${finalBeneficiary}\n\n`;
    summary += `Reply with *1* to Save, *2* to Cancel, or type a note to correct any mistakes.`;
    
    await sendWhatsAppMessage(fromNumber, summary);
  }
}

export async function saveProofAsLedgerDraft(admin: any, proof: any, userId: string, splitAllocations: any[] = []) {
  // Safe fallbacks to guarantee insert
  const entryDate = proof.extracted_date || new Date().toISOString().slice(0, 10);
  const safeAmount = proof.extracted_amount != null ? proof.extracted_amount : 0;
  const safeParty = proof.extracted_party || "Unknown Party";

  console.log(`[saveProofAsLedgerDraft] Inserting ledger_entry with Date: ${entryDate}`);
  
  const { data: insertedEntry, error: insertError } = await admin.from("ledger_entries").insert({
    user_id: userId,
    proof_id: proof.id,
    entry_date: entryDate,
    amount: safeAmount,
    entry_type: proof.extracted_entry_type || "expense",
    party_name: safeParty,
    category: proof.extracted_category || "misc",
    note: proof.comment || "",
    project_name: proof.project_name || null,
    is_split: splitAllocations.length > 0,
    split_allocations: splitAllocations
  }).select().single();

  if (insertError) {
    console.error(`[saveProofAsLedgerDraft] Ledger entry insert ERROR:`, insertError);
    await admin.from("proofs").update({ processing_status: "reviewed" }).eq("id", proof.id);
    return null;
  }

  if (insertedEntry) {
    console.log(`[saveProofAsLedgerDraft] Successfully inserted ledger_entry ID: ${insertedEntry.id}`);
    await admin.from("proofs").update({ processing_status: "linked", linked_entry_id: insertedEntry.id }).eq("id", proof.id);
    
    await logActivity(admin, {
      entity_type: "proof",
      entity_id: Number(proof.id),
      action: "draft_created",
      details: { ledger_entry_id: insertedEntry.id }
    });
    
    await logActivity(admin, {
      entity_type: "ledger_entry",
      entity_id: insertedEntry.id,
      action: "draft_created",
      details: { proof_id: proof.id }
    });
    return insertedEntry;
  }
  return null;
}
