import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, RefreshCw, X } from "lucide-react";
import { apiClient, type ApiResponse } from "../api/client";

interface ReplaceTarget {
  licenseId: string;
  maskedCode: string;
  schoolName: string;
  batchName: string | null;
}

interface ReplaceResponse {
  batchName: string;
  codes: Array<{ plaintextCode: string; codeLast4: string; licenseId: string }>;
}

/**
 * Replaces one unused code with a new one in the same sheet. Step 1 asks for
 * confirmation; step 2 shows the new code once, with Copy and Download.
 * Render it with a `key` so each code starts fresh.
 */
export default function ReplaceCodeDialog({
  target,
  onClose,
}: {
  target: ReplaceTarget;
  /** `replaced` is true when a new code was made, so the caller can refresh its list. */
  onClose: (replaced: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ReplaceResponse["codes"][number] | null>(null);
  const [copied, setCopied] = useState(false);

  const closeRef = useRef<HTMLButtonElement>(null);
  const stateRef = useRef({ busy, replaced: false });
  stateRef.current = { busy, replaced: created !== null };
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !stateRef.current.busy) onCloseRef.current(stateRef.current.replaced);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  async function replace() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<ApiResponse<ReplaceResponse>>(
        `/admin/licenses/${target.licenseId}/replace`,
        reason.trim() ? { reason: reason.trim() } : {}
      );
      if (res.data.success && res.data.data.codes[0]) {
        setCreated(res.data.data.codes[0]);
      } else if (!res.data.success) {
        setError(res.data.error.message);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? "The code could not be replaced.");
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.plaintextCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available: the code is still on screen and can be downloaded.
    }
  }

  function downloadCsv() {
    if (!created) return;
    const rows = [
      ["School", "Sheet", "Student activation code", "Code last four", "License ID"],
      [target.schoolName, target.batchName ?? "", created.plaintextCode, created.codeLast4, created.licenseId],
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `replacement-code-${created.codeLast4}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const close = () => {
    if (!busy) onClose(created !== null);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-cx-night/70 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="replace-code-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-t-3xl bg-white shadow-[0_30px_80px_-20px_rgba(4,21,20,0.6)] sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-cx-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cx-dark text-white">
              <RefreshCw size={18} aria-hidden="true" />
            </span>
            <h2 id="replace-code-title" className="text-lg font-semibold">
              {created ? "New code ready" : "Replace this code?"}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label="Close"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-cx-muted transition-colors hover:bg-cx-tint hover:text-cx-text"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {created ? (
          <div className="space-y-4 px-5 py-5">
            <p className="cx-alert-warn">Save this code now. You cannot see it again after you close this box.</p>

            <div className="rounded-2xl border border-cx-accent/30 bg-cx-tint px-4 py-5 text-center">
              <p className="[overflow-wrap:anywhere] font-mono text-2xl font-bold tracking-wider text-cx-heading">
                {created.plaintextCode}
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={copyCode} className="cx-btn-secondary flex-1">
                {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                {copied ? "Copied" : "Copy code"}
              </button>
              <button type="button" onClick={downloadCsv} className="cx-btn-secondary flex-1">
                <Download size={16} aria-hidden="true" />
                Download
              </button>
            </div>

            <p className="text-sm text-cx-muted">
              The old code no longer works. The school is not emailed this code, so give it to the family yourself.
            </p>

            <button type="button" onClick={close} className="cx-btn-primary w-full">
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-4 px-5 py-5">
            <p className="text-sm text-cx-muted">
              The old code will stop working, and the system will make one new code for the same class. You will see the
              new code once.
            </p>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-cx-border bg-cx-surface p-3.5 text-sm">
              <dt className="text-cx-muted">School</dt>
              <dd className="min-w-0 break-words font-medium text-cx-heading">{target.schoolName}</dd>
              <dt className="text-cx-muted">Sheet</dt>
              <dd className="min-w-0 break-words font-medium text-cx-heading">{target.batchName ?? "-"}</dd>
              <dt className="text-cx-muted">Old code</dt>
              <dd className="font-mono font-medium text-cx-heading">{target.maskedCode}</dd>
            </dl>

            <div>
              <label htmlFor="replace-reason" className="cx-label">
                Reason (optional)
              </label>
              <input
                id="replace-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                placeholder="For example, the family lost the code"
                className="cx-input mt-1 w-full"
              />
            </div>

            {error && <p role="alert" className="cx-alert-error">{error}</p>}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={close} disabled={busy} className="cx-btn-secondary w-full sm:w-auto">
                Cancel
              </button>
              <button type="button" onClick={replace} disabled={busy} className="cx-btn-primary w-full sm:w-auto">
                {busy ? "Replacing..." : "Replace code"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
