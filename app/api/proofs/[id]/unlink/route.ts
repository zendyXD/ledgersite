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

    // 1. Fetch proof
    const { data: proof, error: proofError } = await supabase
      .from("proofs")
      .select("id, linked_entry_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (proofError || !proof) {
      return NextResponse.json(
        { message: "Proof not found" },
        { status: 404 }
      );
    }

    if (!proof.linked_entry_id) {
      return NextResponse.json(
        { message: "Proof is not linked to any ledger entry" },
        { status: 400 }
      );
    }

    // 2. Fetch ledger entry
    const { data: ledgerEntry, error: ledgerError } = await supabase
      .from("ledger_entries")
      .select("id, is_finalised")
      .eq("id", proof.linked_entry_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (ledgerError || !ledgerEntry) {
      return NextResponse.json(
        { message: "Linked ledger entry not found" },
        { status: 404 }
      );
    }

    // 3. Block if finalized
    if (ledgerEntry.is_finalised) {
      return NextResponse.json(
        { message: "Cannot unlink from a finalized ledger entry." },
        { status: 400 }
      );
    }

    // 4. Update ledger_entries
    const { error: unlinkLedgerError } = await supabase
      .from("ledger_entries")
      .update({ proof_id: null })
      .eq("id", ledgerEntry.id)
      .eq("user_id", user.id);

    if (unlinkLedgerError) {
      return NextResponse.json(
        { message: "Failed to update ledger entry during unlink" },
        { status: 500 }
      );
    }

    // 5. Update proofs
    const { error: unlinkProofError } = await supabase
      .from("proofs")
      .update({ linked_entry_id: null, processing_status: "reviewed" })
      .eq("id", id)
      .eq("user_id", user.id);

    if (unlinkProofError) {
      return NextResponse.json(
        { message: "Failed to update proof during unlink" },
        { status: 500 }
      );
    }

    // Log for Ledger Entry
    await logActivity(supabase, {
      entity_type: "ledger_entry",
      entity_id: ledgerEntry.id,
      action: "unlinked",
      details: { proof_id: proof.id }
    });

    // Log for Proof
    await logActivity(supabase, {
      entity_type: "proof",
      entity_id: Number(proof.id),
      action: "unlinked",
      details: { ledger_entry_id: ledgerEntry.id }
    });

    return NextResponse.json({
      message: "Proof unlinked successfully",
    });
  } catch (error) {
    console.error("POST /api/proofs/[id]/unlink error:", error);

    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
