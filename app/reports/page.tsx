"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

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
          <div key={i} className="app-card p-4">
            <div className="skeleton h-4 w-28" />
            <div className="skeleton mt-3 h-8 w-24" />
          </div>
        ))}
      </div>

      <div className="app-card p-4">
        <div className="skeleton h-10 w-56" />
        <div className="skeleton mt-4 h-10 w-40" />
        <div className="skeleton mt-6 h-12 w-full" />
        <div className="skeleton mt-3 h-12 w-full" />
        <div className="skeleton mt-3 h-12 w-full" />
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

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Ledgersite";
    workbook.created = new Date();

    const summarySheet = workbook.addWorksheet("Monthly Report", {
      views: [{ state: "frozen", ySplit: 4 }],
    });

    const journalSheet = workbook.addWorksheet("Journal", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    const partySummarySheet = workbook.addWorksheet("Party Summary", {
  views: [{ state: "frozen", ySplit: 1 }],
});

    const detailSheet = workbook.addWorksheet("Party Ledger", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    summarySheet.columns = [
      { width: 6 },
      { width: 28 },
      { width: 20 },
      { width: 18 },
      { width: 18 },
    ];

    summarySheet.mergeCells("B2:E2");
    summarySheet.getCell("B2").value = "Ledgersite Monthly Report";
    summarySheet.getCell("B2").font = {
      name: "Calibri",
      size: 16,
      bold: true,
      color: { argb: "0F172A" },
    };

    summarySheet.mergeCells("B3:E3");
    summarySheet.getCell("B3").value = `Month: ${selectedMonth}`;
    summarySheet.getCell("B3").font = {
      name: "Calibri",
      size: 11,
      color: { argb: "475569" },
    };

    const summaryRows = [
      ["Total Income", totalIncome],
      ["Total Expense", totalExpense],
      ["Net Amount", netAmount],
      ["Entry Count", entryCount],
    ];

    const summaryStartRow = 5;

    summaryRows.forEach((item, index) => {
      const rowNumber = summaryStartRow + index;

      summarySheet.getCell(`B${rowNumber}`).value = item[0];
      summarySheet.getCell(`C${rowNumber}`).value = item[1];

      summarySheet.getCell(`B${rowNumber}`).font = {
        name: "Calibri",
        bold: true,
        color: { argb: "1E293B" },
      };
      summarySheet.getCell(`B${rowNumber}`).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "E2E8F0" },
      };

      summarySheet.getCell(`C${rowNumber}`).font = {
        name: "Calibri",
        bold: true,
        color: { argb: "0F172A" },
      };
      summarySheet.getCell(`C${rowNumber}`).numFmt =
        item[0] === "Entry Count" ? "0" : '"Rs." #,##0.00';
      summarySheet.getCell(`C${rowNumber}`).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "F8FAFC" },
      };

      [`B${rowNumber}`, `C${rowNumber}`].forEach((ref) => {
        const cell = summarySheet.getCell(ref);
        cell.alignment = { vertical: "middle", horizontal: "left" };
        cell.border = {
          top: { style: "thin", color: { argb: "CBD5E1" } },
          left: { style: "thin", color: { argb: "CBD5E1" } },
          bottom: { style: "thin", color: { argb: "CBD5E1" } },
          right: { style: "thin", color: { argb: "CBD5E1" } },
        };
      });
    });

    const categoryTitleRow = summaryStartRow + summaryRows.length + 3;
    summarySheet.getCell(`B${categoryTitleRow}`).value = "Category Summary";
    summarySheet.getCell(`B${categoryTitleRow}`).font = {
      name: "Calibri",
      size: 13,
      bold: true,
      color: { argb: "0F172A" },
    };

    const categoryHeaderRow = categoryTitleRow + 1;
    summarySheet.getCell(`B${categoryHeaderRow}`).value = "Category";
    summarySheet.getCell(`C${categoryHeaderRow}`).value = "Total Amount";

    [`B${categoryHeaderRow}`, `C${categoryHeaderRow}`].forEach((ref) => {
      const cell = summarySheet.getCell(ref);
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

    if (categorySummary.length === 0) {
      summarySheet.getCell(`B${categoryHeaderRow + 1}`).value = "No category totals";
      summarySheet.getCell(`B${categoryHeaderRow + 1}`).font = {
        name: "Calibri",
        color: { argb: "64748B" },
      };
    } else {
      categorySummary.forEach((item, index) => {
        const rowNumber = categoryHeaderRow + 1 + index;

        summarySheet.getCell(`B${rowNumber}`).value = item.category;
        summarySheet.getCell(`C${rowNumber}`).value = item.total;
        summarySheet.getCell(`C${rowNumber}`).numFmt = '"Rs." #,##0.00';

        [`B${rowNumber}`, `C${rowNumber}`].forEach((ref) => {
          const cell = summarySheet.getCell(ref);
          cell.font = { name: "Calibri", color: { argb: "0F172A" } };
          cell.alignment = { vertical: "middle", horizontal: "left" };
          cell.border = {
            top: { style: "thin", color: { argb: "E2E8F0" } },
            left: { style: "thin", color: { argb: "E2E8F0" } },
            bottom: { style: "thin", color: { argb: "E2E8F0" } },
            right: { style: "thin", color: { argb: "E2E8F0" } },
          };
        });
      });
    }

    const footerRow = categoryHeaderRow + Math.max(categorySummary.length, 1) + 3;
    summarySheet.getCell(`B${footerRow}`).value = `Generated on: ${new Date().toLocaleString()}`;
    summarySheet.getCell(`B${footerRow}`).font = {
      name: "Calibri",
      size: 10,
      color: { argb: "64748B" },
    };

partySummarySheet.columns = [
  { header: "Party Name", key: "party", width: 28 },
  { header: "Income", key: "income", width: 16 },
  { header: "Expense", key: "expense", width: 16 },
  { header: "Net", key: "net", width: 16 },
  { header: "Entry Count", key: "count", width: 14 },
];

const partySummaryHeader = partySummarySheet.getRow(1);
partySummaryHeader.height = 22;
partySummaryHeader.eachCell((cell) => {
  cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFF" } };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "7C3AED" },
  };
  cell.alignment = { horizontal: "center", vertical: "middle" };
  cell.border = {
    top: { style: "thin", color: { argb: "7C3AED" } },
    left: { style: "thin", color: { argb: "7C3AED" } },
    bottom: { style: "thin", color: { argb: "7C3AED" } },
    right: { style: "thin", color: { argb: "7C3AED" } },
  };
});

 const baseMonthlyEntries = [...ledgerEntries]
  .filter((entry) => {
    if (!includeDrafts && !entry.is_finalised) return false;
    return selectedMonth === "all_time" || entry.entry_date?.startsWith(selectedMonth);
  });

const monthlyEntries: any[] = [];
for (const entry of baseMonthlyEntries) {
  if (entry.is_split && Array.isArray(entry.split_allocations) && entry.split_allocations.length > 0) {
    for (const split of entry.split_allocations) {
      monthlyEntries.push({
        ...entry,
        party_name: split.worker,
        amount: split.amount,
        note: `Sunday Expense (${entry.party_name || "Unknown Party"} a/c)${split.note ? ` - ${split.note}` : ""}`,
        split_batch_id: entry.id // Shared batch ID as requested
      });
    }
  } else {
    monthlyEntries.push(entry);
  }
}

monthlyEntries.sort(
  (a, b) => new Date(b.entry_date).getTime() - new Date(a.entry_date).getTime()
);

const monthlyPartySummaryMap = new Map<
  string,
  {
    party: string;
    income: number;
    expense: number;
    count: number;
  }
>();

for (const entry of monthlyEntries) {
  const key = entry.party_name?.trim() || "Unknown Party";

  if (!monthlyPartySummaryMap.has(key)) {
    monthlyPartySummaryMap.set(key, {
      party: key,
      income: 0,
      expense: 0,
      count: 0,
    });
  }

  const current = monthlyPartySummaryMap.get(key)!;
  const amount = Number(entry.amount);

  if (entry.entry_type === "income") {
    current.income += amount;
  } else {
    current.expense += amount;
  }

  current.count += 1;
}

const monthlyPartySummary = Array.from(monthlyPartySummaryMap.values())
  .map((item) => ({
    ...item,
    net: item.income - item.expense,
  }))
  .sort((a, b) => {
    if (b.expense !== a.expense) return b.expense - a.expense;
    return a.party.localeCompare(b.party);
  });

if (monthlyPartySummary.length === 0) {
  partySummarySheet.getCell("A2").value = "No party totals for this month";
  partySummarySheet.getCell("A2").font = {
    name: "Calibri",
    color: { argb: "64748B" },
  };
} else {
  monthlyPartySummary.forEach((item) => {
    const row = partySummarySheet.addRow({
      party: item.party,
      income: item.income,
      expense: item.expense,
      net: item.net,
      count: item.count,
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

      if (colNumber >= 2 && colNumber <= 5) {
        cell.alignment = {
          horizontal: "right",
          vertical: "middle",
        };
      } else {
        cell.alignment = {
          horizontal: "left",
          vertical: "middle",
        };
      }
    });

    row.getCell(2).numFmt = '"Rs." #,##0.00';
    row.getCell(3).numFmt = '"Rs." #,##0.00';
    row.getCell(4).numFmt = '"Rs." #,##0.00';
    row.getCell(5).numFmt = '0';
  });

  const totalRow = partySummarySheet.addRow({
    party: "Grand Total",
    income: monthlyPartySummary.reduce((sum, item) => sum + item.income, 0),
    expense: monthlyPartySummary.reduce((sum, item) => sum + item.expense, 0),
    net: monthlyPartySummary.reduce((sum, item) => sum + item.net, 0),
    count: monthlyPartySummary.reduce((sum, item) => sum + item.count, 0),
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
      fgColor: { argb: "EDE9FE" },
    };
    cell.border = {
      top: { style: "thin", color: { argb: "C4B5FD" } },
      left: { style: "thin", color: { argb: "C4B5FD" } },
      bottom: { style: "thin", color: { argb: "C4B5FD" } },
      right: { style: "thin", color: { argb: "C4B5FD" } },
    };

    if (colNumber >= 2 && colNumber <= 5) {
      cell.alignment = { horizontal: "right", vertical: "middle" };
    } else {
      cell.alignment = { horizontal: "left", vertical: "middle" };
    }
  });

  totalRow.getCell(2).numFmt = '"Rs." #,##0.00';
  totalRow.getCell(3).numFmt = '"Rs." #,##0.00';
  totalRow.getCell(4).numFmt = '"Rs." #,##0.00';
  totalRow.getCell(5).numFmt = '0';
}

