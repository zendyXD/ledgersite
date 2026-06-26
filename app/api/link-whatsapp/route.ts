import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { whatsappNumber } = body;

    if (!whatsappNumber) {
      return Response.json({ message: "WhatsApp number is required" }, { status: 400 });
    }

    // Check if user already has a linked number
    const { data: existingLink, error: fetchError } = await supabase
      .from("whatsapp_links")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (fetchError) {
      console.error("whatsapp_links fetch error:", fetchError);
      return Response.json({ message: "Database lookup failed." }, { status: 500 });
    }

    let resultError;

    if (existingLink) {
      // Update existing record
      const { error } = await supabase
        .from("whatsapp_links")
        .update({ whatsapp_number: whatsappNumber })
        .eq("user_id", user.id);
      resultError = error;
    } else {
      // Insert new record
      const { error } = await supabase
        .from("whatsapp_links")
        .insert({ user_id: user.id, whatsapp_number: whatsappNumber });
      resultError = error;
    }

    if (resultError) {
      console.error("whatsapp_links save error:", resultError);
      if (resultError.code === '23505') { // Unique violation
        return Response.json({ message: "This WhatsApp number is already linked to another account." }, { status: 400 });
      }
      return Response.json({ message: "Failed to link WhatsApp number." }, { status: 500 });
    }

    return Response.json({ message: "Successfully linked WhatsApp number" }, { status: 200 });
  } catch (err) {
    console.error("Link WhatsApp error:", err);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
