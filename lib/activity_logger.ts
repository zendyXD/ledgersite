import { SupabaseClient } from "@supabase/supabase-js";

export type EntityType = "proof" | "ledger_entry";

export async function logActivity(
  supabase: SupabaseClient,
  params: {
    entity_type: EntityType;
    entity_id: number;
    action: string;
    details?: any;
  }
) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Silently try to insert. If it fails (e.g. table doesn't exist yet), we catch it and ignore
    // to preserve workflow safety as requested.
    const { error } = await supabase.from("activity_logs").insert({
      entity_type: params.entity_type,
      entity_id: params.entity_id,
      action: params.action,
      details: params.details || {},
      user_id: user?.id || null,
    });
    
    if (error) {
      console.error("Supabase insert error in activity_logger:", error);
      try {
        const fs = require('fs');
        fs.writeFileSync('activity_insert_error.log', JSON.stringify(error, null, 2));
      } catch(e){}
    }
  } catch (err: any) {
    console.error("Failed to log activity:", err);
    try {
        const fs = require('fs');
        fs.writeFileSync('activity_insert_error.log', JSON.stringify(err, null, 2));
    } catch(e){}
  }
}
