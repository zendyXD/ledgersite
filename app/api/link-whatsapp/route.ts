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

    // Insert or update whatsapp_links
    const { error: upsertError } = await supabase
      .from("whatsapp_links")
      .upsert(
        { 
          user_id: user.id, 
          whatsapp_number: whatsappNumber 
        },
        { 
          onConflict: "user_id" 
        }
      );

    if (upsertError) {
      console.error("whatsapp_links upsert error:", upsertError);
      if (upsertError.code === '23505') { // Unique violation
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
