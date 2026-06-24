import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    const entry_date = body.entry_date as string;
    const amount = Number(body.amount);
    const entry_type = body.entry_type as "income" | "expense";
    const party_name = (body.party_name as string) || "";
    const category = (body.category as string) || "";
    const note = (body.note as string) || "";
    const project_name = (body.project_name as string) || null;
    const proof_id = body.proof_id ? Number(body.proof_id) : null;

    if (!entry_date) {
      return Response.json({ message: "Entry date is required" }, { status: 400 });
    }

    if (!amount || Number.isNaN(amount) || amount <= 0) {
      return Response.json({ message: "Valid amount is required" }, { status: 400 });
    }

    if (entry_type !== "income" && entry_type !== "expense") {
      return Response.json({ message: "Entry type must be income or expense" }, { status: 400 });
    }

    const { error } = await supabase.from("ledger_entries").insert({
      user_id: user.id,
      proof_id,
      entry_date,
      amount,
      entry_type,
      party_name,
      category,
      note,
      project_name,
    });

    if (error) {
      return Response.json(
        { message: error.message || "Failed to save ledger entry" },
        { status: 500 }
      );
    }

    return Response.json({ message: "Ledger entry saved" });
  } catch (err) {
    console.error("LEDGER_POST_ERROR", err);
    return Response.json(
      {
        message: err instanceof Error ? err.message : "Unknown server error",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { data: ledgerData, error: ledgerError } = await supabase
      .from("ledger_entries")
      .select("*")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50);

    if (ledgerError) {
      return Response.json(
        { message: ledgerError.message || "Failed to fetch ledger entries" },
        { status: 500 }
      );
    }

    if (!ledgerData || ledgerData.length === 0) {
      return Response.json({ entries: [] });
    }

    // Safely fetch proofs without requiring a foreign key constraint
    const proofIds = ledgerData.map(e => e.proof_id).filter(Boolean);
    let proofsMap: Record<number, any> = {};
    
    if (proofIds.length > 0) {
      const { data: proofsData, error: proofsError } = await supabase
        .from("proofs")
        .select("id, original_name, file_path")
        .in("id", proofIds);
        
      if (!proofsError && proofsData) {
        proofsMap = proofsData.reduce((acc, p) => {
          acc[p.id] = p;
          return acc;
        }, {} as Record<number, any>);
      }
    }

    const entriesWithProofs = ledgerData.map(entry => ({
      ...entry,
      proofs: entry.proof_id && proofsMap[entry.proof_id] ? proofsMap[entry.proof_id] : null
    }));

    return Response.json({ entries: entriesWithProofs });
  } catch (err) {
    console.error("LEDGER_GET_ERROR", err);
    return Response.json(
      {
        message: err instanceof Error ? err.message : "Unknown server error",
      },
      { status: 500 }
    );
  }
}