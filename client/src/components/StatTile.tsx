import type { ReactNode } from "react";

/**
 * Compact stat tile with an entrance animation and a hover lift.
 * Default: on phones the icon and title share one row with the value underneath;
 * from sm up the icon sits beside title and value. `compact` keeps the stacked
 * layout at every width and uses smaller type. `variant="black"` gives the black
 * theme and `align="center"` centres the icon, title and value.
 */
export default function StatTile({
  label,
  value,
  icon,
  delay = 0,
  variant = "teal",
  compact = false,
  align = "start",
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  delay?: number;
  variant?: "teal" | "black";
  compact?: boolean;
  align?: "start" | "center";
}) {
  const surface =
    variant === "black" ? "from-[#0c1211] via-[#070c0b] to-black" : "from-cx-mid via-cx-dark to-cx-night";

  const iconSize = compact ? "h-8 w-8" : "h-9 w-9 sm:h-10 sm:w-10";
  const iconBase =
    "inline-flex shrink-0 items-center justify-center rounded-xl bg-white/10 text-cx-bright ring-1 ring-white/15 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110 motion-reduce:transition-none";
  const labelSize = compact ? "text-[10px]" : "text-[11px]";
  const valueSize = compact ? "text-lg" : "text-xl sm:text-2xl";

  return (
    <div
      className={`group rounded-2xl bg-gradient-to-br ${surface} text-white shadow-card ring-1 ring-white/10 transition duration-300 hover:-translate-y-1 animate-fade-up motion-reduce:animate-none motion-reduce:transition-none ${
        compact ? "p-3" : "p-3.5 sm:p-4"
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {align === "center" ? (
        // Phones: icon, title and value stacked on one centre line.
        // Desktop (lg): icon and title share a row, left-aligned, with the value below.
        <div className="grid grid-cols-1 justify-items-center gap-1.5 text-center lg:grid-cols-[auto_1fr] lg:items-center lg:justify-items-start lg:gap-x-2.5 lg:gap-y-2 lg:text-left">
          <span className={`${iconBase} ${iconSize}`}>{icon}</span>
          <p className={`min-w-0 font-medium uppercase leading-tight tracking-wider text-white/70 ${labelSize}`}>
            {label}
          </p>
          <p
            className={`min-w-0 break-words font-bold leading-tight text-white lg:col-span-2 lg:w-full lg:justify-self-stretch lg:text-center ${valueSize}`}
          >
            {value}
          </p>
        </div>
      ) : (
        <div
          className={`grid grid-cols-[auto_1fr] items-center ${
            compact ? "gap-x-2 gap-y-1.5" : "gap-x-2.5 gap-y-2 sm:gap-x-3.5 sm:gap-y-0.5"
          }`}
        >
          <span className={`${iconBase} ${iconSize} ${compact ? "" : "sm:row-span-2"}`}>{icon}</span>
          <p
            className={`min-w-0 font-medium uppercase leading-tight tracking-wider text-white/70 ${labelSize} ${
              compact ? "" : "sm:truncate"
            }`}
          >
            {label}
          </p>
          <p
            className={`col-span-2 min-w-0 break-words font-bold leading-tight text-white ${valueSize} ${
              compact ? "" : "sm:col-span-1"
            }`}
          >
            {value}
          </p>
        </div>
      )}
    </div>
  );
}
