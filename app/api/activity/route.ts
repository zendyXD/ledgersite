import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const entity_type = searchParams.get("entity_type");
    const entity_id = searchParams.get("entity_id");

    if (!entity_type || !entity_id) {
      return NextResponse.json(
        { message: "entity_type and entity_id are required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("activity_logs")
      .select("*")
      .eq("entity_type", entity_type)
      .eq("entity_id", entity_id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("GET /api/activity Supabase error:", error);
      try {
        const fs = require('fs');
        fs.writeFileSync('activity_error.log', JSON.stringify(error, null, 2));
      } catch(e){}
      return NextResponse.json({ logs: [], error: error.message, details: error.details, hint: error.hint });
    }

    return NextResponse.json({ logs: data || [] });
  } catch (error: any) {
    console.error("GET /api/activity error:", error);
    try {
        const fs = require('fs');
        fs.writeFileSync('activity_error.log', JSON.stringify(error, null, 2));
    } catch(e){}
    return NextResponse.json(
      { message: "Internal server error", error: error?.message },
      { status: 500 }
    );
  }
}
