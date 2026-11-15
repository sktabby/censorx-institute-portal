import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, Lock, ShieldAlert } from "lucide-react";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import PortalLayout from "../../layouts/PortalLayout";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import { apiClient, type ApiResponse } from "../../api/client";
import { firebaseAuth } from "../../config/firebase";
import { describeDaysLeft, filenameFrom, formatDate, saveBlob, type BatchView } from "../../types/batches";
import { schoolNavItems } from "./navItems";

interface DashboardFlags {
  codeVaultEnabled?: boolean;
}

/** What one download contains. */
type Scope =
  | { kind: "ALL" }
  | { kind: "BATCH"; subscriptionId: string; label: string }
  | { kind: "CLASSES"; subscriptionId: string; label: string; classes: string[] };

/**
 * The school's full activation codes as an Excel file: every batch, one batch, or chosen
 * classes. The password is asked for again before each download.
 */
export default function SchoolDownloadCodes() {
  const [batches, setBatches] = useState<BatchView[]>([]);
  const [loading, setLoading] = useState(true);
  const [vaultEnabled, setVaultEnabled] = useState(true);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState<Scope | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiClient.get<ApiResponse<BatchView[]>>("/school/batches"),
      apiClient.get<ApiResponse<DashboardFlags>>("/school/dashboard"),
    ])
      .then(([batchRes, dashRes]) => {
        if (batchRes.data.success) setBatches(batchRes.data.data.filter((batch) => batch.isCurrentPeriod));
        if (dashRes.data.success) setVaultEnabled(dashRes.data.data.codeVaultEnabled !== false);
      })
      .finally(() => setLoading(false));
  }, []);

  const withCodes = useMemo(
    () => batches.filter((batch) => batch.classes.some((item) => item.codeCount > 0)),
    [batches]
  );

  function toggleClass(subscriptionId: string, name: string) {
    setPicked((current) => {
      const list = current[subscriptionId] ?? [];
      return { ...current, [subscriptionId]: list.includes(name) ? list.filter((item) => item !== name) : [...list, name] };
    });
  }

  function ask(scope: Scope) {
    setPending(scope);
    setPassword("");
    setError(null);
    setNotice(null);
  }

  async function download(scope: Scope) {
    const params = new URLSearchParams();
    if (scope.kind !== "ALL") params.set("subscriptionId", scope.subscriptionId);
    if (scope.kind === "CLASSES") params.set("batchNames", scope.classes.join(","));
    const res = await apiClient.get(`/school/codes/export?${params.toString()}`, { responseType: "blob" });
    saveBlob(res.data as Blob, filenameFrom(res.headers["content-disposition"], "activation-codes.xlsx"));
    const unavailable = Number(res.headers["x-codes-unavailable"] ?? 0);
    const rows = Number(res.headers["x-codes-rows"] ?? 0);
    setNotice(
      unavailable > 0
        ? `Downloaded ${rows} code(s). ${unavailable} older code(s) were made before secure storage and show as “Not available” — please use the codes email CensorX sent you for those, or contact us.`
        : `Downloaded ${rows} code(s).`
    );
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending) return;
    const user = firebaseAuth.currentUser;
    if (!user?.email) return setError("We could not verify your session. Sign in again and try later.");
    if (!password) return setError("Enter your password to continue.");

    setBusy(true);
    setError(null);
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
      // A fresh token carries the new sign-in time the server checks.
      await user.getIdToken(true);
    } catch {
      setBusy(false);
      return setError("Password could not be verified. Try again.");
    }

    try {
      await download(pending);
      setPending(null);
      setPassword("");
    } catch (err: any) {
      let text = "The codes could not be downloaded. Please try again.";
      const data = err?.response?.data;
      if (data instanceof Blob) {
        try {
          text = JSON.parse(await data.text())?.error?.message ?? text;
        } catch {
          // keep the default text
        }
      }
      setError(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalLayout items={schoolNavItems}>
      <PageHeader
        title="Download Codes"
        action={
          withCodes.length > 0 && vaultEnabled ? (
            <button onClick={() => ask({ kind: "ALL" })} className="cx-btn-primary w-full sm:w-auto">
              <Download size={16} aria-hidden="true" />
              Download all
            </button>
          ) : undefined
        }
      />

      <div className="mx-auto w-full max-w-3xl space-y-4">
        <p className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm leading-snug text-amber-800">
          <ShieldAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
          These files contain the full codes. Anyone with a code can use it. Share each code only with its student's family.
        </p>

        {notice && <p role="status" className="cx-alert-success">{notice}</p>}

        {!vaultEnabled && (
          <p className="cx-alert-warn">Code download is not switched on yet. Please contact CensorX at team@censorx.in for your codes.</p>
        )}

        {loading ? (
          <p role="status" className="text-sm text-cx-muted">Loading your batches...</p>
        ) : withCodes.length === 0 ? (
          <div className="glass-card flex flex-col items-center gap-3 p-10 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-cx-tint text-cx-accent">
              <FileSpreadsheet size={22} aria-hidden="true" />
            </span>
            <p className="text-sm text-cx-muted">No codes have been made for your school yet.</p>
          </div>
        ) : (
          withCodes.map((batch) => {
            const chosen = picked[batch.subscriptionId] ?? [];
            const classesWithCodes = batch.classes.filter((item) => item.codeCount > 0);
            return (
              <section key={batch.subscriptionId} className="glass-card p-4 sm:p-5" aria-labelledby={`dl-${batch.subscriptionId}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 id={`dl-${batch.subscriptionId}`} className="text-base font-semibold text-cx-heading">
                        {batch.batchLabel}
                      </h2>
                      <StatusBadge status={batch.status} />
                    </div>
                    <p className="mt-0.5 text-xs text-cx-muted">
                      {formatDate(batch.startAt)} → {formatDate(batch.expiresAt)} · {describeDaysLeft(batch)}
                    </p>
                  </div>
                  <button
                    onClick={() => ask({ kind: "BATCH", subscriptionId: batch.subscriptionId, label: batch.batchLabel })}
                    disabled={!vaultEnabled}
                    className="cx-btn-secondary w-full sm:w-auto"
                  >
                    <Download size={16} aria-hidden="true" />
                    Whole batch
                  </button>
                </div>

                <ul className="cx-scroll mt-3 divide-y divide-cx-line rounded-xl border border-cx-border">
                  {classesWithCodes.map((item) => (
                    <li key={item.batchName}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={chosen.includes(item.batchName)}
                          onChange={() => toggleClass(batch.subscriptionId, item.batchName)}
                        />
                        <span className="min-w-0 flex-1 break-words font-medium text-cx-heading">{item.batchName}</span>
                        <span className="text-xs text-cx-muted">
                          {item.codeCount} codes · {item.redeemedCount} used
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-cx-muted">
                    {chosen.length === 0 ? "Tick classes to download only those." : `${chosen.length} class(es) selected`}
                  </span>
                  <button
                    onClick={() =>
                      ask({ kind: "CLASSES", subscriptionId: batch.subscriptionId, label: batch.batchLabel, classes: chosen })
                    }
                    disabled={chosen.length === 0 || !vaultEnabled}
                    className="cx-btn-primary w-full sm:w-auto"
                  >
                    <Download size={16} aria-hidden="true" />
                    Download selected classes
                  </button>
                </div>
              </section>
            );
          })
        )}

        <p className="text-xs text-cx-muted">
          The file lists every code with its class, status (used or not), student and end date. Codes that were withdrawn or replaced
          are not included.
        </p>
      </div>

      {pending && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dl-confirm-title"
          className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-cx-deep/60 p-4"
        >
          <form onSubmit={confirm} className="cx-form-card w-full max-w-md shadow-2xl">
            <div className="mb-2 flex items-center gap-2">
              <Lock size={18} aria-hidden="true" className="text-cx-accent" />
              <h2 id="dl-confirm-title" className="text-xl font-semibold">
                Confirm download
              </h2>
            </div>
            <p className="mb-4 text-sm text-cx-muted">
              {pending.kind === "ALL"
                ? "All your codes, from every batch."
                : pending.kind === "BATCH"
                  ? `All codes in ${pending.label}.`
                  : `${pending.label}: ${pending.classes.join(", ")}.`}{" "}
              Enter your password to continue.
            </p>
            <label className="cx-label mb-2 block" htmlFor="dl-password">
              Password
            </label>
            <input
              id="dl-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              className="cx-input w-full"
            />
            {error && <p role="alert" className="cx-alert-error mt-3">{error}</p>}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setPending(null)} className="cx-btn-secondary w-full sm:w-auto">
                Cancel
              </button>
              <button type="submit" disabled={busy} className="cx-btn-primary w-full sm:w-auto">
                <Download size={16} aria-hidden="true" />
                {busy ? "Preparing..." : "Download Excel"}
              </button>
            </div>
          </form>
        </div>
      )}
    </PortalLayout>
  );
}
