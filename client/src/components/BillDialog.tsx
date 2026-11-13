import { useEffect, useRef } from "react";
import { Printer, X } from "lucide-react";

/**
 * Shows a bill (HTML produced by the server) in a framed viewer with a Print /
 * Save as PDF button. Scripts inside the bill are disabled by the sandbox.
 */
export default function BillDialog({
  html,
  billNumber,
  onClose,
}: {
  html: string | null;
  billNumber: string;
  onClose: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const open = html !== null;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);

  if (html === null) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-cx-night/70 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bill-dialog-title"
        onClick={(event) => event.stopPropagation()}
        className="flex h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-[0_30px_80px_-20px_rgba(4,21,20,0.6)] sm:h-[88vh] sm:rounded-3xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-cx-border px-4 py-3 sm:px-5">
          <h2 id="bill-dialog-title" className="min-w-0 truncate text-base font-semibold">
            Bill {billNumber}
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => frameRef.current?.contentWindow?.print()}
              className="cx-btn-primary px-4 py-2"
            >
              <Printer size={16} aria-hidden="true" />
              <span className="hidden sm:inline">Print / Save PDF</span>
              <span className="sm:hidden">Print</span>
            </button>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-cx-muted transition-colors hover:bg-cx-tint hover:text-cx-text"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </div>
        <iframe
          ref={frameRef}
          title={`Bill ${billNumber}`}
          srcDoc={html}
          sandbox="allow-same-origin allow-modals"
          className="min-h-0 flex-1 bg-cx-surface"
        />
      </div>
    </div>
  );
}
