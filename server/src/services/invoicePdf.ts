import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { COMPANY, companyContactFooter } from "../config/company";
import { money, type InvoiceModel } from "./invoiceModel";

/**
 * The logo lives in server/assets. Compiled code runs from dist/src/..., source from src/...,
 * so a few locations are tried.
 */
export function logoPath(): string | null {
  const candidates = [
    path.resolve(__dirname, "../../assets/censorx-logo.png"),
    path.resolve(__dirname, "../../../assets/censorx-logo.png"),
    path.resolve(process.cwd(), "assets/censorx-logo.png"),
    path.resolve(process.cwd(), "server/assets/censorx-logo.png"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

const TEAL_DARK = "#0a4743";
const TEAL = "#0f6b65";
const TEAL_LIGHT = "#f3faf9";
const BORDER = "#e5e7eb";
const MUTED = "#6b7280";
const TEXT = "#111827";

const PAGE_BOTTOM = 780;

/**
 * Renders the invoice as an A4 PDF. Amounts use "INR": the built-in PDF fonts have no rupee
 * sign, and INR is the standard written form on Indian invoices.
 */
export function renderInvoicePdf(model: InvoiceModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 40,
      info: { Title: `Invoice ${model.number}`, Author: COMPANY.name, Subject: `${COMPANY.product} invoice` },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = 40;
    const width = 515;
    let y = 40;

    const ensureSpace = (needed: number) => {
      if (y + needed > PAGE_BOTTOM) {
        doc.addPage();
        y = 40;
      }
    };

    // ---- Header band -------------------------------------------------------
    doc.rect(left, y, width, 86).fill(TEAL_DARK);
    const logo = logoPath();
    if (logo) {
      doc.roundedRect(left + 18, y + 17, 52, 52, 10).fill("#041514");
      doc.image(logo, left + 22, y + 21, { fit: [44, 44], align: "center", valign: "center" });
    }
    const brandX = left + (logo ? 84 : 18);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(20).text(COMPANY.name, brandX, y + 24, { width: 260 });
    doc.fillColor("#a7d8d3").font("Helvetica").fontSize(9).text(COMPANY.product.toUpperCase(), brandX, y + 50, {
      width: 260,
      characterSpacing: 1.5,
    });
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text(model.title.toUpperCase(), left, y + 20, {
      width: width - 18,
      align: "right",
      characterSpacing: 2,
    });
    doc.fillColor("#a7d8d3").font("Helvetica").fontSize(9).text(`No. ${model.number}`, left, y + 50, { width: width - 18, align: "right" });
    doc.text(`Date: ${model.date}`, left, y + 63, { width: width - 18, align: "right" });
    y += 104;

    // ---- Updated-bill note ---------------------------------------------------
    if (model.revision) {
      doc.font("Helvetica").fontSize(9);
      const noteHeight = doc.heightOfString(model.revision.note, { width: width - 24 }) + 16;
      doc.roundedRect(left, y, width, noteHeight, 6).fillAndStroke("#eff6ff", "#bfdbfe");
      doc.fillColor("#1e3a8a").font("Helvetica").fontSize(9).text(model.revision.note, left + 12, y + 8, { width: width - 24 });
      y += noteHeight + 14;
    }

    // ---- Parties -----------------------------------------------------------
    const colWidth = (width - 20) / 2;
    const party = (label: string, name: string, lines: string[], x: number) => {
      let py = y;
      doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8).text(label.toUpperCase(), x, py, { width: colWidth, characterSpacing: 1 });
      py += 13;
      doc.fillColor(TEXT).font("Helvetica-Bold").fontSize(11).text(name, x, py, { width: colWidth });
      py += doc.heightOfString(name, { width: colWidth }) + 2;
      doc.font("Helvetica").fontSize(9).fillColor(MUTED);
      lines.forEach((line) => {
        doc.text(line, x, py, { width: colWidth });
        py += doc.heightOfString(line, { width: colWidth }) + 1;
      });
      return py;
    };
    const supplierBottom = party("Billed by", model.supplier.name, model.supplier.lines, left);
    const recipientBottom = party("Billed to", model.recipient.name, model.recipient.lines, left + colWidth + 20);
    y = Math.max(supplierBottom, recipientBottom) + 14;

    // ---- Facts strip ---------------------------------------------------------
    if (model.facts.length > 0) {
      const factWidth = width / model.facts.length;
      doc.rect(left, y, width, 36).fill(TEAL_LIGHT);
      model.facts.forEach(([label, value], index) => {
        const fx = left + index * factWidth + 10;
        doc.fillColor(TEAL).font("Helvetica-Bold").fontSize(7).text(label.toUpperCase(), fx, y + 7, { width: factWidth - 16, characterSpacing: 0.8 });
        doc.fillColor(TEXT).font("Helvetica").fontSize(9).text(value, fx, y + 19, { width: factWidth - 16 });
      });
      y += 50;
    }

    // ---- Items table ---------------------------------------------------------
    const cols = model.showMonths
      ? [
          { key: "#", w: 24, align: "left" },
          { key: "Item", w: 215, align: "left" },
          { key: "Qty", w: 56, align: "right" },
          { key: "Rate / code / month", w: 82, align: "right" },
          { key: "Months", w: 48, align: "right" },
          { key: "Amount (INR)", w: 90, align: "right" },
        ]
      : [
          { key: "#", w: 24, align: "left" },
          { key: "Item", w: 265, align: "left" },
          { key: "Qty", w: 56, align: "right" },
          { key: "Rate (INR)", w: 80, align: "right" },
          { key: "Amount (INR)", w: 90, align: "right" },
        ];

    // Tall enough for the two-line "Rate / code / month" heading.
    const headerHeight = model.showMonths ? 30 : 22;
    const drawHeader = () => {
      doc.rect(left, y, width, headerHeight).fill(TEAL);
      let cx = left;
      cols.forEach((col) => {
        doc.font("Helvetica-Bold").fontSize(8);
        const labelHeight = doc.heightOfString(col.key.toUpperCase(), { width: col.w - 12 });
        doc.fillColor("#ffffff").text(col.key.toUpperCase(), cx + 6, y + (headerHeight - labelHeight) / 2, {
          width: col.w - 12,
          align: col.align as "left" | "right",
        });
        cx += col.w;
      });
      y += headerHeight;
    };
    drawHeader();

    model.items.forEach((line, index) => {
      const itemWidth = cols[1].w - 12;
      doc.font("Helvetica-Bold").fontSize(9.5);
      const itemHeight = doc.heightOfString(line.item, { width: itemWidth });
      doc.font("Helvetica").fontSize(8);
      const detailHeight = line.detail ? doc.heightOfString(line.detail, { width: itemWidth }) + 2 : 0;
      const rowHeight = Math.max(24, itemHeight + detailHeight + 14);
      if (y + rowHeight > PAGE_BOTTOM) {
        doc.addPage();
        y = 40;
        drawHeader();
      }
      if (index % 2 === 1) doc.rect(left, y, width, rowHeight).fill("#fafafa");

      const cells = model.showMonths
        ? [
            String(index + 1),
            null,
            `${line.quantity} ${line.unit === "codes" ? "codes" : ""}`.trim(),
            money(line.rate),
            line.months !== null ? String(line.months) : "—",
            money(line.amount),
          ]
        : [String(index + 1), null, String(line.quantity), money(line.rate), money(line.amount)];

      let cx = left;
      cols.forEach((col, colIndex) => {
        if (colIndex === 1) {
          doc.fillColor(TEXT).font("Helvetica-Bold").fontSize(9.5).text(line.item, cx + 6, y + 7, { width: itemWidth });
          if (line.detail) {
            doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(line.detail, cx + 6, y + 9 + itemHeight, { width: itemWidth });
          }
        } else {
          doc.fillColor(TEXT).font("Helvetica").fontSize(9).text(cells[colIndex] ?? "", cx + 6, y + 7, {
            width: col.w - 12,
            align: col.align as "left" | "right",
          });
        }
        cx += col.w;
      });
      y += rowHeight;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor(BORDER).stroke();
    });
    y += 10;

    // ---- Classes covered -----------------------------------------------------
    if (model.classes.length > 0) {
      const text = model.classes.map((item) => (item.codes !== null ? `${item.name} (${item.codes} codes)` : item.name)).join(", ");
      ensureSpace(30);
      doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8).text("CLASSES COVERED", left, y, { characterSpacing: 0.8 });
      y += 12;
      doc.fillColor(TEXT).font("Helvetica").fontSize(9).text(text, left, y, { width });
      y += doc.heightOfString(text, { width }) + 10;
    }

    // ---- Totals ----------------------------------------------------------------
    const totals: Array<[string, string, boolean]> = [["Subtotal", money(model.subtotal), false]];
    if (model.discount > 0) totals.push([model.discountLabel, `- ${money(model.discount)}`, false]);
    totals.push(["Total amount", `INR ${money(model.total)}`, true]);
    totals.push(["Amount paid", money(model.paid), false]);
    totals.push(["Balance due", `INR ${money(model.pending)}`, true]);

    ensureSpace(totals.length * 18 + 60);
    const totalsX = left + width - 230;
    const totalsTop = y;
    totals.forEach(([label, value, bold], index) => {
      if (index > 0 && (label === "Total amount" || label === "Balance due")) {
        doc.moveTo(totalsX, y).lineTo(left + width, y).lineWidth(0.5).strokeColor(BORDER).stroke();
        y += 4;
      }
      doc.fillColor(bold ? TEXT : MUTED).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 10.5 : 9.5);
      doc.text(label, totalsX, y, { width: 120 });
      doc.fillColor(TEXT).text(value, totalsX + 110, y, { width: 120, align: "right" });
      y += bold ? 18 : 16;
    });

    // Status pill, beside the totals.
    doc.roundedRect(left, totalsTop, 120, 22, 11).fill(model.status === "PREPAID" ? TEAL_LIGHT : model.status === "INSTALLMENTS" ? "#eff6ff" : "#fffbeb");
    doc.fillColor(model.status === "PREPAID" ? TEAL : model.status === "INSTALLMENTS" ? "#1d4ed8" : "#b45309")
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(model.statusLabel, left, totalsTop + 7, { width: 120, align: "center" });
    y += 6;

    // ---- Amount in words -------------------------------------------------------
    ensureSpace(40);
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8).text("AMOUNT IN WORDS", left, y, { characterSpacing: 0.8 });
    y += 12;
    doc.fillColor(TEXT).font("Helvetica-Oblique").fontSize(9.5).text(model.amountInWords, left, y, { width });
    y += doc.heightOfString(model.amountInWords, { width }) + 14;

    // ---- Installment schedule + payments received ------------------------------
    const smallTable = (
      title: string,
      headers: Array<{ label: string; w: number; align: "left" | "right" }>,
      rows: Array<Array<{ text: string; color?: string; bold?: boolean }>>
    ) => {
      ensureSpace(32 + Math.min(rows.length, 3) * 15);
      doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8).text(title.toUpperCase(), left, y, { characterSpacing: 0.8 });
      y += 13;
      let hx = left;
      headers.forEach((col) => {
        doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(7.5).text(col.label.toUpperCase(), hx + 4, y, { width: col.w - 8, align: col.align });
        hx += col.w;
      });
      y += 12;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor(BORDER).stroke();
      y += 4;
      rows.forEach((cells) => {
        ensureSpace(15);
        let cx = left;
        cells.forEach((cell, index) => {
          const col = headers[index];
          doc.fillColor(cell.color ?? TEXT).font(cell.bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).text(cell.text, cx + 4, y, {
            width: col.w - 8,
            align: col.align,
          });
          cx += col.w;
        });
        y += 15;
      });
      y += 8;
    };

    if (model.schedule.length > 0) {
      const statusColor: Record<string, string> = { Paid: TEAL, Overdue: "#b91c1c", Due: "#b45309" };
      smallTable(
        "Installment schedule",
        [
          { label: "#", w: 40, align: "left" },
          { label: "Due date", w: 175, align: "left" },
          { label: "Amount (INR)", w: 150, align: "right" },
          { label: "Status", w: 150, align: "right" },
        ],
        model.schedule.map((row) => [
          { text: String(row.number) },
          { text: row.dueDate },
          { text: money(row.amount) },
          { text: row.status, color: statusColor[row.status] ?? MUTED, bold: true },
        ])
      );
    }

    if (model.history.length > 0) {
      smallTable(
        "Payments received",
        [
          { label: "Date", w: 115, align: "left" },
          { label: "Method", w: 100, align: "left" },
          { label: "Bill", w: 170, align: "left" },
          { label: "Amount (INR)", w: 130, align: "right" },
        ],
        model.history.map((row) => [{ text: row.date }, { text: row.method }, { text: row.billNumber }, { text: money(row.amount), bold: true }])
      );
    }

    // ---- Payment details -------------------------------------------------------
    const paymentHeight = model.paymentLines.length * 14 + 28;
    ensureSpace(paymentHeight + 10);
    doc.roundedRect(left, y, width, paymentHeight, 8).lineWidth(0.8).strokeColor("#d7ebe8").fillAndStroke(TEAL_LIGHT, "#d7ebe8");
    doc.fillColor(TEAL).font("Helvetica-Bold").fontSize(8).text("PAYMENT DETAILS", left + 14, y + 10, { characterSpacing: 0.8 });
    let py = y + 24;
    model.paymentLines.forEach(([label, value]) => {
      doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(label, left + 14, py, { width: 160 });
      doc.fillColor(TEXT).text(value, left + 180, py, { width: width - 194 });
      py += 14;
    });
    y += paymentHeight + 16;

    // ---- Terms -----------------------------------------------------------------
    doc.font("Helvetica").fontSize(8.5);
    const termsHeight = model.terms.reduce((sum, term) => sum + doc.heightOfString(`• ${term}`, { width }) + 3, 14);
    ensureSpace(termsHeight);
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8).text("TERMS", left, y, { characterSpacing: 0.8 });
    y += 12;
    doc.font("Helvetica").fontSize(8.5).fillColor(TEXT);
    model.terms.forEach((term) => {
      doc.text(`• ${term}`, left, y, { width });
      y += doc.heightOfString(`• ${term}`, { width }) + 3;
    });
    y += 15;

    // ---- Footer -----------------------------------------------------------------
    ensureSpace(30);
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor(BORDER).stroke();
    y += 8;
    doc.fillColor("#9ca3af").font("Helvetica").fontSize(8).text(model.footer, left, y, { width, align: "center" });
    doc.text(companyContactFooter(), left, y + 11, { width, align: "center" });

    doc.end();
  });
}
