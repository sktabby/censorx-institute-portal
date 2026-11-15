import ExcelJS from "exceljs";
import { ApiError } from "../middleware/errorHandler";

/**
 * Excel files for the admin's Create Codes page:
 *   - the codes just made, as an .xlsx (one sheet per class), and
 *   - reading a file of student IDs (first column of the first sheet).
 * Neither touches the database.
 */

export interface CreatedCodesClass {
  batchName: string;
  codes: Array<{ plaintextCode: string; studentIdentifier?: string | null; codeLast4: string; licenseId: string }>;
}

/** Excel sheet names: at most 31 characters, none of : \ / ? * [ ], and unique. */
function sheetName(name: string, used: Set<string>) {
  const base = (name.replace(/[:\\/?*[\]]/g, " ").trim() || "Codes").slice(0, 31);
  let candidate = base;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** The codes just made: one sheet per class, same columns as the old CSV. */
export async function buildCreatedCodesWorkbook(input: { schoolName?: string; classes: CreatedCodesClass[] }): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CensorX for Schools";
  workbook.created = new Date();
  const used = new Set<string>();

  for (const item of input.classes) {
    const sheet = workbook.addWorksheet(sheetName(item.batchName, used), { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = [
      { header: "Class", key: "batchName", width: 18 },
      { header: "Serial number", key: "serial", width: 14 },
      { header: "Student activation code", key: "code", width: 28 },
      { header: "Student ID", key: "studentId", width: 18 },
      { header: "Code last four", key: "last4", width: 15 },
      { header: "License ID", key: "licenseId", width: 26 },
    ];
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F6B65" } };
    item.codes.forEach((code, index) => {
      sheet.addRow({
        batchName: item.batchName,
        serial: index + 1,
        code: code.plaintextCode,
        studentId: code.studentIdentifier ?? "",
        last4: code.codeLast4,
        licenseId: code.licenseId,
      });
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

/** Text of an Excel cell, whatever its type (number, text, formula result, rich text). */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("result" in value && value.result !== undefined) return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return String(value.text);
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return "";
  }
  return String(value);
}

/** Values of the first column of the first sheet of an .xlsx file, empty cells skipped. */
export async function readFirstColumn(fileBase64: string): Promise<string[]> {
  const buffer = Buffer.from(fileBase64, "base64");
  if (buffer.length === 0) throw new ApiError(400, "FILE_EMPTY", "The file is empty.");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ApiError(400, "FILE_UNREADABLE", "This file could not be read. Save it as .xlsx or .csv and try again.");
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ApiError(400, "FILE_EMPTY", "The file has no sheet.");
  const values: string[] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const text = cellText(row.getCell(1).value).trim();
    if (text) values.push(text);
  });
  return values;
}
