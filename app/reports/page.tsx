"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { generateDetailedExportBuffer } from "@/lib/excel";

type LedgerEntry = {
  id: number;
  proof_id: number | null;
  entry_date: string;
  amount: number | string;
  entry_type: "income" | "expense";
  party_name: string | null;
  category: string | null;
  note: string | null;
  project_name?: string | null;
  is_finalised?: boolean | null;
  created_at: string;
  is_split?: boolean;
  split_allocations?: any[];
};

function ReportSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading reports">
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="surface-panel p-4 shadow-sm">
            <div className="skeleton h-4 w-28 bg-[var(--card-muted)] rounded" />
            <div className="skeleton mt-3 h-8 w-24 bg-[var(--card-muted)] rounded" />
          </div>
        ))}
      </div>

      <div className="surface-panel p-4 shadow-sm">
        <div className="skeleton h-10 w-56 bg-[var(--card-muted)] rounded" />
        <div className="skeleton mt-4 h-10 w-40 bg-[var(--card-muted)] rounded" />
        <div className="skeleton mt-6 h-12 w-full bg-[var(--card-muted)] rounded" />
        <div className="skeleton mt-3 h-12 w-full bg-[var(--card-muted)] rounded" />
        <div className="skeleton mt-3 h-12 w-full bg-[var(--card-muted)] rounded" />
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const router = useRouter();
  const supabase = createClient();

  const [userEmail, setUserEmail] = useState("");
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [exporting, setExporting] = useState(false);

  const currentMonthDefault = new Date().toISOString().slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthDefault);
  const [selectedParty, setSelectedParty] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [partySearch, setPartySearch] = useState("");
  const [includeDrafts, setIncludeDrafts] = useState(false);

  useEffect(() => {
    async function initPage() {
      try {
        setLoading(true);
        setErrorMessage("");

        const { data, error } = await supabase.auth.getUser();

        if (error || !data.user) {
          router.push("/login");
          return;
        }

        setUserEmail(data.user.email || "");

        const ledgerRes = await fetch("/api/ledger");
        const ledgerData = await ledgerRes.json();

        if (!ledgerRes.ok) {
          throw new Error(ledgerData.message || "Failed to load ledger entries");
        }

        setLedgerEntries(ledgerData.entries || []);
      } catch (err) {
        console.error(err);
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to load reports"
        );
      } finally {
        setLoading(false);
      }
    }

    initPage();
  }, [router, supabase]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const monthOptions = useMemo(() => {
    const months = Array.from(
      new Set(
        ledgerEntries
          .map((entry) => entry.entry_date?.slice(0, 7))
          .filter(Boolean)
      )
    ).sort((a, b) => (a > b ? -1 : 1));

    if (!months.includes(currentMonthDefault)) {
      months.unshift(currentMonthDefault);
    }
    months.unshift("all_time");

    return months;
  }, [ledgerEntries, currentMonthDefault]);

