import type { ReactNode } from "react";

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
}

/**
 * Table for larger screens. Pass `mobileCard` to show each row as a card on phones
 * instead; the table then appears from the md breakpoint up.
 */
export default function DataTable<T>({
  columns,
  rows,
  emptyMessage = "No records found.",
  mobileCard,
}: {
  columns: Column<T>[];
  rows: T[];
  emptyMessage?: string;
  mobileCard?: (row: T, index: number) => ReactNode;
}) {
  if (rows.length === 0) {
    return <div className="glass-card p-8 text-center text-cx-muted text-sm">{emptyMessage}</div>;
  }

  return (
    <>
      {mobileCard && (
        <ul className="space-y-2.5 md:hidden">
          {rows.map((row, idx) => (
            <li
              key={idx}
              className="animate-fade-up rounded-2xl border border-cx-border bg-white p-3.5 shadow-sm motion-reduce:animate-none"
              style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}
            >
              {mobileCard(row, idx)}
            </li>
          ))}
        </ul>
      )}

      <div className={`glass-card max-w-full overflow-hidden ${mobileCard ? "hidden md:block" : ""}`}>
        {/* Sideways scrolling stays inside the card; the page never scrolls sideways. */}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-cx-accent text-left text-white">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.header}
                    scope="col"
                    className="min-w-[6rem] px-4 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className="border-t border-cx-line text-cx-text transition-colors hover:bg-cx-tint">
                  {columns.map((col) => (
                    <td key={col.header} className="px-4 py-3 whitespace-nowrap">
                      <div className="max-w-[18rem] whitespace-normal break-words">{col.render(row)}</div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
