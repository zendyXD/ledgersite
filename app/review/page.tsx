"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ReviewQueuePage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function init() {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        router.push("/login");
        return;
      }
      
      try {
        const res = await fetch("/api/proofs/inbox?status=queue");
        const json = await res.json();
        
        if (!res.ok) {
          throw new Error(json.message || "Failed to fetch queue");
        }
        
        const proofs = json.proofs || [];
        
        if (proofs.length > 0) {
          const first = proofs[0];
          // Redirect to the edit page in queue mode, passing the count
          router.replace(`/inbox/${first.id}?queueMode=true&queueCount=${proofs.length}`);
        } else {
          // Queue is empty
          setLoading(false);
        }
      } catch (err: any) {
        console.error(err);
        setError(err.message || "An error occurred");
        setLoading(false);
      }
    }
    
    init();
  }, [router, supabase]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-slate-600 font-medium">Checking Review Queue...</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-8 flex items-center justify-center">
      <div className="max-w-md w-full rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl">
          🎉
        </div>
        <h1 className="text-2xl font-bold text-emerald-900">Queue Complete!</h1>
        <p className="mt-2 text-emerald-800">
          You have successfully reviewed all items in your batch upload queue.
        </p>
        
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        
        <div className="mt-8 flex flex-col gap-3">
          <Link href="/inbox" className="rounded-xl bg-emerald-700 px-6 py-3 text-sm font-bold text-white hover:bg-emerald-800 transition-colors shadow-sm">
            Go to Proof Inbox →
          </Link>
          <Link href="/uploads" className="rounded-xl border border-emerald-300 bg-white px-6 py-3 text-sm font-bold text-emerald-800 hover:bg-emerald-100 transition-colors shadow-sm">
            Upload More Proofs
          </Link>
        </div>
      </div>
    </main>
  );
}
