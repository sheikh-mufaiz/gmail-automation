import * as XLSX from "xlsx";

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface ParsedRecipients {
  recipients: string[];
  scannedCells: number;
  invalidCount: number;
  duplicateCount: number;
}

/**
 * Scans every cell of every sheet for anything that looks like an email
 * address. This is intentionally header-agnostic: a bare list of emails
 * with no title row works exactly the same as a sheet with an "email"
 * column header.
 */
export function extractRecipients(buffer: ArrayBuffer): ParsedRecipients {
  const workbook = XLSX.read(buffer, { type: "array" });

  const seen = new Set<string>();
  const recipients: string[] = [];
  let scannedCells = 0;
  let invalidCount = 0;
  let duplicateCount = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });

    for (const row of rows) {
      for (const cell of row) {
        if (cell === null || cell === undefined) continue;
        const value = String(cell).trim();
        if (!value) continue;

        scannedCells++;
        if (!EMAIL_REGEX.test(value)) {
          invalidCount++;
          continue;
        }

        const lower = value.toLowerCase();
        if (seen.has(lower)) {
          duplicateCount++;
          continue;
        }
        seen.add(lower);
        recipients.push(value);
      }
    }
  }

  return { recipients, scannedCells, invalidCount, duplicateCount };
}
