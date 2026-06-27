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
