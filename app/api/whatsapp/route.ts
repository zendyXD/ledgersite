import { NextRequest, NextResponse } from "next/server";
import { extractFromImage } from "@/lib/extract";
import { createAdminClient } from "@/lib/supabase/admin";

const emptyTwiML = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

async function sendWhatsAppMessage(to: string, body: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";

  if (!accountSid || !authToken) {
    console.error("Missing Twilio credentials for reply");
    return;
  }

  const authHeader = "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const params = new URLSearchParams({
    To: to,
    From: from,
    Body: body
  });

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`Twilio reply failed: ${res.status} ${errorText}`);
    throw new Error(`Twilio reply failed: ${res.status}`);
  }
}

function getBaseUrl(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  }
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/$/, '');
  }
  const origin = request.headers.get("origin");
  if (origin) {
    return origin;
  }
  // Fallback to construct from URL
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function POST(request: NextRequest) {
  let fromNumber = "";
  try {
    const formData = await request.formData();
    
    fromNumber = formData.get("From") as string;
    const numMedia = formData.get("NumMedia") as string;
    const mediaUrl0 = formData.get("MediaUrl0") as string;
    const mimeType = formData.get("MediaContentType0") as string;
    const bodyText = formData.get("Body") as string;

    if (!fromNumber) {
      return new NextResponse(emptyTwiML, { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    const admin = createAdminClient();

    // 1. Check if the WhatsApp number is linked
    const { data: link, error: linkError } = await admin
      .from("whatsapp_links")
      .select("user_id")
      .eq("whatsapp_number", fromNumber)
      .single();

    if (linkError || !link) {
      // User is not linked
      const baseUrl = getBaseUrl(request);
      const linkUrl = `${baseUrl}/dashboard/link-whatsapp?number=${encodeURIComponent(fromNumber)}`;
      await sendWhatsAppMessage(
        fromNumber, 
        `Welcome to LedgerSite! Please link your WhatsApp number to save proofs automatically.\n\nGo to: ${linkUrl}`
      );
      return new NextResponse(emptyTwiML, { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    const linkedUserId = link.user_id;

    if (!numMedia || numMedia === "0" || !mediaUrl0) {
      await sendWhatsAppMessage(fromNumber, "Please send a payment screenshot to save it as a proof in your LedgerSite account.");
      return new NextResponse(emptyTwiML, { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    // Fetch the media from Twilio
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      console.error("Missing Twilio credentials for media download");
      return new NextResponse(emptyTwiML, { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    const authHeader = "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const mediaResponse = await fetch(mediaUrl0, {
      headers: { Authorization: authHeader },
    });

    if (!mediaResponse.ok) {
      console.error("Failed to download media:", mediaResponse.statusText);
      await sendWhatsAppMessage(fromNumber, "Failed to download your image. Please try again.");
      return new NextResponse(emptyTwiML, { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    const arrayBuffer = await mediaResponse.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString("base64");
    const safeName = `whatsapp-${Date.now()}.jpg`;
    const filePath = `uploads/${safeName}`;

    // Upload asset to Supabase Storage bucket
    const { error: uploadError } = await admin.storage
      .from("proofs")
      .upload(filePath, arrayBuffer, {
        contentType: mimeType || "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      console.error("Failed to upload to storage:", uploadError);
      await sendWhatsAppMessage(fromNumber, "Failed to save your proof. Please try again.");
      return new NextResponse(emptyTwiML, { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    // Extract using Gemini
    let finalParty: string | null = null;
    let finalAmount: number | null = null;
    let finalDate: string | null = null;
    let finalRawText: string | null = "";
    let finalCategory: string | null = "Other";
    let finalType: string = "expense";
    let extractionStatus = "unprocessed";

    try {
      const extractionResult = (await extractFromImage(base64Image, mimeType || "image/jpeg", bodyText)) as any;
      if (extractionResult) {
        finalParty = extractionResult.extracted_party;
        finalAmount = extractionResult.extracted_amount;
        finalDate = extractionResult.extracted_date;
        finalRawText = extractionResult.extracted_text;
        finalCategory = extractionResult.guessed_category;
        finalType = extractionResult.guessed_type;
        extractionStatus = "extracted";
      }
    } catch (err) {
      console.error("Gemini extraction failed:", err);
      // We still save the proof even if extraction fails
      extractionStatus = "failed";
    }

    // Insert into proofs table
    const { error: insertError } = await admin
      .from("proofs")
      .insert({
        user_id: linkedUserId,
        file_path: filePath,
        original_name: "WhatsApp Upload",
        comment: bodyText || "",
        extracted_party: finalParty,
        extracted_amount: finalAmount,
        extracted_date: finalDate,
        extracted_text: finalRawText,
        extracted_category: finalCategory,
        extracted_entry_type: finalType,
        processing_status: extractionStatus === "failed" ? "failed" : "unprocessed"
      });

    if (insertError) {
      console.error("Failed to insert proof:", insertError);
      await sendWhatsAppMessage(fromNumber, "Failed to save proof to your account. Please try again.");
      return new NextResponse(emptyTwiML, { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    await sendWhatsAppMessage(fromNumber, "Proof received and saved to your LedgerSite inbox.");

    return new NextResponse(emptyTwiML, { status: 200, headers: { "Content-Type": "text/xml" } });
  } catch (error) {
    console.error("WhatsApp webhook error:", error);
    // Attempt to notify user of failure if we have their number
    if (fromNumber) {
      try {
        await sendWhatsAppMessage(fromNumber, "An unexpected error occurred. Please try again.");
      } catch (replyErr) {
        console.error("Failed to send fallback error message", replyErr);
      }
    }
    return new NextResponse(emptyTwiML, { status: 200, headers: { "Content-Type": "text/xml" } });
  }
}
