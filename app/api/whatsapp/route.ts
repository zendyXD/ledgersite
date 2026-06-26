import { NextRequest, NextResponse } from "next/server";
import { extractFromImage } from "@/lib/extract";

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

    if (!numMedia || numMedia === "0" || !mediaUrl0) {
      await sendWhatsAppMessage(fromNumber, "Please send a payment screenshot.");
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

    // Extract using Gemini
    let extractionResult;
    try {
      extractionResult = await extractFromImage(base64Image, mimeType || "image/jpeg", bodyText);
    } catch (err) {
      console.error("Gemini extraction failed:", err);
      await sendWhatsAppMessage(fromNumber, "Failed to process image with AI. Please try again.");
      return new NextResponse(emptyTwiML, { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    const party = extractionResult.extracted_party || "Unknown";
    const amount = extractionResult.extracted_amount !== null ? extractionResult.extracted_amount : "Unknown";
    const date = extractionResult.extracted_date || "Unknown";

    const summary = `Extracted Details:\n- Party: ${party}\n- Amount: ${amount}\n- Date: ${date}`;
    await sendWhatsAppMessage(fromNumber, summary);

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
