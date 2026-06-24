import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity_logger";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json();

    const updates: Record<string, any> = {};

    // 1. DYNAMIC DATA ASSIGNMENT (Only map fields if they are sent in the body)
    if (body.entry_date !== undefined) updates.entry_date = body.entry_date as string;
    if (body.amount !== undefined) updates.amount = Number(body.amount);
    if (body.entry_type !== undefined) updates.entry_type = body.entry_type as "income" | "expense";
    if (body.party_name !== undefined) updates.party_name = (body.party_name as string) || "";
    if (body.category !== undefined) updates.category = (body.category as string) || "";
    if (body.note !== undefined) updates.note = (body.note as string) || "";
    if (body.proof_id !== undefined) updates.proof_id = body.proof_id ? Number(body.proof_id) : null;
    if (body.is_finalised !== undefined) updates.is_finalised = Boolean(body.is_finalised);
    if (body.review_status !== undefined) updates.review_status = body.review_status ? String(body.review_status) : null;
    if (body.project_name !== undefined) updates.project_name = body.project_name ? String(body.project_name).trim() : null;

    // 2. CONDITIONAL VALIDATION (Only validate fields if they are being updated)
    if (updates.entry_date !== undefined && !updates.entry_date) {
      return Response.json({ message: "Entry date cannot be empty" }, { status: 400 });
    }

    if (updates.amount !== undefined) {
      if (Number.isNaN(updates.amount) || updates.amount <= 0) {
        return Response.json({ message: "Valid amount is required" }, { status: 400 });
      }
    }

    if (updates.entry_type !== undefined) {
      if (updates.entry_type !== "income" && updates.entry_type !== "expense") {
        return Response.json({ message: "Entry type must be income or expense" }, { status: 400 });
      }
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ message: "No fields provided for update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("ledger_entries")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id) // Security scope lock
      .select();

    if (error) {
      return Response.json(
        { message: error.message || "Failed to update ledger entry" },
        { status: 500 }
      );
    }

    if (!data || data.length === 0) {
      return Response.json(
        { message: "Ledger entry not found or access denied" },
        { status: 404 }
      );
    }

    if (updates.is_finalised === true) {
      await logActivity(supabase, { entity_type: "ledger_entry", entity_id: Number(id), action: "finalised" });
    } else if (updates.is_finalised === false) {
      await logActivity(supabase, { entity_type: "ledger_entry", entity_id: Number(id), action: "unlocked" });
    } else if (updates.review_status === "reviewed") {
      await logActivity(supabase, { entity_type: "ledger_entry", entity_id: Number(id), action: "reviewed" });
    } else if (updates.review_status === "unreviewed") {
      await logActivity(supabase, { entity_type: "ledger_entry", entity_id: Number(id), action: "review_reset" });
    } else {
      const changedFields = Object.keys(updates).filter(k => k !== "review_status" && k !== "is_finalised");
      if (changedFields.length > 0) {
        await logActivity(supabase, {
          entity_type: "ledger_entry",
          entity_id: Number(id),
          action: "edited",
          details: { fields: changedFields }
        });
      }
    }

    return Response.json({ message: "Ledger entry updated successfully" });
  } catch (err) {
    console.error("LEDGER_PATCH_ERROR", err);
    return Response.json(
      {
        message: err instanceof Error ? err.message : "Unknown server error",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    // 1. Safety Check: Verify entry exists and is not finalised
    const { data: entryToDel, error: fetchError } = await supabase
      .from("ledger_entries")
      .select("is_finalised, proof_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fetchError || !entryToDel) {
      return Response.json({ message: "Ledger entry not found" }, { status: 404 });
    }

    if (entryToDel.is_finalised) {
      return Response.json({ message: "Cannot delete a finalised ledger entry" }, { status: 400 });
    }

    // 2. Safely unlink associated proof
    if (entryToDel.proof_id) {
      const { error: unlinkError } = await supabase
        .from("proofs")
        .update({ 
          linked_entry_id: null,
          // Revert processing status slightly so the user knows it needs attention again
          processing_status: "reviewed" 
        })
        .eq("id", entryToDel.proof_id)
        .eq("user_id", user.id);
        
      if (unlinkError) {
        console.error("Failed to unlink proof during ledger delete:", unlinkError);
      } else {
        await logActivity(supabase, { 
          entity_type: "proof", 
          entity_id: entryToDel.proof_id, 
          action: "unlinked",
          details: { message: "Ledger draft was deleted." }
        });
      }
    }

    // 3. Log the deletion activity (this will persist even after row is gone)
    await logActivity(supabase, { 
      entity_type: "ledger_entry", 
      entity_id: Number(id), 
      action: "deleted" 
    });

    // 4. Perform Hard Delete
    const { error } = await supabase
      .from("ledger_entries")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id); // Add scope lock

    if (error) {
      return Response.json(
        { message: error.message || "Failed to delete ledger entry" },
        { status: 500 }
      );
    }

    return Response.json({ message: "Ledger entry deleted" });
  } catch (err) {
    console.error("LEDGER_DELETE_ERROR", err);
    return Response.json(
      {
        message: err instanceof Error ? err.message : "Unknown server error",
      },
      { status: 500 }
    );
  }
}