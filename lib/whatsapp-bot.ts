import { createAdminClient } from "@/lib/supabase/admin";
import { extractFromImage } from "@/lib/extract";

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
    if (session.current_state !== "IDLE") {
      await sendWhatsAppMessage(fromNumber, "New image received. Discarding previous prompt...");
    }
    await processNewProofUpload(fromNumber, userId, mediaUrl0, mimeType, bodyText, admin, messageSid);
    return;
  }

  // 5. Route based on state
  const state = session.current_state;
  const command = bodyText.trim().toLowerCase();

  if (state === "AWAITING_ACTION") {
    if (command === "1" || command === "save") {
      // Mark as reviewed
      if (session.active_proof_id) {
        await admin
          .from("proofs")
          .update({ processing_status: "reviewed" })
          .eq("id", session.active_proof_id);
      }
      
      // Reset state
      await admin
        .from("whatsapp_sessions")
        .update({ current_state: "IDLE", active_proof_id: null, pending_message_sid: null })
        .eq("whatsapp_number", fromNumber);
        
      await sendWhatsAppMessage(fromNumber, "✅ Proof saved successfully to your LedgerSite inbox!");
    } else if (command === "2" || command === "cancel") {
      // Cancel proof
      if (session.active_proof_id) {
        await admin.from("proofs").delete().eq("id", session.active_proof_id);
      }
      
      await admin
        .from("whatsapp_sessions")
        .update({ current_state: "IDLE", active_proof_id: null, pending_message_sid: null })
        .eq("whatsapp_number", fromNumber);
        
      await sendWhatsAppMessage(fromNumber, "❌ Proof cancelled and discarded.");
    } else {
      await sendWhatsAppMessage(fromNumber, "Please reply with *1* to Save or *2* to Cancel.");
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
  const base64Image = Buffer.from(arrayBuffer).toString("base64");
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
  const summary = `🧾 *Extracted Details*\nParty: ${finalParty || "Unknown"}\nAmount: ₹${finalAmount || "0.00"}\nDate: ${finalDate || "Unknown"}\n\nWhat would you like to do?\n1️⃣ Save\n2️⃣ Cancel`;
  await sendWhatsAppMessage(fromNumber, summary);
}
