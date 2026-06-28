import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const PROOF_BUCKET = "proofs";

function isImageFile(filePath: string | null, originalName: string | null) {
  const value = `${filePath || ""} ${originalName || ""}`.toLowerCase();
  return (
    value.endsWith(".png") ||
    value.endsWith(".jpg") ||
    value.endsWith(".jpeg") ||
    value.endsWith(".webp") ||
    value.endsWith(".gif")
  );
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const admin = createAdminClient();

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

    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status");
    const limitParam = searchParams.get("limit");
    const limit = Math.min(Number(limitParam) || 20, 100);

    let query = supabase
      .from("proofs")
      .select(`
        id,
        user_id,
        comment,
        created_at,
        processing_status,
        extracted_text,
        extracted_amount,
        file_path,
        original_name,
        extracted_date,
        extracted_party,
        extracted_category,
        extracted_entry_type,
        project_name,
        linked_entry_id,
        source,
        metadata
      `)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);


      
    if (status) {
      query = query.eq("processing_status", status);
    } else {
      query = query.or("processing_status.neq.queue,source.eq.whatsapp");
    }

    const { data, error } = await query;

    if (error) {
      console.error("Inbox query error:", error);

      return NextResponse.json(
        { message: error.message || "Failed to load proof inbox" },
        { status: 500 }
      );
    }

    const proofsWithPreview = await Promise.all(
      (data ?? []).map(async (proof) => {if (!proof.file_path || !isImageFile(proof.file_path, proof.original_name)) {
  return {
    ...proof,
    preview_url: null,
  };
}

const testPaths = [
  proof.file_path,
  proof.file_path.replace(/^uploads\//, ""),
];

for (const testPath of testPaths) {
  const { data: signedData, error: signedError } = await admin.storage
  .from(PROOF_BUCKET)
  .createSignedUrl(testPath, 60 * 60);

  if (!signedError && signedData?.signedUrl) {
    return {
      ...proof,
      preview_url: signedData.signedUrl,
    };
  }
}

return {
  ...proof,
  preview_url: null,
  preview_error: {
    bucket: PROOF_BUCKET,
    file_path: proof.file_path,
    message: "Object not found for both original and stripped path",
  },
};
})
    );

    return NextResponse.json({ proofs: proofsWithPreview });
  } catch (error) {
    console.error("GET /api/proofs/inbox error:", error);

    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}