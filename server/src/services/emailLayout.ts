import { COMPANY } from "../config/company";

/**
 * One layout for every email to a school: the same CensorX for Schools header (logo on dark
 * teal, like the invoice), the same section styles and the same signature. Each email is
 * written once as blocks and rendered both as plain text and as HTML.
 */

export type EmailBlock =
  | { kind: "p"; text: string }
  /** A titled list of "Label: value" rows. Rows with an empty value are left out. */
  | { kind: "facts"; title: string; intro?: string; rows: Array<[string, string | null | undefined | false]>; outro?: string }
  | { kind: "steps"; title?: string; items: string[] }
  | { kind: "bullets"; title?: string; items: string[] };

export interface EmailContent {
  /** Shown as the title of the HTML email, under the header. */
  heading: string;
  greeting: string;
  blocks: EmailBlock[];
  /** "whatsapp" adds the WhatsApp numbers to the signature (payment and access emails). */
  signature?: "standard" | "whatsapp";
}

export const LOGO_CID = "censorx-logo";

function signatureLines(kind: EmailContent["signature"]) {
  const contact =
    kind === "whatsapp" && COMPANY.whatsapp.length
      ? `${COMPANY.email} | WhatsApp: ${COMPANY.whatsapp.join(", ")} | ${COMPANY.website}`
      : `${COMPANY.email} | ${COMPANY.website}`;
  return ["Warm regards,", "Team CensorX", COMPANY.name, contact];
}

function presentRows(rows: Array<[string, string | null | undefined | false]>): Array<[string, string]> {
  return rows.filter((row): row is [string, string] => typeof row[1] === "string" && row[1].length > 0);
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

function blockText(block: EmailBlock): string {
  switch (block.kind) {
    case "p":
      return block.text;
    case "facts": {
      const rows = presentRows(block.rows);
      const width = Math.max(0, ...rows.map(([label]) => label.length + 1)) + 2;
      return [
        block.title,
        ...(block.intro ? [`  ${block.intro}`] : []),
        ...rows.map(([label, value]) => `  ${`${label}:`.padEnd(width)}${value}`),
        ...(block.outro ? [`  ${block.outro}`] : []),
      ].join("\n");
    }
    case "steps":
      return [...(block.title ? [block.title] : []), ...block.items.map((item, index) => `${index + 1}. ${item}`)].join("\n");
    case "bullets":
      return [...(block.title ? [block.title] : []), ...block.items.map((item) => `  • ${item}`)].join("\n");
  }
}

export function renderEmailText(content: EmailContent): string {
  return [content.greeting, ...content.blocks.map(blockText), signatureLines(content.signature).join("\n")].join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function esc(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Escapes text and turns web addresses and email addresses into links. */
function linkify(value: string) {
  return esc(value)
    .replace(/https?:\/\/[^\s)<]+/g, (url) => `<a href="${url}" style="color:#0f6b65;font-weight:600;text-decoration:underline;">${url}</a>`)
    .replace(
      /(^|[\s(])([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
      (_match, lead: string, email: string) => `${lead}<a href="mailto:${email}" style="color:#0f6b65;text-decoration:underline;">${email}</a>`
    );
}

const SECTION_TITLE = "font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#0f6b65;font-weight:700;";
const BODY_TEXT = "font-size:14px;line-height:1.6;color:#374151;";

function blockHtml(block: EmailBlock): string {
  switch (block.kind) {
    case "p":
      return `<p style="margin:0 0 16px;${BODY_TEXT}">${linkify(block.text)}</p>`;
    case "facts": {
      const rows = presentRows(block.rows)
        .map(
          ([label, value]) => `<tr>
            <td valign="top" style="padding:4px 12px 4px 0;font-size:13px;color:#6b7280;width:40%;">${esc(label)}</td>
            <td valign="top" style="padding:4px 0;font-size:13px;color:#111827;font-weight:600;">${linkify(value)}</td>
          </tr>`
        )
        .join("");
      return `<div style="margin:0 0 16px;background:#f3faf9;border:1px solid #d7ebe8;border-radius:10px;padding:14px 16px;">
        <div style="${SECTION_TITLE}margin-bottom:6px;">${esc(block.title)}</div>
        ${block.intro ? `<div style="font-size:13px;color:#374151;margin-bottom:4px;">${linkify(block.intro)}</div>` : ""}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
        ${block.outro ? `<div style="font-size:13px;color:#374151;margin-top:6px;">${linkify(block.outro)}</div>` : ""}
      </div>`;
    }
    case "steps":
    case "bullets": {
      const tag = block.kind === "steps" ? "ol" : "ul";
      return `<div style="margin:0 0 16px;">
        ${block.title ? `<div style="${SECTION_TITLE}margin-bottom:6px;">${esc(block.title)}</div>` : ""}
        <${tag} style="margin:0;padding-left:22px;${BODY_TEXT}">
          ${block.items.map((item) => `<li style="margin:0 0 6px;">${linkify(item)}</li>`).join("")}
        </${tag}>
      </div>`;
    }
  }
}

/** The email as HTML. `logoSrc` is usually "cid:censorx-logo" (the logo attached inline). */
export function renderEmailHtml(content: EmailContent, logoSrc: string | null): string {
  const signature = signatureLines(content.signature);
  const whatsapp = COMPANY.whatsapp.length ? ` · WhatsApp ${COMPANY.whatsapp.join(", ")}` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(content.heading)}</title>
</head>
<body style="margin:0;background:#f3f4f6;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">

    <tr><td style="background:#0a4743;padding:22px 28px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        ${
          logoSrc
            ? `<td valign="middle" style="padding-right:14px;"><div style="background:#041514;border-radius:12px;padding:6px;width:40px;height:40px;"><img src="${logoSrc}" width="40" height="40" alt="CensorX" style="display:block;width:40px;height:40px;"></div></td>`
            : ""
        }
        <td valign="middle">
          <div style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">${esc(COMPANY.name)}</div>
          <div style="margin-top:3px;font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:#a7d8d3;">${esc(COMPANY.product)}</div>
        </td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:26px 28px 6px;">
      <div style="font-size:19px;font-weight:700;color:#0b1220;margin:0 0 18px;">${esc(content.heading)}</div>
      <p style="margin:0 0 16px;${BODY_TEXT}">${esc(content.greeting)}</p>
      ${content.blocks.map(blockHtml).join("\n")}
      <div style="margin:8px 0 22px;">
        <a href="${COMPANY.portalUrl}" style="display:inline-block;background:#0f6b65;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:10px;">Open the school portal</a>
      </div>
      <p style="margin:0 0 24px;${BODY_TEXT}">${signature.slice(0, -1).map(esc).join("<br>")}<br><span style="color:#6b7280;">${linkify(signature[signature.length - 1])}</span></p>
    </td></tr>

    <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:14px 28px;text-align:center;">
      <div style="font-size:11px;color:#6b7280;">${esc(COMPANY.name)} · ${esc(COMPANY.product)}</div>
      <div style="margin-top:3px;font-size:11px;color:#9ca3af;">${esc(COMPANY.email)}${esc(whatsapp)} · ${esc(COMPANY.website)}</div>
    </td></tr>

  </table>
</td></tr>
</table>
</body>
</html>`;
}
