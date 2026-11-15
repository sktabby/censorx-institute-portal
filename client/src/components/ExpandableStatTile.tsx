import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export interface TileDetailRow {
  key: string;
  label: string;
  value: ReactNode;
  /** Small coloured dot before the label. */
  tone?: "live" | "warn" | "off";
}

const DOT: Record<NonNullable<TileDetailRow["tone"]>, string> = {
  live: "bg-cx-accent",
  warn: "bg-amber-500",
  off: "bg-gray-300",
};

/**
 * Dashboard stat tile with a breakdown popup (one row per subscription). Tap the tile to open
 * it; it floats over the page under the tile, so nothing below moves. Closes on a tap outside,
 * on Escape, or on tapping the tile again.
 *
 * `popupAlign` keeps the popup on screen: "left-0" opens towards the right (left column),
 * "right-0" towards the left (right column). Responsive classes may be combined.
 */
export default function ExpandableStatTile({
  label,
  value,
  icon,
  rows,
  emptyText = "No subscriptions yet.",
  delay = 0,
  popupAlign = "left-0",
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  rows: TileDetailRow[];
  emptyText?: string;
  delay?: number;
  /** Tailwind position classes for the popup, e.g. "left-0" or "right-0 lg:left-0 lg:right-auto". */
  popupAlign?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={`relative ${open ? "z-30" : "z-0"}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        className="grid w-full grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-2 rounded-2xl bg-gradient-to-br from-cx-mid via-cx-dark to-cx-night p-3 text-left text-white shadow-card outline-none ring-1 ring-white/10 animate-fade-up transition duration-300 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-cx-bright motion-reduce:animate-none motion-reduce:transition-none sm:gap-x-3 sm:p-4"
        style={{ animationDelay: `${delay}ms` }}
      >
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10 text-cx-bright ring-1 ring-white/15 sm:h-10 sm:w-10">
          {icon}
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`justify-self-end text-white/60 transition-transform duration-200 ease-out motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
        {/* Own full-width line, wrapped only between words (never "SUBSCRIPTION / S"). */}
        <span className="col-span-2 min-w-0 break-normal text-[10px] font-medium uppercase leading-tight tracking-wide text-white/70 [hyphens:none] sm:text-[11px] sm:tracking-wider">
          {label}
        </span>
        <span className="col-span-2 min-w-0 break-words text-lg font-bold leading-tight sm:text-2xl">{value}</span>
      </button>

      {/* Popup: floats under the tile; kept mounted so it can fade and scale in and out. */}
      <div
        id={panelId}
        role="dialog"
        aria-label={label}
        aria-hidden={!open}
        className={`absolute top-full mt-2 w-[min(17rem,calc(100vw-2rem))] origin-top rounded-2xl border border-cx-border bg-white p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.18)] transition duration-200 ease-out motion-reduce:transition-none ${popupAlign} ${
          open ? "visible translate-y-0 scale-100 opacity-100" : "pointer-events-none invisible -translate-y-1 scale-95 opacity-0"
        }`}
      >
        <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-cx-muted">{label}</p>
        <ul className="max-h-60 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
          {rows.length === 0 ? (
            <li className="px-2.5 py-2 text-xs text-cx-muted">{emptyText}</li>
          ) : (
            rows.map((row) => (
              <li
                key={row.key}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-lg px-2.5 py-2 text-xs odd:bg-cx-tint/60 sm:text-[13px]"
              >
                <span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-cx-text">
                  {row.tone && <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT[row.tone]}`} />}
                  {row.label}
                </span>
                <span className="ml-auto whitespace-nowrap text-right font-semibold text-cx-heading">{row.value}</span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
