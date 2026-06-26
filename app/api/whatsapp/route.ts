import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";

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
    const messageSid = formData.get("MessageSid") as string;

    if (!fromNumber) {
      return new NextResponse(emptyTwiML, { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    const baseUrl = getBaseUrl(request);

    // Run the bot processing in the background using waitUntil so Twilio doesn't time out
    // and Vercel knows to keep the function alive until the promise resolves.
    waitUntil(
      import("@/lib/whatsapp-bot").then(({ processWhatsAppMessage }) => {
        return processWhatsAppMessage(
          fromNumber,
          messageSid,
          bodyText,
          numMedia,
          mediaUrl0,
          mimeType,
          baseUrl
        );
      }).catch((error) => {
        console.error("Background WhatsApp process failed:", error);
      })
    );

    // Immediately return 200 OK so Twilio doesn't retry
    return new NextResponse(emptyTwiML, { status: 200, headers: { "Content-Type": "text/xml" } });
  } catch (error) {
    console.error("WhatsApp webhook error:", error);
    return new NextResponse(emptyTwiML, { status: 200, headers: { "Content-Type": "text/xml" } });
  }
}
