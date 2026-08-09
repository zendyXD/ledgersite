"use client";

import { useState } from "react";
import Link from "next/link";
import PublicHeader from "@/components/PublicHeader";
import { Zap, Upload, FileSpreadsheet, ListChecks, ArrowLeft, Info, Image as ImageIcon } from "lucide-react";

export default function QuickPage() {
  const [dragActive, setDragActive] = useState(false);

  const steps = [
    { number: 1, title: "Add screenshots", icon: Upload, current: true, description: "Upload payment proofs" },
    { number: 2, title: "Review extracted entries", icon: ListChecks, current: false, description: "Verify amounts & dates" },
    { number: 3, title: "Generate Excel", icon: FileSpreadsheet, current: false, description: "Download clean spreadsheet" },
  ];

  return (
    <div className="min-h-screen flex flex-col theme-page">
      <PublicHeader />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 md:px-8 py-6 md:py-10 flex flex-col gap-6">
        
        {/* Top breadcrumb & mode title */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-muted)] transition-colors"
              title="Back to Homepage"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl md:text-2xl font-bold text-[var(--foreground)] tracking-tight">
                  Quick Mode
                </h1>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)]">
                  Shell Preview
                </span>
              </div>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Batch payment screenshot processing for fast Excel export
              </p>
            </div>
          </div>
        </div>

        {/* Session-only Notice */}
        <div className="rounded-xl bg-[var(--card-muted)] border border-[var(--border)] p-4 flex items-start gap-3">
          <Info className="w-4 h-4 text-[var(--primary)] shrink-0 mt-0.5" />
          <div className="text-xs text-[var(--muted)] leading-relaxed">
            <strong className="text-[var(--foreground)]">Session-Only Workspace:</strong> Quick Mode operates in browser memory to build a single consolidated Excel file. Screenshots will not be linked to party ledgers or saved into permanent database records.
          </div>
        </div>

        {/* 3-Step Indicator */}
        <div className="surface-panel p-4 md:p-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 relative">
            {steps.map((s, idx) => (
              <div
                key={s.number}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                  s.current
                    ? "bg-[var(--card-elevated)] border-[var(--primary)] shadow-sm"
                    : "bg-[var(--card-muted)] border-transparent opacity-75"
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                    s.current
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "bg-[var(--card)] text-[var(--muted)] border border-[var(--border)]"
                  }`}
                >
                  {s.number}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className={`text-xs font-bold truncate ${s.current ? "text-[var(--foreground)]" : "text-[var(--muted)]"}`}>
                    {s.title}
                  </span>
                  <span className="text-[10px] text-[var(--muted)] truncate">{s.description}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Drop Zone Placeholder Shell */}
        <div className="surface-panel p-6 md:p-10 flex flex-col items-center justify-center text-center">
          <div
            className={`w-full border-2 border-dashed rounded-2xl p-8 md:p-12 flex flex-col items-center justify-center transition-all ${
              dragActive
                ? "border-[var(--primary)] bg-[var(--primary)]/5"
                : "border-[var(--border)] bg-[var(--card-muted)]/50 hover:bg-[var(--card-muted)]"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
            onDrop={(e) => { e.preventDefault(); setDragActive(false); }}
          >
            <div className="w-14 h-14 rounded-2xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center mb-4">
              <ImageIcon className="w-7 h-7" />
            </div>

            <h3 className="text-lg font-bold text-[var(--foreground)] mb-1">
              Add payment screenshots
            </h3>
            <p className="text-xs text-[var(--muted)] max-w-md mb-5 leading-relaxed">
              Drag & drop UPI payment screenshots, bank transfer slips, or receipt images here.
            </p>

            <button
              type="button"
              className="btn-theme-accent text-xs md:text-sm px-5 py-2.5 rounded-xl font-semibold opacity-80 hover:opacity-100 transition-all flex items-center gap-2 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>Select Screenshots</span>
            </button>

            <p className="text-[10px] text-[var(--muted)] mt-4">
              Quick Mode shell initialized • AI extraction processing will be connected in next step
            </p>
          </div>
        </div>

      </main>
    </div>
  );
}
