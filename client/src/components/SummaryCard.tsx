import type { ReactNode } from "react";

export default function SummaryCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="cx-teal-card">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wider text-white/70">{label}</span>
        {icon && (
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.12] text-white">
            {icon}
          </span>
        )}
      </div>
      <div className="mt-3 min-w-0 break-words text-2xl font-bold text-white sm:text-3xl">{value}</div>
    </div>
  );
}