partySummarySheet.autoFilter = {
  from: "A1",
  to: "E1",
};

    detailSheet.columns = [
      { header: "Date", key: "entry_date", width: 15 },
      { header: "Particulars", key: "particulars", width: 26 },
      { header: "Category", key: "category", width: 20 },
      { header: "Narration", key: "narration", width: 42 },
      { header: "Proof Ref", key: "proof_ref", width: 14 },
      { header: "Debit", key: "debit", width: 16 },
      { header: "Credit", key: "credit", width: 16 },
      { header: "Balance", key: "balance", width: 16 },
    ];

    const detailHeader = detailSheet.getRow(1);
    detailHeader.height = 22;
    detailHeader.eachCell((cell) => {
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

const sortedPartyEntries = [...monthlyEntries].sort((a, b) => {
      const partyA = (a.party_name || "Unknown Party").trim().toLowerCase();
      const partyB = (b.party_name || "Unknown Party").trim().toLowerCase();

      if (partyA < partyB) return -1;
      if (partyA > partyB) return 1;

      return new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime();
    });

    let currentParty = "";
    let runningBalance = 0;
    let partyDebitTotal = 0;
    let partyCreditTotal = 0;

    for (const entry of sortedPartyEntries) {
      const partyName = (entry.party_name || "Unknown Party").trim() || "Unknown Party";

      if (partyName !== currentParty) {
        if (currentParty !== "") {
          const subtotalRow = detailSheet.addRow({
            narration: `${currentParty} Total`,
            debit: partyDebitTotal,
            credit: partyCreditTotal,
            balance: runningBalance,
          });

          subtotalRow.eachCell((cell, colNumber) => {
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

          subtotalRow.getCell(6).numFmt = '"Rs." #,##0.00';
          subtotalRow.getCell(7).numFmt = '"Rs." #,##0.00';
          subtotalRow.getCell(8).numFmt = '"Rs." #,##0.00';

          detailSheet.addRow({});
        }

        currentParty = partyName;
        runningBalance = 0;
        partyDebitTotal = 0;
        partyCreditTotal = 0;

        const nameRow = detailSheet.addRow({});
        detailSheet.mergeCells(`A${nameRow.number}:H${nameRow.number}`);

        const mergedCell = detailSheet.getCell(`A${nameRow.number}`);
        mergedCell.value = `Party: ${partyName}`;
        mergedCell.font = {
          name: "Calibri",
          bold: true,
          size: 12,
          color: { argb: "0F172A" },
        };
        mergedCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "E0F2FE" },
        };
        mergedCell.alignment = { horizontal: "left", vertical: "middle" };
        mergedCell.border = {
          top: { style: "thin", color: { argb: "BAE6FD" } },
          left: { style: "thin", color: { argb: "BAE6FD" } },
          bottom: { style: "thin", color: { argb: "BAE6FD" } },
          right: { style: "thin", color: { argb: "BAE6FD" } },
        };
      }

      const amount = Number(entry.amount);
      const debit = entry.entry_type === "expense" ? amount : 0;
      const credit = entry.entry_type === "income" ? amount : 0;

      runningBalance = runningBalance + credit - debit;
      partyDebitTotal += debit;
      partyCreditTotal += credit;

      const particularsText =
  `${entry.entry_type === "income" ? "Income" : "Expense"} - ${entry.category || "General"}`;

   const row = detailSheet.addRow({
      entry_date: entry.entry_date,
      particulars: particularsText,
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

    if (currentParty !== "") {
      const finalSubtotalRow = detailSheet.addRow({
        narration: `${currentParty} Total`,
        debit: partyDebitTotal,
        credit: partyCreditTotal,
        balance: runningBalance,
      });

      finalSubtotalRow.eachCell((cell, colNumber) => {
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

      finalSubtotalRow.getCell(6).numFmt = '"Rs." #,##0.00';
      finalSubtotalRow.getCell(7).numFmt = '"Rs." #,##0.00';
      finalSubtotalRow.getCell(8).numFmt = '"Rs." #,##0.00';
    }

    detailSheet.autoFilter = {
      from: "A1",
      to: "H1",
    };

    journalSheet.columns = [
      { header: "Journal No.", key: "journal_no", width: 14 },
      { header: "Date", key: "date", width: 15 },
      { header: "Particulars", key: "particulars", width: 26 },
      { header: "Category", key: "category", width: 20 },
      { header: "Narration", key: "narration", width: 42 },
      { header: "Debit", key: "debit", width: 16 },
      { header: "Credit", key: "credit", width: 16 },
      { header: "Proof Ref", key: "proof_ref", width: 14 },
    ];

    monthlyEntries.forEach((entry, index) => {
      journalSheet.addRow({
        journal_no: `J-${selectedMonth.replace("-", "")}-${String(index + 1).padStart(3, "0")}`,
        date: entry.entry_date,
        particulars: entry.party_name || "General Entry",
        category: entry.category || "Uncategorized",
        narration: entry.note || "",
        debit: entry.entry_type === "expense" ? Number(entry.amount) : "",
        credit: entry.entry_type === "income" ? Number(entry.amount) : "",
        proof_ref: entry.proof_id ?? "",
      });
    });

    const journalHeader = journalSheet.getRow(1);
    journalHeader.height = 22;
    journalHeader.eachCell((cell) => {
      cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "1D4ED8" },
      };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin", color: { argb: "1D4ED8" } },
        left: { style: "thin", color: { argb: "1D4ED8" } },
        bottom: { style: "thin", color: { argb: "1D4ED8" } },
        right: { style: "thin", color: { argb: "1D4ED8" } },
      };
    });

    journalSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

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
          fgColor: { argb: rowNumber % 2 === 0 ? "FFFFFF" : "F8FAFC" },
        };

        if (colNumber === 5) {
          cell.alignment = {
            horizontal: "left",
            vertical: "middle",
            wrapText: true,
          };
        } else if (colNumber === 6 || colNumber === 7) {
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

      const narrationValue = String(row.getCell(5).value || "");
      if (narrationValue.length > 70) row.height = 38;
      if (narrationValue.length > 130) row.height = 54;
    });

    const totalJournalRow = journalSheet.rowCount + 1;

    journalSheet.getCell(`E${totalJournalRow}`).value = "Total";
    journalSheet.getCell(`E${totalJournalRow}`).font = {
      name: "Calibri",
      bold: true,
      color: { argb: "0F172A" },
    };

    journalSheet.getCell(`F${totalJournalRow}`).value = {
      formula: `SUM(F2:F${totalJournalRow - 1})`,
    };
    journalSheet.getCell(`G${totalJournalRow}`).value = {
      formula: `SUM(G2:G${totalJournalRow - 1})`,
    };

    journalSheet.getCell(`F${totalJournalRow}`).numFmt = '"Rs." #,##0.00';
    journalSheet.getCell(`G${totalJournalRow}`).numFmt = '"Rs." #,##0.00';

    [`E${totalJournalRow}`, `F${totalJournalRow}`, `G${totalJournalRow}`].forEach((ref) => {
      const cell = journalSheet.getCell(ref);
      cell.font = { name: "Calibri", bold: true, color: { argb: "0F172A" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "DBEAFE" },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "93C5FD" } },
        left: { style: "thin", color: { argb: "93C5FD" } },
        bottom: { style: "thin", color: { argb: "93C5FD" } },
        right: { style: "thin", color: { argb: "93C5FD" } },
      };
      cell.alignment = { horizontal: "right", vertical: "middle" };
    });

    journalSheet.autoFilter = {
      from: "A1",
      to: "H1",
    };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
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
        <section className="app-card p-4">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">
                Ledger reports
              </h1>
              <p className="text-sm text-slate-600">
                Monthly report view from your centralized ledger.
              </p>
              <p className="mt-1 text-xs text-slate-500">
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
                    <label className="mb-2 block text-sm font-medium text-slate-800">
                      Select period
                    </label>
                    <select
                      className="app-select"
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
                  <label className="mb-3 flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700">
                    <input type="checkbox" checked={includeDrafts} onChange={e => setIncludeDrafts(e.target.checked)} className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 h-4 w-4" />
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
    <span className="text-sm font-medium text-slate-600">Active filters:</span>

    {selectedParty ? (
      <button
        type="button"
        onClick={() => setSelectedParty("")}
        className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
      >
        Party: <span className="font-semibold text-slate-900">{selectedParty}</span>
        <span className="text-slate-400">×</span>
      </button>
    ) : null}

    {selectedCategory ? (
      <button
        type="button"
        onClick={() => setSelectedCategory("")}
        className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
      >
        Category: <span className="font-semibold text-slate-900">{selectedCategory}</span>
        <span className="text-slate-400">×</span>
      </button>
    ) : null}

    {partySearch.trim() ? (
      <button
        type="button"
        onClick={() => setPartySearch("")}
        className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
      >
        Search: <span className="font-semibold text-slate-900">{partySearch}</span>
        <span className="text-slate-400">×</span>
      </button>
    ) : null}

    <button
      type="button"
      onClick={() => {
        setSelectedParty("");
        setSelectedCategory("");
        setPartySearch("");
      }}
      className="text-sm font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
    >
      Clear all
    </button>
  </div>
)}

              <div className="mb-6 grid gap-4 md:grid-cols-4">
                <div className="rounded-xl border border-green-300 bg-green-50 p-4">
                  <p className="text-sm font-medium text-green-800">Total income</p>
                  <p className="text-2xl font-bold text-green-900">
                    ₹{totalIncome.toFixed(2)}
                  </p>
                </div>

                <div className="rounded-xl border border-red-300 bg-red-50 p-4">
                  <p className="text-sm font-medium text-red-800">Total expense</p>
                  <p className="text-2xl font-bold text-red-900">
                    ₹{totalExpense.toFixed(2)}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-300 bg-slate-100 p-4">
                  <p className="text-sm font-medium text-slate-700">Net</p>
                  <p className="text-2xl font-bold text-slate-900">
                    ₹{netAmount.toFixed(2)}
                  </p>
                </div>

                <div className="rounded-xl border border-blue-300 bg-blue-50 p-4">
                  <p className="text-sm font-medium text-blue-800">Entries</p>
                  <p className="text-2xl font-bold text-blue-900">{entryCount}</p>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
                <div className="app-card p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
  <div>
    <h2 className="text-xl font-semibold text-slate-900">
      Report table
    </h2>
    <p className="mt-1 text-sm text-slate-500">
      {selectedParty ? `Showing only ${selectedParty}` : "Showing all parties"}
    </p>
  </div>

  <span className="text-sm text-slate-500">
    {filteredEntries.length} rows
  </span>
