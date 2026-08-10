const STYLES: Record<string, string> = {
  ACTIVE: "text-cx-accent2 border-cx-accent2/40 bg-cx-accent2/10",
  UNUSED: "text-cx-accent border-cx-accent/40 bg-cx-accent/10",
  REDEEMED: "text-cx-accent2 border-cx-accent2/40 bg-cx-accent2/10",
  SUSPENDED: "text-amber-400 border-amber-400/40 bg-amber-400/10",
  EXPIRED: "text-red-400 border-red-400/40 bg-red-400/10",
  REVOKED: "text-red-400 border-red-400/40 bg-red-400/10",
  REPLACED: "text-cx-muted border-cx-border bg-white/5",
  DISABLED: "text-red-400 border-red-400/40 bg-red-400/10",
  RENEWED: "text-cx-muted border-cx-border bg-white/5",
  CANCELLED: "text-red-400 border-red-400/40 bg-red-400/10",
  ARCHIVED: "text-cx-muted border-cx-border bg-white/5",
  DELETED: "text-red-400 border-red-400/40 bg-red-400/10",
  PARTIALLY_EXPIRED: "text-amber-400 border-amber-400/40 bg-amber-400/10",
  RETIRED: "text-cx-muted border-cx-border bg-white/5",
  NONE: "text-cx-muted border-cx-border bg-white/5",
};

export default function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STYLES[status] ?? "text-cx-muted border-cx-border bg-white/5"}`}>{status}</span>;
}
