import type { ReactNode } from "react";

/** A numbered step card with a short hint, used to guide multi-part forms. */
export default function Step({
  number,
  title,
  hint,
  children,
}: {
  number: number;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="glass-card p-4 sm:p-6">
      <div className="flex items-start gap-3.5">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cx-dark text-sm font-bold text-white">
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-cx-heading">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-cx-muted">{hint}</p>}
        </div>
      </div>
      <div className="mt-4 sm:pl-[46px]">{children}</div>
    </section>
  );
}
