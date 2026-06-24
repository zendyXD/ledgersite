import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity_logger";

export async function POST(
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

    const { data: proof, error: proofError } = await supabase
      .from("proofs")
      .select(`
        id,
        user_id,
        comment,
        created_at,
        processing_status,
        extracted_text,
        extracted_amount,
        extracted_date,
        extracted_party,
        extracted_category,
        extracted_entry_type,
        project_name,
        linked_entry_id
      `)
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (proofError) {
      return NextResponse.json(
        { message: proofError.message || "Failed to load proof" },
        { status: 500 }
      );
    }

    if (!proof) {
      return NextResponse.json(
        { message: "Proof not found" },
        { status: 404 }
      );
    }

    if (proof.linked_entry_id) {
      return NextResponse.json(
        { message: "Proof already linked to a ledger entry" },
        { status: 400 }
      );
    }

    if (!proof.extracted_party || proof.extracted_amount == null) {
      return NextResponse.json(
        { message: "Proof must have party and amount before creating a draft" },
        { status: 400 }
      );
    }

    const entry_date =
      proof.extracted_date ||
      new Date(proof.created_at).toISOString().slice(0, 10);

    const amount = proof.extracted_amount;
    const party_name = proof.extracted_party;
    const note = proof.comment || "";
    const entry_type = proof.extracted_entry_type || "expense";
    const category = proof.extracted_category || "misc";
    const project_name = proof.project_name || null;

    let is_split = false;
    let split_allocations: any[] = [];
    try {
      const body = await request.json();
      is_split = body?.is_split || false;
      split_allocations = body?.split_allocations || [];
    } catch {
      // Body is optional
    }

    const { data: insertedEntry, error: insertError } = await supabase
      .from("ledger_entries")
      .insert({
        user_id: user.id,
        proof_id: proof.id,
        entry_date,
        amount,
        entry_type,
        party_name,
        category,
        note,
        project_name,
        is_split,
        split_allocations,
      })
      .select("id, proof_id, entry_date, amount, entry_type, party_name, category, note, project_name, is_split, split_allocations, created_at")
      .single();

    if (insertError) {
      return NextResponse.json(
        { message: insertError.message || "Failed to create ledger draft" },
        { status: 500 }
      );
    }

    const { data: updatedProof, error: updateError } = await supabase
      .from("proofs")
      .update({
        processing_status: "linked",
        linked_entry_id: insertedEntry.id,
      })
      .eq("id", proof.id)
      .eq("user_id", user.id)
      .select(`
        id,
        user_id,
        comment,
        created_at,
        processing_status,
        extracted_text,
        extracted_amount,
        extracted_date,
        extracted_party,
        extracted_category,
        extracted_entry_type,
        linked_entry_id
      `)
      .single();

    if (updateError) {
      return NextResponse.json(
        { message: updateError.message || "Ledger draft created but proof update failed" },
        { status: 500 }
      );
    }

    // Log for Proof
    await logActivity(supabase, {
      entity_type: "proof",
      entity_id: Number(proof.id),
      action: "draft_created",
      details: { ledger_entry_id: insertedEntry.id }
    });

    // Log for Ledger Entry
    await logActivity(supabase, {
      entity_type: "ledger_entry",
      entity_id: insertedEntry.id,
      action: "draft_created",
      details: { proof_id: proof.id }
    });

    return NextResponse.json({
      message: "Ledger draft created",
      proof: updatedProof,
      entry: insertedEntry,
    });
  } catch (error) {
    console.error("POST /api/proofs/[id]/create-ledger error:", error);

    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}