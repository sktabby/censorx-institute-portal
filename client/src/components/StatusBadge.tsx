const TEAL = "text-cx-accent border-cx-accent/30 bg-cx-tint";
const GREY = "text-gray-700 border-gray-200 bg-gray-100";
const AMBER = "text-amber-700 border-amber-200 bg-amber-50";
const RED = "text-red-700 border-red-200 bg-red-50";

// On a teal card every status becomes a white pill with dark text.
const ON_DARK = "text-cx-heading border-white bg-white font-semibold";

const STYLES: Record<string, string> = {
  ACTIVE: TEAL,
  UNUSED: GREY,
  REDEEMED: TEAL,
  SUSPENDED: RED,
  EXPIRED: AMBER,
  REVOKED: RED,
  REPLACED: GREY,
  DISABLED: RED,
  RENEWED: GREY,
  CANCELLED: RED,
  ARCHIVED: RED,
  DELETED: RED,
  PARTIALLY_EXPIRED: AMBER,
  RETIRED: GREY,
  NONE: GREY,
  PAUSED: RED,
  PENDING: GREY,
};

export default function StatusBadge({ status, tone = "light" }: { status: string; tone?: "light" | "dark" }) {
  const style = tone === "dark" ? ON_DARK : (STYLES[status] ?? GREY);
  return <span className={`badge whitespace-nowrap ${style}`}>{status}</span>;
}