</div>

                  {filteredEntries.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                      <p className="text-sm font-medium text-slate-800">
                        No entries found for this month.
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        Pick another month or add ledger entries from the uploads page.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 text-left">
                            <th className="px-3 py-3 text-sm font-semibold text-slate-700">
                              Date
                            </th>
                            <th className="px-3 py-3 text-sm font-semibold text-slate-700">
                              Type
                            </th>
                            <th className="px-3 py-3 text-sm font-semibold text-slate-700">
                              Amount
                            </th>
                            <th className="px-3 py-3 text-sm font-semibold text-slate-700">
                              Party
                            </th>
                            <th className="px-3 py-3 text-sm font-semibold text-slate-700">
                              Project / Site
                            </th>
                            <th className="px-3 py-3 text-sm font-semibold text-slate-700">
                              Category
                            </th>
                            <th className="px-3 py-3 text-sm font-semibold text-slate-700">
                              Note
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredEntries.map((entry) => (
                            <tr key={entry.id} className="border-b border-slate-100">
                              <td className="px-3 py-3 text-sm text-slate-700">
                                {entry.entry_date}
                              </td>
                              <td className="px-3 py-3 text-sm">
                                <span
                                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                    entry.entry_type === "income"
                                      ? "bg-green-100 text-green-800"
                                      : "bg-red-100 text-red-800"
                                  }`}
                                >
                                  {entry.entry_type === "income" ? "Income" : "Expense"}
                                </span>
                              </td>
                              <td className="px-3 py-3 text-sm font-medium text-slate-900">
                                ₹{Number(entry.amount).toFixed(2)}
                              </td>
                              <td className="px-3 py-3 text-sm text-slate-700">
                                {entry.party_name || "-"}
                              </td>
                              <td className="px-3 py-3 text-sm font-medium text-slate-600">
                                {entry.project_name || "-"}
                              </td>
                              <td className="px-3 py-3 text-sm text-slate-700">
                                {entry.category || "-"}
                              </td>
                              <td className="max-w-[220px] px-3 py-3 text-sm text-slate-600">
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
  <div className="app-card p-4">
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-xl font-semibold text-slate-900">
        Party summary
      </h2>
    </div>

<div className="mb-4">
  <input
    type="text"
    value={partySearch}
    onChange={(e) => setPartySearch(e.target.value)}
    placeholder="Search party name..."  
    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400"
  />
</div>

{selectedParty ? (
  <div className="mb-4 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
    <p className="text-sm text-slate-700">
      Showing entries for: <span className="font-semibold text-slate-900">{selectedParty}</span>
    </p>
    <button
      type="button"
      onClick={() => setSelectedParty("")}
      className="text-xs font-medium text-slate-600 hover:text-slate-900"
    >
      Clear
    </button>
  </div>
) : null}

    {partySummary.length === 0 ? (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
        <p className="text-sm font-medium text-slate-800">
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
      ? "border-slate-900 bg-slate-100 ring-1 ring-slate-300"
      : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100"
  }`}
>
  <div className="flex items-start justify-between gap-3">
    <div>
      <p className="text-sm font-semibold text-slate-900">
        {item.party}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {item.count} entr{item.count === 1 ? "y" : "ies"}
      </p>
    </div>

    <div className="text-right text-xs">
      <p className="text-green-700">
        In: ₹{item.income.toFixed(2)}
      </p>
      <p className="text-red-700">
        Out: ₹{item.expense.toFixed(2)}
      </p>
      <p className="mt-1 font-semibold text-slate-900">
        Net: ₹{item.net.toFixed(2)}
      </p>
    </div>
  </div>
</button>
))}
      </div>
    )}
  </div>

  <div className="app-card p-4">
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-xl font-semibold text-slate-900">
        Category summary
      </h2>
    </div>

    {categorySummary.length === 0 ? (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
        <p className="text-sm font-medium text-slate-800">
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
                ? "border-slate-900 bg-slate-100 ring-1 ring-slate-300"
                : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-800">
                {item.category}
              </p>
              <p className="text-sm font-semibold text-slate-900">
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