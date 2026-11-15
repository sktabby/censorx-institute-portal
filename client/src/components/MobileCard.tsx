import type { ReactNode } from "react";

/** A two-column grid of labelled values inside a phone row card. */
export function MobileFields({ children }: { children: ReactNode }) {
  return <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">{children}</dl>;
}

/** One small label + value pair. `wide` makes it span both columns. */
export function MobileField({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? "col-span-2" : ""}`}>
      <dt className="text-[10px] font-medium uppercase tracking-wider text-cx-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-cx-text">{children}</dd>
    </div>
  );
}

/** Bottom strip of a phone row card for its actions. */
export function MobileActions({ children }: { children: ReactNode }) {
  return <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-cx-line pt-2.5">{children}</div>;
}
