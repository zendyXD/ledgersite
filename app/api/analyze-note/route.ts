import { createClient } from "@/lib/supabase/server";
import { analyzeNoteText } from "@/lib/extract";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // Verify authentication session first
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const note = body.note;

    if (!note || typeof note !== "string" || note.trim().length === 0) {
      return Response.json({ message: "Empty or invalid note provided" }, { status: 400 });
    }

    const result = await analyzeNoteText(note.trim());

    return Response.json({
      message: "Note analyzed successfully",
      ...result
    });

  } catch (err) {
    console.error("ANALYZE_NOTE_ERROR", err);
    return Response.json(
      {
        message: err instanceof Error ? err.message : "Unknown server error",
      },
      { status: 500 }
    );
  }
}
