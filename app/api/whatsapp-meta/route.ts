export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";

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
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Verify this is from a WhatsApp Business Account
    if (body.object !== "whatsapp_business_account") {
      return new NextResponse("Not Found", { status: 404 });
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    
    // Verify phone number ID if configured
    const phoneNumberId = value?.metadata?.phone_number_id;
    if (process.env.META_PHONE_NUMBER_ID && phoneNumberId !== process.env.META_PHONE_NUMBER_ID) {
      return new NextResponse("OK", { status: 200 });
    }

    const messages = value?.messages;
    
    // Ignore status updates, we only care about messages
    if (!messages || messages.length === 0) {
      return new NextResponse("OK", { status: 200 });
    }

    const message = messages[0];
    // Prefix with whatsapp:+ to match Twilio's format that the bot expects
    const fromNumber = `whatsapp:+${message.from}`;
    const messageSid = message.id;
    
    let bodyText = "";
    let numMedia = "0";
    let mediaUrl0 = "";
    let mimeType = "";

    if (message.type === "text") {
      bodyText = message.text?.body || "";
    } else if (message.type === "image") {
      numMedia = "1";
      const image = message.image;
      mimeType = image?.mime_type || "image/jpeg";
      
      if (image?.caption) {
        bodyText = image.caption;
      }
      
      const mediaId = image?.id;
      if (mediaId && process.env.META_WHATSAPP_TOKEN) {
        try {
          // Fetch the media metadata from Meta Graph API using the media ID
          const metaRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
            headers: {
              "Authorization": `Bearer ${process.env.META_WHATSAPP_TOKEN}`
            }
          });
          
          if (metaRes.ok) {
            const metaData = await metaRes.json();
            // This is the URL to the actual media file
            mediaUrl0 = metaData.url;
          } else {
            console.error(`[WhatsApp Meta Webhook] Meta media fetch failed: ${metaRes.status}`);
          }
        } catch (e) {
          console.error("[WhatsApp Meta Webhook] Error fetching media from Meta", e);
        }
      }
    } else if (message.type === "document") {
      // Optional: Add document handling logic here if needed in the future
      return new NextResponse("OK", { status: 200 });
    }

    const baseUrl = getBaseUrl(request);

    if (fromNumber && messageSid) {
      waitUntil(
        (async () => {
          console.log(`[WhatsApp Meta Webhook] Background process started for ${fromNumber}`);
          
          let processWhatsAppMessage;
          try {
            const module = await import("@/lib/whatsapp-bot");
            processWhatsAppMessage = module.processWhatsAppMessage;
          } catch (error) {
            console.error(`[WhatsApp Meta Webhook] Failed to import whatsapp-bot for ${fromNumber}:`, error);
            return;
          }

          try {
            await processWhatsAppMessage(
              fromNumber,
              messageSid,
              bodyText,
              numMedia,
              mediaUrl0,
              mimeType,
              baseUrl
            );
            console.log(`[WhatsApp Meta Webhook] Background process completed successfully for ${fromNumber}`);
          } catch (error) {
            console.error(`[WhatsApp Meta Webhook] Error in processWhatsAppMessage for ${fromNumber}:`, error);
          }
        })()
      );
    }

    // Immediately return 200 OK so Meta doesn't retry
    return new NextResponse("OK", { status: 200 });

  } catch (error) {
    console.error("[WhatsApp Meta Webhook] Error processing request:", error);
    // Return 200 even on error to prevent Meta from retrying indefinitely
    return new NextResponse("OK", { status: 200 });
  }
}
