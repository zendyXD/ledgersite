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
  return buffer as Buffer;
}
