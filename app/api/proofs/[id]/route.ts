import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity_logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    const { data, error } = await supabase
      .from("proofs")
      .select(`
  id,
  user_id,
  comment,
  created_at,
  processing_status,
  file_path,
  original_name,
  extracted_text,
  extracted_amount,
  extracted_date,
  extracted_party,
  extracted_category,
  extracted_entry_type,
  project_name,
  linked_entry_id,
  reviewed_at
`)
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

   if (error) {
  return NextResponse.json(
    { message: error.message || "Failed to load proof" },
    { status: 500 }
  );
}

if (!data) {
  return NextResponse.json(
    { message: "Proof not found" },
    { status: 404 }
  );
}

const admin = createAdminClient();

const { data: signedData, error: signedError } = await admin.storage
  .from("proofs")
  .createSignedUrl(data.file_path, 60 * 60);

if (signedError) {
  return NextResponse.json(
    { message: signedError.message || "Failed to create signed URL" },
    { status: 500 }
  );
}

   return NextResponse.json({
  proof: data,
  signed_url: signedData?.signedUrl ?? null,
});
  } catch (error) {
    console.error("GET /api/proofs/[id] error:", error);

    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const body = await request.json();

    const allowedStatuses = ["unprocessed", "unreviewed", "drafted", "linked", "reviewed"];

    const updates: {
      processing_status?: string;
      extracted_party?: string | null;
      extracted_amount?: number | null;
      extracted_date?: string | null;
      extracted_category?: string | null;
      extracted_entry_type?: string | null;
      project_name?: string | null;
    } = {};

    if (body.processing_status !== undefined) {
  if (!allowedStatuses.includes(body.processing_status)) {
    return NextResponse.json(
      { message: "Invalid processing status" },
      { status: 400 }
    );
  }

  updates.processing_status = body.processing_status;

  if (body.processing_status === "reviewed") {
    (updates as any).reviewed_at = new Date().toISOString();
  }
}
    if (body.extracted_party !== undefined) {
      updates.extracted_party = body.extracted_party
        ? String(body.extracted_party).trim()
        : null;
    }

    if (body.extracted_category !== undefined) {
      updates.extracted_category = body.extracted_category
        ? String(body.extracted_category).trim()
        : null;
    }

    if (body.extracted_entry_type !== undefined) {
      updates.extracted_entry_type = body.extracted_entry_type
        ? String(body.extracted_entry_type).trim()
        : null;
    }

    if (body.project_name !== undefined) {
      updates.project_name = body.project_name
        ? String(body.project_name).trim()
        : null;
    }

    if (body.extracted_amount !== undefined) {
      if (
        body.extracted_amount === "" ||
        body.extracted_amount === null ||
        body.extracted_amount === undefined
      ) {
        updates.extracted_amount = null;
      } else {
        const amount = Number(body.extracted_amount);

        if (Number.isNaN(amount) || amount < 0) {
          return NextResponse.json(
            { message: "Invalid extracted amount" },
            { status: 400 }
          );
        }

        updates.extracted_amount = amount;
      }
    }

    if (body.extracted_date !== undefined) {
      updates.extracted_date = body.extracted_date
        ? String(body.extracted_date)
        : null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { message: "No valid fields to update" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("proofs")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id)
      .select(`
  id,
  user_id,
  comment,
  created_at,
  processing_status,
  file_path,
  original_name,
  extracted_text,
  extracted_amount,
  extracted_date,
  extracted_party,
  extracted_category,
  extracted_entry_type,
  project_name,
  linked_entry_id,
  reviewed_at
`);

    console.log("PATCH update result:", {
      id,
      userId: user.id,
      updates,
      data,
      error,
    });

    if (error) {
      return NextResponse.json(
        { message: error.message || "Failed to update proof" },
        { status: 500 }
      );
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { message: "Proof not found or update blocked" },
        { status: 404 }
      );
    }

    const updatedProof = data[0];

    // Auto-sync fields to linked draft ledger entry
    if (updatedProof.linked_entry_id) {
      const { data: ledgerEntry } = await supabase
        .from("ledger_entries")
        .select("id, is_finalised")
        .eq("id", updatedProof.linked_entry_id)
        .single();

      if (ledgerEntry && !ledgerEntry.is_finalised) {
        const syncPayload: any = {};
        if (updates.extracted_party !== undefined) syncPayload.party_name = updates.extracted_party;
        if (updates.extracted_amount !== undefined) syncPayload.amount = updates.extracted_amount;
        if (updates.extracted_date !== undefined) syncPayload.entry_date = updates.extracted_date;
        if (updates.extracted_category !== undefined) syncPayload.category = updates.extracted_category;
        if (updates.extracted_entry_type !== undefined) syncPayload.entry_type = updates.extracted_entry_type;
        if (updates.project_name !== undefined) syncPayload.project_name = updates.project_name;

        if (Object.keys(syncPayload).length > 0) {
          const { error: syncError } = await supabase
            .from("ledger_entries")
            .update(syncPayload)
            .eq("id", ledgerEntry.id);
            
          if (syncError) {
             console.error("Failed to sync proof to ledger entry:", syncError);
          }
        }
      }
    }

    return NextResponse.json({
      message: "Proof updated",
      proof: updatedProof,
    });
  } catch (error) {
    console.error("PATCH /api/proofs/[id] error:", error);

    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    // 1. Fetch proof to check linked status and get file_path
    const { data: proof, error: fetchError } = await supabase
      .from("proofs")
      .select("file_path, linked_entry_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fetchError || !proof) {
      return NextResponse.json({ message: "Proof not found" }, { status: 404 });
    }

    // 2. Guard against deleting linked proofs
    if (proof.linked_entry_id) {
      return NextResponse.json(
        { message: "Cannot delete proof linked to a ledger entry. Unlink it first." },
        { status: 400 }
      );
    }

    // 3. Delete from DB (hard delete) using admin client to bypass RLS silently failing
    const admin = createAdminClient();
    const { error: deleteError } = await admin
      .from("proofs")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (deleteError) {
      return NextResponse.json({ message: deleteError.message || "Failed to delete" }, { status: 500 });
    }

    // 4. Clean up file from Supabase Storage
    if (proof.file_path) {
      await admin.storage.from("proofs").remove([proof.file_path]);
    }

    return NextResponse.json({ message: "Deleted successfully" });
  } catch (error) {
    console.error("DELETE /api/proofs/[id] error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}