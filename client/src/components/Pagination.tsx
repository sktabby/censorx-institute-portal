/** Previous / page info / Next on one compact row, including on phones. */
export default function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-between gap-2 text-sm sm:justify-start sm:gap-3">
      <button
        onClick={() => onPage(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="cx-btn-secondary px-3 py-1.5"
      >
        Previous
      </button>
      <span className="whitespace-nowrap text-center text-cx-muted">
        Page {page} of {totalPages}
      </span>
      <button
        onClick={() => onPage(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="cx-btn-secondary px-3 py-1.5"
      >
        Next
      </button>
    </div>
  );
}
