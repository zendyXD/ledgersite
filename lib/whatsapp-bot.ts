import { createAdminClient } from "@/lib/supabase/admin";
import { extractFromImage, reviseExtractedDetails, splitExtractedDetails } from "@/lib/extract";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioFrom = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";

async function sendWhatsAppMessage(to: string, body: string) {
  if (!accountSid || !authToken) return;
  const authHeader = "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const params = new URLSearchParams({ To: to, From: twilioFrom, Body: body });

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

  if (state === "AWAITING_ACTION") {
    if (command === "1" || command === "save") {
      // Check for split allocations
      const contextData = session.context_data || {};
      const splitAllocations = contextData.split_allocations;

      if (splitAllocations && splitAllocations.length > 0 && session.active_proof_id) {
        // Fetch the proof to link it
        const { data: proof } = await admin.from("proofs").select("*").eq("id", session.active_proof_id).single();
        if (proof) {
          const entryDate = proof.extracted_date || new Date().toISOString().slice(0, 10);
          
          // Create ledger entry
          const { data: insertedEntry } = await admin.from("ledger_entries").insert({
            user_id: session.user_id,
            proof_id: proof.id,
            entry_date: entryDate,
            amount: proof.extracted_amount,
            entry_type: proof.extracted_entry_type || "expense",
            party_name: proof.extracted_party,
            category: proof.extracted_category || "misc",
            note: proof.comment || "",
            is_split: true,
            split_allocations: splitAllocations
          }).select().single();

          if (insertedEntry) {
            await admin.from("proofs").update({ processing_status: "linked", linked_entry_id: insertedEntry.id }).eq("id", proof.id);
          }
        }
        await admin
          .from("whatsapp_sessions")
          .update({ current_state: "IDLE", active_proof_id: null, pending_message_sid: null, context_data: {} })
          .eq("whatsapp_number", fromNumber);
        await sendWhatsAppMessage(fromNumber, "✅ Split Ledger draft created successfully!");
      } else {
        // Normal save
        if (session.active_proof_id) {
          await admin
            .from("proofs")
            .update({ processing_status: "reviewed" })
            .eq("id", session.active_proof_id);
        }
        await admin
          .from("whatsapp_sessions")
          .update({ current_state: "IDLE", active_proof_id: null, pending_message_sid: null, context_data: {} })
          .eq("whatsapp_number", fromNumber);
        await sendWhatsAppMessage(fromNumber, "✅ Proof saved successfully to your LedgerSite inbox!");
      }
    } else if (command === "2" || command === "edit") {
      await admin
        .from("whatsapp_sessions")
        .update({ current_state: "AWAITING_EDIT" })
        .eq("whatsapp_number", fromNumber);
        
      await sendWhatsAppMessage(fromNumber, "Please send your correction (e.g., 'Amount is 500' or 'Party is Uber').");
    } else if (command === "3" || command === "split") {
      await admin
        .from("whatsapp_sessions")
        .update({ current_state: "AWAITING_SPLIT" })
        .eq("whatsapp_number", fromNumber);
        
      await sendWhatsAppMessage(fromNumber, "Please send your split instructions (e.g., '200 for food, 300 for travel').");
    } else if (command === "4" || command === "cancel") {
      // Cancel proof
      if (session.active_proof_id) {
        await admin.from("proofs").delete().eq("id", session.active_proof_id);
      }
      
      await admin
        .from("whatsapp_sessions")
        .update({ current_state: "IDLE", active_proof_id: null, pending_message_sid: null, context_data: {} })
        .eq("whatsapp_number", fromNumber);
        
      await sendWhatsAppMessage(fromNumber, "❌ Proof cancelled and discarded.");
    } else {
      await sendWhatsAppMessage(fromNumber, "Please reply with *1* to Save, *2* to Edit, *3* to Split, or *4* to Cancel.");
    }
  } else if (state === "AWAITING_EDIT") {
    if (command === "cancel") {
      if (session.active_proof_id) {
        await admin.from("proofs").delete().eq("id", session.active_proof_id);
      }
      await admin
        .from("whatsapp_sessions")
        .update({ current_state: "IDLE", active_proof_id: null, pending_message_sid: null })
        .eq("whatsapp_number", fromNumber);
      await sendWhatsAppMessage(fromNumber, "❌ Edit cancelled. Proof discarded.");
      return;
    }

    if (!session.active_proof_id) {
      await admin.from("whatsapp_sessions").update({ current_state: "IDLE" }).eq("whatsapp_number", fromNumber);
      await sendWhatsAppMessage(fromNumber, "Session expired or proof not found. Please send a new image.");
      return;
    }

    await sendTypingIndicator(fromNumber);
    await sendWhatsAppMessage(fromNumber, "Applying corrections... ⏳");

    // Fetch existing proof
    const { data: proof } = await admin.from("proofs").select("*").eq("id", session.active_proof_id).single();
    if (!proof) {
      await admin.from("whatsapp_sessions").update({ current_state: "IDLE", active_proof_id: null }).eq("whatsapp_number", fromNumber);
      await sendWhatsAppMessage(fromNumber, "Proof not found. Please send a new image.");
      return;
    }

    const currentFields = {
      extracted_party: proof.extracted_party,
      extracted_amount: proof.extracted_amount,
      extracted_date: proof.extracted_date,
      guessed_category: proof.extracted_category,
      guessed_type: proof.extracted_entry_type
    };

    try {
      const revised = await reviseExtractedDetails(currentFields, bodyText);
      
      // Update proof
      await admin.from("proofs").update({
        extracted_party: revised.extracted_party,
        extracted_amount: revised.extracted_amount,
        extracted_date: revised.extracted_date,
        extracted_category: revised.guessed_category || proof.extracted_category,
        extracted_entry_type: revised.guessed_type || proof.extracted_entry_type
      }).eq("id", proof.id);

      // Return to AWAITING_ACTION
      await admin.from("whatsapp_sessions").update({ current_state: "AWAITING_ACTION" }).eq("whatsapp_number", fromNumber);

      const summary = `🧾 *Revised Details*\nParty: ${revised.extracted_party || "Unknown"}\nAmount: ₹${revised.extracted_amount || "0.00"}\nDate: ${revised.extracted_date || "Unknown"}\n\nWhat would you like to do?\n1️⃣ Save\n2️⃣ Edit\n3️⃣ Split\n4️⃣ Cancel`;
      await sendWhatsAppMessage(fromNumber, summary);
    } catch (err) {
      console.error("Revision failed", err);
      await sendWhatsAppMessage(fromNumber, "Failed to apply corrections. Please try again or type 'cancel' to abort.");
    }
  } else if (state === "AWAITING_SPLIT") {
    if (command === "cancel") {
      if (session.active_proof_id) {
        await admin.from("proofs").delete().eq("id", session.active_proof_id);
      }
      await admin
        .from("whatsapp_sessions")
        .update({ current_state: "IDLE", active_proof_id: null, pending_message_sid: null, context_data: {} })
        .eq("whatsapp_number", fromNumber);
      await sendWhatsAppMessage(fromNumber, "❌ Split cancelled. Proof discarded.");
      return;
    }

    if (!session.active_proof_id) {
      await admin.from("whatsapp_sessions").update({ current_state: "IDLE", context_data: {} }).eq("whatsapp_number", fromNumber);
      await sendWhatsAppMessage(fromNumber, "Session expired or proof not found. Please send a new image.");
      return;
    }

    await sendTypingIndicator(fromNumber);
    await sendWhatsAppMessage(fromNumber, "Splitting amounts... ⏳");

    const { data: proof } = await admin.from("proofs").select("*").eq("id", session.active_proof_id).single();
    if (!proof) {
      await admin.from("whatsapp_sessions").update({ current_state: "IDLE", active_proof_id: null, context_data: {} }).eq("whatsapp_number", fromNumber);
      await sendWhatsAppMessage(fromNumber, "Proof not found. Please send a new image.");
      return;
    }

    const currentFields = {
      extracted_party: proof.extracted_party,
      extracted_amount: proof.extracted_amount,
      extracted_date: proof.extracted_date,
      guessed_category: proof.extracted_category,
      guessed_type: proof.extracted_entry_type
    };

    try {
      const splitResult = await splitExtractedDetails(currentFields, bodyText);
      const splits = splitResult.splits || [];
      
      const totalSplitAmount = splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
      const originalAmount = Number(proof.extracted_amount) || 0;

      // Allow a tiny tolerance for floating point math
      if (Math.abs(totalSplitAmount - originalAmount) > 1.0) {
        await sendWhatsAppMessage(fromNumber, `⚠️ The total of your splits (₹${totalSplitAmount}) does not match the proof amount (₹${originalAmount}). Please send a new split instruction or type 'cancel'.`);
        return;
      }

      await admin.from("whatsapp_sessions").update({ 
        current_state: "AWAITING_ACTION",
        context_data: { ...session.context_data, split_allocations: splits }
      }).eq("whatsapp_number", fromNumber);

      let splitText = `🧾 *Split Preview*\n`;
      splits.forEach((s, i) => {
        splitText += `${i + 1}. ₹${s.amount || 0} - ${s.category || "Misc"} (${s.party_name || proof.extracted_party || "Unknown"})\n`;
      });
      splitText += `\nWhat would you like to do?\n1️⃣ Save\n2️⃣ Edit\n3️⃣ Split\n4️⃣ Cancel`;

      await sendWhatsAppMessage(fromNumber, splitText);
    } catch (err) {
      console.error("Split failed", err);
      await sendWhatsAppMessage(fromNumber, "Failed to split amounts. Please try again or type 'cancel' to abort.");
    }
  } else {
    // IDLE but received text
    await sendWhatsAppMessage(fromNumber, "Send a payment screenshot to automatically extract and save it as a proof in LedgerSite.");
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
  const filePath = `uploads/${safeName}`;

  // Upload to Supabase Storage
  const { error: uploadError } = await admin.storage
    .from("proofs")
    .upload(filePath, arrayBuffer, { contentType: mimeType || "image/jpeg", upsert: false });

  if (uploadError) {
    await sendWhatsAppMessage(fromNumber, "Failed to save your proof image. Please try again.");
    return;
  }

  // Extract
  let finalParty = null;
  let finalAmount = null;
  let finalDate = null;
  let finalCategory = "Other";
  let finalType = "expense";

  try {
    const extractionResult = await extractFromImage(base64Image, mimeType || "image/jpeg", bodyText);
    finalParty = extractionResult.extracted_party;
    finalAmount = extractionResult.extracted_amount;
    finalDate = extractionResult.extracted_date;
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

  // Insert into proofs
  const { data: insertedProof, error: insertError } = await admin
    .from("proofs")
    .insert({
      user_id: userId,
      file_path: filePath,
      original_name: "WhatsApp Upload",
      comment: bodyText || "",
      extracted_party: finalParty,
      extracted_amount: finalAmount,
      extracted_date: finalDate,
      extracted_category: finalCategory,
      extracted_entry_type: finalType,
      processing_status: "unprocessed",
      source: "whatsapp",
      metadata: { whatsapp_sender: fromNumber }
    })
    .select()
    .single();

  if (insertError) {
    await sendWhatsAppMessage(fromNumber, "Failed to create proof record in database.");
    return;
  }

  // Update session to AWAITING_ACTION
  await admin
    .from("whatsapp_sessions")
    .update({ 
      current_state: "AWAITING_ACTION", 
      active_proof_id: insertedProof.id,
      pending_message_sid: messageSid
    })
    .eq("whatsapp_number", fromNumber);

  // Send summary
  const summary = `🧾 *Extracted Details*\nParty: ${finalParty || "Unknown"}\nAmount: ₹${finalAmount || "0.00"}\nDate: ${finalDate || "Unknown"}\n\nWhat would you like to do?\n1️⃣ Save\n2️⃣ Edit\n3️⃣ Split\n4️⃣ Cancel`;
  await sendWhatsAppMessage(fromNumber, summary);
}
