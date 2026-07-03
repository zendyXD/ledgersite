import ExcelJS from "exceljs";

export async function generateProofExcelBuffer(proof: any, ledgerEntry?: any): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "LedgerSite";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Ledger Export");

  // Define columns
  worksheet.columns = [
    { header: "Date", key: "date", width: 15 },
    { header: "Party Name", key: "party", width: 25 },
    { header: "Amount", key: "amount", width: 15 },
    { header: "Category", key: "category", width: 20 },
    { header: "Type", key: "type", width: 15 },
    { header: "Note", key: "note", width: 35 },
  ];

  // Make header row bold
  worksheet.getRow(1).font = { bold: true };

  // Check if we have a split ledger entry
  if (ledgerEntry && ledgerEntry.is_split && ledgerEntry.split_allocations) {
    ledgerEntry.split_allocations.forEach((split: any) => {
      worksheet.addRow({
        date: ledgerEntry.entry_date || proof.extracted_date || "",
        party: split.party_name || ledgerEntry.party_name || proof.extracted_party || "",
        amount: split.amount || 0,
        category: split.category || ledgerEntry.category || proof.extracted_category || "",
        type: ledgerEntry.entry_type || proof.extracted_entry_type || "",
        note: split.note || ledgerEntry.note || proof.comment || ""
      });
    });
  } else {
    // Normal single row
    worksheet.addRow({
      date: proof.extracted_date || "",
      party: proof.extracted_party || "",
      amount: proof.extracted_amount || 0,
      category: proof.extracted_category || "",
      type: proof.extracted_entry_type || "",
      note: proof.comment || ""
    });
  }

  // Format amount column as currency
  worksheet.getColumn("amount").numFmt = "₹#,##0.00";

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as unknown as Buffer;
}

export async function generateLedgerExcelBuffer(entries: any[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "LedgerSite";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Monthly Ledger");

  worksheet.columns = [
    { header: "Date", key: "date", width: 15 },
    { header: "Party Name", key: "party", width: 25 },
    { header: "Amount", key: "amount", width: 15 },
    { header: "Category", key: "category", width: 20 },
    { header: "Type", key: "type", width: 15 },
    { header: "Note", key: "note", width: 35 },
  ];

  worksheet.getRow(1).font = { bold: true };

  let totalExpense = 0;
  let totalIncome = 0;

  for (const entry of entries) {
    if (entry.is_split && entry.split_allocations) {
      entry.split_allocations.forEach((split: any) => {
        worksheet.addRow({
          date: entry.entry_date || "",
          party: split.party_name || entry.party_name || "",
          amount: split.amount || 0,
          category: split.category || entry.category || "",
          type: entry.entry_type || "",
          note: split.note || entry.note || ""
        });
        if (entry.entry_type === "expense") totalExpense += parseFloat(split.amount || 0);
        else totalIncome += parseFloat(split.amount || 0);
      });
    } else {
      worksheet.addRow({
        date: entry.entry_date || "",
        party: entry.party_name || "",
        amount: entry.amount || 0,
        category: entry.category || "",
        type: entry.entry_type || "",
        note: entry.note || ""
      });
      if (entry.entry_type === "expense") totalExpense += parseFloat(entry.amount || 0);
      else totalIncome += parseFloat(entry.amount || 0);
    }
  }

  // Add empty row then totals
  worksheet.addRow({});
  const totalsRow = worksheet.addRow({
    date: "TOTALS",
    party: `Income: ₹${totalIncome.toFixed(2)}`,
    amount: `Expense: ₹${totalExpense.toFixed(2)}`,
    category: `Net: ₹${(totalIncome - totalExpense).toFixed(2)}`
  });
  totalsRow.font = { bold: true };

  worksheet.getColumn("amount").numFmt = "₹#,##0.00";

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as unknown as Buffer;
}


export interface ExportMetadata {
  month: string;
}

export async function generateDetailedExportBuffer(
  baseMonthlyEntries: any[],
  metadata: ExportMetadata
): Promise<ExcelJS.Buffer> {
  const selectedMonth = metadata.month;

  const totalIncome = baseMonthlyEntries
    .filter((entry) => entry.entry_type === "income")
    .reduce((sum, entry) => sum + Number(entry.amount), 0);

  const totalExpense = baseMonthlyEntries
    .filter((entry) => entry.entry_type === "expense")
    .reduce((sum, entry) => sum + Number(entry.amount), 0);

  const netAmount = totalIncome - totalExpense;
  const entryCount = baseMonthlyEntries.length;

  const categoryMap = new Map<string, number>();
  for (const entry of baseMonthlyEntries) {
    const key = entry.category?.trim() || "Uncategorized";
    categoryMap.set(key, (categoryMap.get(key) || 0) + Number(entry.amount));
  }
  const categorySummary = Array.from(categoryMap.entries())
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);

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
  return buffer;
}