const filteredEntries = useMemo(() => {
  return [...ledgerEntries]
    .filter((entry) => {
      if (!includeDrafts && !entry.is_finalised) return false;

      const matchesMonth = selectedMonth === "all_time" || entry.entry_date?.startsWith(selectedMonth);

      const partyName = entry.party_name?.trim() || "Unknown Party";
      const matchesParty =
        !selectedParty ||
        partyName.toLowerCase() === selectedParty.toLowerCase();

      const categoryName = entry.category?.trim() || "Uncategorized";
      const matchesCategory =
        !selectedCategory ||
        categoryName.toLowerCase() === selectedCategory.toLowerCase();

      return matchesMonth && matchesParty && matchesCategory;
    })
    .sort(
      (a, b) =>
        new Date(b.entry_date).getTime() - new Date(a.entry_date).getTime()
    );
}, [ledgerEntries, selectedMonth, selectedParty, selectedCategory, includeDrafts]);

  const totalIncome = useMemo(() => {
    return filteredEntries
      .filter((entry) => entry.entry_type === "income")
      .reduce((sum, entry) => sum + Number(entry.amount), 0);
  }, [filteredEntries]);

  const totalExpense = useMemo(() => {
    return filteredEntries
      .filter((entry) => entry.entry_type === "expense")
      .reduce((sum, entry) => sum + Number(entry.amount), 0);
  }, [filteredEntries]);

  const netAmount = totalIncome - totalExpense;
  const entryCount = filteredEntries.length;

  const categorySummary = useMemo(() => {
    const map = new Map<string, number>();

    for (const entry of filteredEntries) {
      const key = entry.category?.trim() || "Uncategorized";
      map.set(key, (map.get(key) || 0) + Number(entry.amount));
    }

    return Array.from(map.entries())
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);
  }, [filteredEntries]);

    const partySummary = useMemo(() => {
  const map = new Map<
    string,
    {
      party: string;
      income: number;
      expense: number;
      count: number;
    }
  >();

  for (const entry of filteredEntries) {
    const key = entry.party_name?.trim() || "Unknown Party";

    if (!map.has(key)) {
      map.set(key, {
        party: key,
        income: 0,
        expense: 0,
        count: 0,
      });
    }

    const current = map.get(key)!;
    const amount = Number(entry.amount);

    if (entry.entry_type === "income") {
      current.income += amount;
    } else {
      current.expense += amount;
    }

    current.count += 1;
  }

  return Array.from(map.values())
    .map((item) => ({
      ...item,
      net: item.income - item.expense,
    }))
    .filter((item) =>
      item.party.toLowerCase().includes(partySearch.trim().toLowerCase())
    )
    .sort((a, b) => {
      if (b.expense !== a.expense) return b.expense - a.expense;
      return a.party.localeCompare(b.party);
    });
}, [filteredEntries, partySearch]);

 async function handleExportExcel() {
  try {
    setExporting(true);
    setErrorMessage("");

    const baseMonthlyEntries = [...ledgerEntries]
      .filter((entry) => {
        if (!includeDrafts && !entry.is_finalised) return false;
        return selectedMonth === "all_time" || entry.entry_date?.startsWith(selectedMonth);
      });

    const buffer = await generateDetailedExportBuffer(baseMonthlyEntries, { month: selectedMonth });
    const blob = new Blob([buffer as any], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const safePartyName = selectedParty
      ? selectedParty.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "_")
      : "";

    saveAs(
      blob,
      selectedParty
        ? `Ledgersite_Report_${selectedMonth}_${safePartyName}.xlsx`
        : `Ledgersite_Report_${selectedMonth}.xlsx`
    );
  } catch (err) {
    console.error(err);
    setErrorMessage(
      err instanceof Error ? err.message : "Failed to export Excel report"
    );
  } finally {
    setExporting(false);
  }
}
async function handleExportPartyLedgerExcel() {
  try {
    if (!selectedParty) {
      setErrorMessage("Please select a party first from Party Summary.");
      return;
    }

    setExporting(true);
    setErrorMessage("");

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Ledgersite";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Party Ledger", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    sheet.columns = [
      { header: "Date", key: "entry_date", width: 15 },
      { header: "Particulars", key: "particulars", width: 26 },
      { header: "Category", key: "category", width: 20 },
      { header: "Narration", key: "narration", width: 42 },
      { header: "Proof Ref", key: "proof_ref", width: 14 },
      { header: "Debit", key: "debit", width: 16 },
      { header: "Credit", key: "credit", width: 16 },
      { header: "Balance", key: "balance", width: 16 },
    ];

    const header = sheet.getRow(1);
    header.height = 22;
    header.eachCell((cell) => {
      cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "0F766E" },
      };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin", color: { argb: "0F766E" } },
        left: { style: "thin", color: { argb: "0F766E" } },
        bottom: { style: "thin", color: { argb: "0F766E" } },
        right: { style: "thin", color: { argb: "0F766E" } },
      };
    });

    const partyEntries = [...ledgerEntries]
      .filter((entry) => {
        const matchesMonth = entry.entry_date?.startsWith(selectedMonth);
        const partyName = entry.party_name?.trim() || "Unknown Party";
        return (
          matchesMonth &&
          partyName.toLowerCase() === selectedParty.toLowerCase()
        );
      })
      .sort(
        (a, b) =>
          new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime()
      );

    let runningBalance = 0;
    let totalDebit = 0;
    let totalCredit = 0;

    for (const entry of partyEntries) {
      const amount = Number(entry.amount);
      const debit = entry.entry_type === "expense" ? amount : 0;
      const credit = entry.entry_type === "income" ? amount : 0;

      runningBalance = runningBalance + credit - debit;
      totalDebit += debit;
      totalCredit += credit;

      const row = sheet.addRow({
        entry_date: entry.entry_date,
        particulars: `${entry.entry_type === "income" ? "Income" : "Expense"} - ${entry.category || "General"}`,
        category: entry.category || "Uncategorized",
        narration: entry.note || "",
        proof_ref: entry.proof_id ?? "",
        debit: debit || "",
        credit: credit || "",
        balance: runningBalance,
      });

      row.height = 22;

      row.eachCell((cell, colNumber) => {
        cell.font = { name: "Calibri", color: { argb: "0F172A" } };
        cell.border = {
          top: { style: "thin", color: { argb: "E2E8F0" } },
          left: { style: "thin", color: { argb: "E2E8F0" } },
          bottom: { style: "thin", color: { argb: "E2E8F0" } },
          right: { style: "thin", color: { argb: "E2E8F0" } },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: row.number % 2 === 0 ? "FFFFFF" : "F8FAFC" },
        };

        if (colNumber === 4) {
          cell.alignment = {
            horizontal: "left",
            vertical: "middle",
            wrapText: true,
          };
        } else if (colNumber >= 6 && colNumber <= 8) {
          cell.alignment = {
            horizontal: "right",
            vertical: "middle",
          };
        } else {
          cell.alignment = {
            horizontal: "center",
            vertical: "middle",
          };
        }
      });

      row.getCell(6).numFmt = '"Rs." #,##0.00';
      row.getCell(7).numFmt = '"Rs." #,##0.00';
      row.getCell(8).numFmt = '"Rs." #,##0.00';

      const narrationValue = String(row.getCell(4).value || "");
      if (narrationValue.length > 60) row.height = 38;
      if (narrationValue.length > 120) row.height = 54;
    }

    const totalRow = sheet.addRow({
      narration: `${selectedParty} Total`,
      debit: totalDebit,
      credit: totalCredit,
      balance: runningBalance,
    });

    totalRow.eachCell((cell, colNumber) => {
      cell.font = {
        name: "Calibri",
        bold: true,
        color: { argb: "0F172A" },
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "DCFCE7" },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "86EFAC" } },
        left: { style: "thin", color: { argb: "86EFAC" } },
        bottom: { style: "thin", color: { argb: "86EFAC" } },
        right: { style: "thin", color: { argb: "86EFAC" } },
      };

      if (colNumber >= 6 && colNumber <= 8) {
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        cell.alignment = { horizontal: "left", vertical: "middle" };
      }
    });

    totalRow.getCell(6).numFmt = '"Rs." #,##0.00';
    totalRow.getCell(7).numFmt = '"Rs." #,##0.00';
    totalRow.getCell(8).numFmt = '"Rs." #,##0.00';

    sheet.autoFilter = {
      from: "A1",
      to: "H1",
    };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const safePartyName = selectedParty
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .replace(/\s+/g, "_");

    saveAs(blob, `Ledgersite_Ledger_${selectedMonth}_${safePartyName}.xlsx`);
  } catch (err) {
    console.error(err);
    setErrorMessage(
      err instanceof Error ? err.message : "Failed to export party ledger"
    );
  } finally {
    setExporting(false);
  }
}
  return (
    <main className="page-shell p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="surface-panel p-4 shadow-sm">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-[var(--foreground)]">
                Ledger reports
              </h1>
              <p className="text-sm text-[var(--muted)]">
                Monthly report view from your centralized ledger.
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Logged in as: {userEmail || "Loading..."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link href="/dashboard" className="btn-secondary">
                Dashboard
              </Link>
              <Link href="/uploads" className="btn-secondary">
                Uploads
              </Link>
              <button type="button" onClick={handleLogout} className="btn-secondary">
                Logout
              </button>
            </div>
          </div>

          {errorMessage && (
            <p className="status-error text-sm font-medium">{errorMessage}</p>
          )}

          {loading ? (
            <ReportSkeleton />
          ) : (
            <>
              <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div className="flex flex-wrap gap-4 items-end">
                  <div className="w-full md:w-72">
                    <label className="mb-2 block text-sm font-medium text-[var(--foreground)]">
                      Select period
                    </label>
                    <select
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] text-[var(--input-text)] px-3 py-2 outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(e.target.value)}
                    >
                      {monthOptions.map((month) => (
                        <option key={month} value={month}>
                          {month === "all_time" ? "All Time" : month}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="mb-3 flex items-center gap-2 cursor-pointer text-sm font-medium text-[var(--muted)]">
                    <input type="checkbox" checked={includeDrafts} onChange={e => setIncludeDrafts(e.target.checked)} className="rounded border-[var(--border)] bg-[var(--input-bg)] text-teal-600 focus:ring-teal-500 h-4 w-4" />
                    Include drafts
                  </label>
                </div>

                <div className="flex flex-wrap gap-3">
  <button
    type="button"
    onClick={handleExportExcel}
    className="btn-primary"
    disabled={monthOptions.length === 0 || exporting}
  >
    {exporting ? "Exporting..." : "Export Excel"}
  </button>

  <button
  type="button"
  onClick={handleExportPartyLedgerExcel}
  className={`btn-secondary ${
    !selectedParty || exporting ? "cursor-not-allowed opacity-50" : ""
  }`}
  disabled={!selectedParty || exporting}
  title={!selectedParty ? "Select a party first from Party Summary" : ""}
>
  {exporting ? "Exporting..." : "Party Ledger Excel"}
</button>
</div>
              </div>

{(selectedParty || selectedCategory || partySearch.trim()) && (
  <div className="mb-6 flex flex-wrap items-center gap-2">
    <span className="text-sm font-medium text-[var(--muted)]">Active filters:</span>

    {selectedParty ? (
      <button
        type="button"
        onClick={() => setSelectedParty("")}
        className="inline-flex items-center gap-2 rounded-full border border-[var(--primary)] bg-teal-50 dark:bg-teal-500/10 px-3 py-1.5 text-sm text-[var(--primary)] dark:text-teal-400 transition hover:bg-teal-100 dark:hover:bg-teal-500/20"
      >
        Party: <span className="font-semibold">{selectedParty}</span>
        <span className="text-[var(--primary)]/70">×</span>
      </button>
    ) : null}

    {selectedCategory ? (
      <button
        type="button"
        onClick={() => setSelectedCategory("")}
        className="inline-flex items-center gap-2 rounded-full border border-[var(--primary)] bg-teal-50 dark:bg-teal-500/10 px-3 py-1.5 text-sm text-[var(--primary)] dark:text-teal-400 transition hover:bg-teal-100 dark:hover:bg-teal-500/20"
      >
        Category: <span className="font-semibold">{selectedCategory}</span>
        <span className="text-[var(--primary)]/70">×</span>
      </button>
    ) : null}

    {partySearch.trim() ? (
      <button
        type="button"
        onClick={() => setPartySearch("")}
        className="inline-flex items-center gap-2 rounded-full border border-[var(--primary)] bg-teal-50 dark:bg-teal-500/10 px-3 py-1.5 text-sm text-[var(--primary)] dark:text-teal-400 transition hover:bg-teal-100 dark:hover:bg-teal-500/20"
      >
        Search: <span className="font-semibold">{partySearch}</span>
        <span className="text-[var(--primary)]/70">×</span>
      </button>
    ) : null}

    <button
      type="button"
      onClick={() => {
        setSelectedParty("");
        setSelectedCategory("");
        setPartySearch("");
      }}
      className="text-sm font-medium text-[var(--muted)] underline-offset-2 hover:text-[var(--foreground)] hover:underline"
    >
      Clear all
    </button>
  </div>
)}

              <div className="mb-6 grid gap-4 md:grid-cols-4">
                <div className="rounded-xl border border-green-300 dark:border-green-500/20 bg-green-50 dark:bg-green-500/10 p-4 shadow-sm">
                  <p className="text-sm font-medium text-green-800 dark:text-green-400">Total income</p>
                  <p className="text-2xl font-bold text-green-900 dark:text-green-300">
                    ₹{totalIncome.toFixed(2)}
                  </p>
                </div>

                <div className="rounded-xl border border-red-300 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 p-4 shadow-sm">
                  <p className="text-sm font-medium text-red-800 dark:text-red-400">Total expense</p>
                  <p className="text-2xl font-bold text-red-900 dark:text-red-300">
                    ₹{totalExpense.toFixed(2)}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-300 dark:border-slate-500/20 bg-slate-100 dark:bg-slate-500/10 p-4 shadow-sm">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-400">Net</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-slate-300">
                    ₹{netAmount.toFixed(2)}
                  </p>
                </div>

                <div className="rounded-xl border border-blue-300 dark:border-blue-500/20 bg-blue-50 dark:bg-blue-500/10 p-4 shadow-sm">
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-400">Entries</p>
                  <p className="text-2xl font-bold text-blue-900 dark:text-blue-300">{entryCount}</p>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
                <div className="surface-panel p-4 shadow-sm">
                  <div className="mb-4 flex items-center justify-between gap-3">
  <div>
    <h2 className="text-xl font-semibold text-[var(--foreground)]">
      Report table
    </h2>
    <p className="mt-1 text-sm text-[var(--muted)]">
      {selectedParty ? `Showing only ${selectedParty}` : "Showing all parties"}
    </p>
  </div>

  <span className="text-sm text-[var(--muted)]">
    {filteredEntries.length} rows
  </span>
</div>

                  {filteredEntries.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--card-muted)] p-6 text-center">
                      <p className="text-sm font-medium text-[var(--foreground)]">
                        No entries found for this month.
                      </p>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        Pick another month or add ledger entries from the uploads page.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-collapse">
                        <thead>
                          <tr className="border-b border-[var(--border)] text-left">
                            <th className="px-3 py-3 text-sm font-semibold text-[var(--muted)]">
                              Date
                            </th>
                            <th className="px-3 py-3 text-sm font-semibold text-[var(--muted)]">
                              Type
                            </th>
                            <th className="px-3 py-3 text-sm font-semibold text-[var(--muted)]">
                              Amount
                            </th>
                            <th className="px-3 py-3 text-sm font-semibold text-[var(--muted)]">
                              Party
                            </th>
                            <th className="px-3 py-3 text-sm font-semibold text-[var(--muted)]">
                              Project / Site
                            </th>
                            <th className="px-3 py-3 text-sm font-semibold text-[var(--muted)]">
                              Category
                            </th>
                            <th className="px-3 py-3 text-sm font-semibold text-[var(--muted)]">
                              Note
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredEntries.map((entry) => (
                            <tr key={entry.id} className="border-b border-[var(--border)] bg-[var(--card)] hover:bg-[var(--card-muted)] transition-colors">
                              <td className="px-3 py-3 text-sm text-[var(--foreground)]">
                                {entry.entry_date}
                              </td>
                              <td className="px-3 py-3 text-sm">
                                <span
                                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                    entry.entry_type === "income"
                                      ? "bg-green-100 text-green-800 dark:bg-green-500/10 dark:text-green-400"
                                      : "bg-red-100 text-red-800 dark:bg-red-500/10 dark:text-red-400"
                                  }`}
                                >
                                  {entry.entry_type === "income" ? "Income" : "Expense"}
                                </span>
                              </td>
                              <td className="px-3 py-3 text-sm font-medium text-[var(--foreground)]">
                                ₹{Number(entry.amount).toFixed(2)}
                              </td>
                              <td className="px-3 py-3 text-sm text-[var(--foreground)]">
                                {entry.party_name || "-"}
                              </td>
                              <td className="px-3 py-3 text-sm font-medium text-[var(--muted)]">
                                {entry.project_name || "-"}
                              </td>
                              <td className="px-3 py-3 text-sm text-[var(--muted)]">
                                {entry.category || "-"}
                              </td>
                              <td className="max-w-[220px] px-3 py-3 text-sm text-[var(--muted)]">
                                {entry.note || "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="space-y-6">
  <div className="surface-panel p-4 shadow-sm">
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-xl font-semibold text-[var(--foreground)]">
        Party summary
      </h2>
    </div>

<div className="mb-4">
  <input
    type="text"
    value={partySearch}
    onChange={(e) => setPartySearch(e.target.value)}
    placeholder="Search party name..."  
    className="w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] text-[var(--input-text)] px-3 py-2 text-sm outline-none transition focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
  />
</div>

{selectedParty ? (
  <div className="mb-4 flex items-center justify-between rounded-xl border border-[var(--primary)]/30 bg-teal-50 dark:bg-teal-500/10 px-3 py-2">
    <p className="text-sm text-[var(--foreground)]">
      Showing entries for: <span className="font-semibold">{selectedParty}</span>
    </p>
    <button
      type="button"
      onClick={() => setSelectedParty("")}
      className="text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
    >
      Clear
    </button>
  </div>
) : null}

    {partySummary.length === 0 ? (
      <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--card-muted)] p-6 text-center">
        <p className="text-sm font-medium text-[var(--foreground)]">
          No party totals yet.
        </p>
      </div>
    ) : (
      <div className="space-y-3">
        {partySummary.map((item) => (
          <button
  key={item.party}
  type="button"
  onClick={() =>
    setSelectedParty((prev) =>
      prev.toLowerCase() === item.party.toLowerCase() ? "" : item.party
    )
  }
  className={`w-full rounded-xl border p-3 text-left transition ${
    selectedParty.toLowerCase() === item.party.toLowerCase()
      ? "border-[var(--primary)] bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/50"
      : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--border)] hover:bg-[var(--card-muted)]"
  }`}
>
  <div className="flex items-start justify-between gap-3">
    <div>
      <p className="text-sm font-semibold text-[var(--foreground)]">
        {item.party}
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {item.count} entr{item.count === 1 ? "y" : "ies"}
      </p>
    </div>

    <div className="text-right text-xs">
      <p className="text-green-700 dark:text-green-400">
        In: ₹{item.income.toFixed(2)}
      </p>
      <p className="text-red-700 dark:text-red-400">
        Out: ₹{item.expense.toFixed(2)}
      </p>
      <p className="mt-1 font-semibold text-[var(--foreground)]">
        Net: ₹{item.net.toFixed(2)}
      </p>
    </div>
  </div>
</button>
))}
      </div>
    )}
  </div>

  <div className="surface-panel p-4 shadow-sm">
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-xl font-semibold text-[var(--foreground)]">
        Category summary
      </h2>
    </div>

    {categorySummary.length === 0 ? (
      <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--card-muted)] p-6 text-center">
        <p className="text-sm font-medium text-[var(--foreground)]">
          No category totals yet.
        </p>
      </div>
    ) : (
      <div className="space-y-3">
        {categorySummary.map((item) => (
          <button
            key={item.category}
            type="button"
            onClick={() => setSelectedCategory((prev) => prev.toLowerCase() === item.category.toLowerCase() ? "" : item.category)}
            className={`w-full rounded-xl border p-3 transition ${
              selectedCategory.toLowerCase() === item.category.toLowerCase()
                ? "border-[var(--primary)] bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/50"
                : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--border)] hover:bg-[var(--card-muted)]"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-[var(--foreground)]">
                {item.category}
              </p>
              <p className="text-sm font-semibold text-[var(--foreground)]">
                ₹{item.total.toFixed(2)}
              </p>
            </div>
          </button>
        ))}
      </div>
    )}
  </div>
</div>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}