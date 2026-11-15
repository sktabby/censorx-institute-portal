import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarPlus, ChevronDown, HelpCircle, PauseCircle, PlayCircle, Plus, RefreshCw, UserPlus, X, Mail, MailX } from "lucide-react";
import PortalLayout from "../../layouts/PortalLayout";
import PageHeader from "../../components/PageHeader";
import Step from "../../components/Step";
import Select from "../../components/Select";
import StatusBadge from "../../components/StatusBadge";
import BillDialog from "../../components/BillDialog";
import BatchPayments from "./BatchPayments";
import PaymentFields, { emptyPayment, toPaymentPayload, validatePayment, type PaymentFormState } from "../../components/PaymentFields";
import { apiClient, type ApiResponse, type PagedResult } from "../../api/client";
import { adminNavItems } from "./navItems";
import { billingMonths, calculatePlanExpiryDate, formatDateInput, planOptions, type PlanDuration } from "../../utils/planDuration";
import { describeDaysLeft, formatDate, type BatchView } from "../../types/batches";
import { MAX_CODES_PER_CLASS } from "../../config/limits";
import PaymentMethodPicker, { emptyPayDetails, payMethodDetails, payMethodError, type PayMethod } from "../../components/PaymentMethodPicker";

interface OrgOption {
  organizationId: string;
  name: string;
}

interface BatchesResponse {
  organization: {
    organizationId: string;
    name: string;
    status: string;
    storedStatus: string;
    liveBatchCount: number;
    batchCount: number;
    nextExpiresAt: string | null;
  };
  batches: BatchView[];
}

interface ClassRow {
  id: number;
  name: string;
  seats: number;
}

const MAX_CLASSES = 50;

/** Plan length + start + end, with the end worked out from the length unless CUSTOM. */
function useWindow(initialStart = formatDateInput()) {
  const [planDuration, setPlanDuration] = useState<PlanDuration>("YEARLY");
  const [startAt, setStartAt] = useState(initialStart);
  const [expiresAt, setExpiresAt] = useState(calculatePlanExpiryDate(initialStart, "YEARLY"));
  useEffect(() => {
    if (planDuration !== "CUSTOM" && startAt) setExpiresAt(calculatePlanExpiryDate(startAt, planDuration));
  }, [planDuration, startAt]);
  return { planDuration, setPlanDuration, startAt, setStartAt, expiresAt, setExpiresAt };
}

/** Months billed for the dates on screen, worked out exactly as the server does. */
function monthsOf(dates: { planDuration: PlanDuration; startAt: string; expiresAt: string }) {
  if (!dates.startAt || !dates.expiresAt) return 1;
  return billingMonths(dates.planDuration, new Date(isoFromDateInput(dates.startAt)), new Date(isoFromDateInput(dates.expiresAt)));
}

function isoFromDateInput(value: string) {
  return new Date(`${value}T00:00:00`).toISOString();
}

function apiError(err: any, fallback: string) {
  return err?.response?.data?.error?.message ?? fallback;
}

export default function RenewSchool() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [selectedOrg, setSelectedOrg] = useState(searchParams.get("school") ?? "");
  const [data, setData] = useState<BatchesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "warn"; text: string } | null>(null);
  const [billHtml, setBillHtml] = useState<{ html: string; billNumber: string; pdfPath?: string } | null>(null);

  useEffect(() => {
    apiClient.get<ApiResponse<PagedResult<OrgOption>>>("/admin/organizations?pageSize=100").then((res) => {
      if (res.data.success) setOrgs(res.data.data.items);
    });
  }, []);

  useEffect(() => {
    setData(null);
    setNotice(null);
    if (selectedOrg) {
      setSearchParams({ school: selectedOrg }, { replace: true });
      void refresh(selectedOrg);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrg]);

  async function refresh(organizationId = selectedOrg) {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiClient.get<ApiResponse<BatchesResponse>>(`/admin/organizations/${organizationId}/subscription-batches`);
      if (res.data.success) setData(res.data.data);
      else setLoadError(res.data.error.message);
    } catch (err) {
      setLoadError(apiError(err, "Could not load this school's batches."));
    } finally {
      setLoading(false);
    }
  }

  function done(text: string, warning?: string) {
    setNotice(warning ? { kind: "warn", text: `${text} ${warning}` } : { kind: "success", text });
    void refresh();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const currentBatches = (data?.batches ?? []).filter((batch) => batch.isCurrentPeriod);
  const earlierPeriods = (data?.batches ?? []).length - currentBatches.length;
  const usedClassNames = new Set((data?.batches ?? []).flatMap((batch) => batch.classes.map((item) => item.batchName.toLowerCase())));

  return (
    <PortalLayout items={adminNavItems}>
      <PageHeader
        title="Subscription"
        action={
          <Link to="/admin/guide" className="cx-link inline-flex min-h-11 items-center gap-1.5 text-sm">
            <HelpCircle size={16} aria-hidden="true" />
            How it works
          </Link>
        }
      />

      <div className="mx-auto w-full max-w-3xl space-y-4">
        <Step number={1} title="Choose the school" hint="Pick the school you are working on.">
          <label htmlFor="subscription-school" className="sr-only">
            School
          </label>
          <Select id="subscription-school" value={selectedOrg} onChange={(e) => setSelectedOrg(e.target.value)} className="cx-input w-full">
            <option value="">Select a school</option>
            {orgs.map((org) => (
              <option key={org.organizationId} value={org.organizationId}>
                {org.name}
              </option>
            ))}
          </Select>

          {selectedOrg && data && (
            <div className="mt-4 rounded-xl border border-cx-border bg-cx-tint/50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-cx-heading">School status</span>
                <StatusBadge status={data.organization.status} />
              </div>
              <p className="mt-1.5 text-sm text-cx-muted">
                {data.organization.batchCount === 0
                  ? "No batch yet. Add the first batch below."
                  : `${data.organization.liveBatchCount} of ${currentBatches.length} batch${currentBatches.length === 1 ? "" : "es"} live. ` +
                    "The school stays Active while any batch is live, and becomes Expired only when every batch has ended."}
              </p>
            </div>
          )}
          {loadError && <p role="alert" className="cx-alert-error mt-4">{loadError}</p>}
        </Step>

        {notice && (
          <p role="status" className={notice.kind === "success" ? "cx-alert-success" : "cx-alert-warn"}>
            {notice.text}
          </p>
        )}

        {selectedOrg && loading && !data && <p role="status" className="text-sm text-cx-muted">Loading batches...</p>}

        {selectedOrg && data && (
          <>
            <NewBatchSection
              key={`new-${selectedOrg}`}
              organizationId={selectedOrg}
              nextNumber={Math.max(0, ...(data.batches.map((batch) => batch.batchNumber))) + 1}
              usedClassNames={usedClassNames}
              defaultOpen={currentBatches.length === 0}
              onDone={done}
            />

            <ManageBatchesSection key={`manage-${selectedOrg}`} count={currentBatches.length}>
              {currentBatches.length === 0 ? (
                <p className="text-sm text-cx-muted">This school has no batch yet.</p>
              ) : (
                currentBatches.map((batch) => (
                  <BatchCard
                    key={batch.subscriptionId}
                    organizationId={selectedOrg}
                    batch={batch}
                    defaultOpen={
                      currentBatches.length === 1 ||
                      batch.isPaused ||
                      !!batch.payment?.isOverdue ||
                      (batch.isLive && batch.daysRemaining <= 14)
                    }
                    onDone={done}
                    onShowBill={setBillHtml}
                  />
                ))
              )}
              {earlierPeriods > 0 && (
                <p className="text-xs text-cx-muted">
                  {earlierPeriods} earlier renewed period{earlierPeriods === 1 ? "" : "s"} are in the{" "}
                  <Link to={`/admin/schools/${selectedOrg}/history`} className="cx-link">
                    subscription history
                  </Link>
                  .
                </p>
              )}
            </ManageBatchesSection>
          </>
        )}
      </div>

      <BillDialog html={billHtml?.html ?? null} billNumber={billHtml?.billNumber ?? ""} pdfPath={billHtml?.pdfPath} onClose={() => setBillHtml(null)} />
    </PortalLayout>
  );
}

// ---------------------------------------------------------------------------
// Add a new batch
// ---------------------------------------------------------------------------

function NewBatchSection({
  organizationId,
  nextNumber,
  usedClassNames,
  defaultOpen,
  onDone,
}: {
  organizationId: string;
  nextNumber: number;
  usedClassNames: Set<string>;
  /** Open by default only when the school has no batch yet. */
  defaultOpen: boolean;
  onDone: (text: string, warning?: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const dates = useWindow();
  const [classes, setClasses] = useState<ClassRow[]>([{ id: 1, name: "", seats: 10 }]);
  const nextId = useRef(2);
  const [withPayment, setWithPayment] = useState(true);
  const [payment, setPayment] = useState<PaymentFormState>(emptyPayment);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const totalSeats = classes.reduce((sum, item) => sum + (Number(item.seats) || 0), 0);
  const billing = { codeCount: totalSeats, months: monthsOf(dates) };

  function updateClass(id: number, patch: Partial<Omit<ClassRow, "id">>) {
    setClasses((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function submit() {
    setError(null);
    if (!dates.startAt || !dates.expiresAt) return setError("Start and end dates are required.");
    if (new Date(dates.expiresAt) <= new Date(dates.startAt)) return setError("The end date must be after the start date.");

    const seen = new Set<string>();
    for (const item of classes) {
      const name = item.name.trim();
      if (!name) return setError("Enter a name for every class, for example Class 5A.");
      const lower = name.toLowerCase();
      if (usedClassNames.has(lower)) return setError(`This school already has a class called "${name}". Use a different name.`);
      if (seen.has(lower)) return setError(`"${name}" is used twice. Each class needs its own name.`);
      seen.add(lower);
      if (!Number.isInteger(item.seats) || item.seats <= 0) return setError(`Enter a whole number of codes above 0 for "${name}".`);
      if (item.seats > MAX_CODES_PER_CLASS) {
        return setError(`A class can have at most ${MAX_CODES_PER_CLASS} codes. Split "${name}" into two classes.`);
      }
    }
    if (withPayment) {
      const paymentError = validatePayment(payment, billing);
      if (paymentError) return setError(paymentError);
    }

    setBusy(true);
    try {
      const res = await apiClient.post<ApiResponse<{ batchLabel: string; seatLimit: number; classes: Array<{ batchName: string }>; batchEmail?: { sent: boolean; to: string }; billEmail?: { sent: boolean } }>>(
        `/admin/organizations/${organizationId}/subscription-batches`,
        {
          planDuration: dates.planDuration,
          startAt: isoFromDateInput(dates.startAt),
          expiresAt: isoFromDateInput(dates.expiresAt),
          classes: classes.map((item) => ({ batchName: item.name.trim(), seatCount: item.seats })),
          ...(withPayment ? { payment: toPaymentPayload(payment, billing) } : {}),
          idempotencyKey: `${organizationId}-batch-${Date.now()}`,
        }
      );
      if (!res.data.success) return setError(res.data.error.message);

      const result = res.data.data;
      const emailed = result.batchEmail?.sent ? ` The school was emailed the batch details${result.billEmail?.sent ? " and the bill" : ""}.` : "";
      onDone(
        `${result.batchLabel} created with ${result.classes.length} class${result.classes.length === 1 ? "" : "es"} (${result.seatLimit} codes).${emailed} Next, make the codes in Create Codes.`,
        (res.data.meta?.warning as string | undefined) ?? undefined
      );
      setClasses([{ id: 1, name: "", seats: 10 }]);
      nextId.current = 2;
      setPayment(emptyPayment);
    } catch (err) {
      setError(apiError(err, "The batch could not be created."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="new-batch" className="glass-card p-4 sm:p-6">
      <div className="flex items-start gap-3.5">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cx-dark text-sm font-bold text-white">2</span>
        <div className="min-w-0 flex-1">
          <h2 id="new-batch" className="text-base font-semibold text-cx-heading">
            Add a new batch (Batch {nextNumber})
          </h2>
          <p className="mt-0.5 text-sm text-cx-muted">
            For new classes. The batch gets its own dates and bill, and never changes the school's other batches.
          </p>
        </div>
        <ToggleButton open={open} onToggle={() => setOpen((value) => !value)} controls="new-batch-body" what="new batch form" />
      </div>

      <Collapse id="new-batch-body" open={open}>
      <div className="mt-5 space-y-6 sm:pl-[46px]">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-cx-heading">Dates</h3>
          <WindowFields idPrefix="new-batch" {...dates} />
        </div>

        <div>
          <h3 className="text-sm font-semibold text-cx-heading">Classes and codes</h3>
          <p className="mb-3 text-xs text-cx-muted">Enter exactly how many codes each class needs. Codes are made in Create Codes.</p>
          <div className="space-y-2.5">
            {classes.map((item, index) => (
              <div key={item.id} className="grid grid-cols-[1fr_6.5rem_auto] items-end gap-2 rounded-xl border border-cx-border bg-cx-surface p-3">
                <label className="block min-w-0">
                  <span className="cx-label">Class {index + 1} name</span>
                  <input
                    value={item.name}
                    onChange={(e) => updateClass(item.id, { name: e.target.value })}
                    placeholder="e.g. Class 5A"
                    className="cx-input mt-1 w-full"
                  />
                </label>
                <label className="block min-w-0">
                  <span className="cx-label">Codes</span>
                  <input
                    type="number"
                    min={1}
                    max={MAX_CODES_PER_CLASS}
                    value={item.seats}
                    onChange={(e) => updateClass(item.id, { seats: Number(e.target.value) })}
                    className="cx-input mt-1 w-full"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setClasses((current) => (current.length > 1 ? current.filter((row) => row.id !== item.id) : current))}
                  disabled={classes.length === 1}
                  aria-label={`Remove class ${index + 1}`}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-cx-muted transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-30"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() =>
                setClasses((current) => (current.length >= MAX_CLASSES ? current : [...current, { id: nextId.current++, name: "", seats: 10 }]))
              }
              className="cx-btn-secondary w-full sm:w-auto"
            >
              <Plus size={16} aria-hidden="true" />
              Add class
            </button>
            <span className="text-sm text-cx-muted">
              {classes.length} class{classes.length === 1 ? "" : "es"} · <span className="font-semibold text-cx-accent">{totalSeats}</span> codes
            </span>
          </div>
        </div>

        <div>
          <label className="flex min-h-11 items-center gap-2.5 text-sm font-semibold text-cx-heading">
            <input type="checkbox" checked={withPayment} onChange={(e) => setWithPayment(e.target.checked)} />
            Record a payment and send a bill
          </label>
          {withPayment && (
            <div className="mt-3">
              <PaymentFields idPrefix="new-batch-payment" value={payment} onChange={setPayment} context={billing} />
            </div>
          )}
        </div>

        {error && <p role="alert" className="cx-alert-error">{error}</p>}

        <button type="button" onClick={submit} disabled={busy} className="cx-btn-primary w-full py-3 sm:w-auto">
          <CalendarPlus size={16} aria-hidden="true" />
          {busy ? "Creating..." : `Create Batch ${nextNumber}`}
        </button>
      </div>
      </Collapse>
    </section>
  );
}

// ---------------------------------------------------------------------------
// One existing batch
// ---------------------------------------------------------------------------

type Panel = "" | "RENEW" | "ADD_CODES";

function BatchCard({
  organizationId,
  batch,
  defaultOpen,
  onDone,
  onShowBill,
}: {
  organizationId: string;
  batch: BatchView;
  /** Open by default when it is the only batch or needs attention. */
  defaultOpen: boolean;
  onDone: (text: string, warning?: string) => void;
  onShowBill: (bill: { html: string; billNumber: string; pdfPath?: string }) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = `batch-body-${batch.subscriptionId}`;
  const [panel, setPanel] = useState<Panel>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/admin/organizations/${organizationId}/subscription-batches/${batch.subscriptionId}`;
  const cancelled = batch.status === "CANCELLED";
  const endingSoon = batch.isLive && batch.daysRemaining <= 14;

  async function pause() {
    const reason = window.prompt(
      `Stop access for ${batch.batchLabel}? Students in its classes will not be able to use the app until you restart it. ` +
        "Other batches are not affected.\n\nReason shown to the school (optional):",
      batch.payment?.isOverdue ? "Payment overdue" : ""
    );
    if (reason === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<ApiResponse<{ studentsAffected: number }>>(`${base}/pause`, reason.trim() ? { reason: reason.trim() } : {});
      if (res.data.success) {
        onDone(`Access for ${batch.batchLabel} stopped. ${res.data.data.studentsAffected} student(s) lost access. The school was told by email and in its portal.`);
      } else setError(res.data.error.message);
    } catch (err) {
      setError(apiError(err, "Access could not be stopped."));
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    if (!window.confirm(`Restart access for ${batch.batchLabel}? Its students can use the app again with the same codes.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<ApiResponse<{ ended: boolean; studentsReactivated: number }>>(`${base}/resume`);
      if (res.data.success) {
        onDone(
          res.data.data.ended
            ? `${batch.batchLabel} is no longer paused, but its end date has passed. Renew it to give students access.`
            : `Access for ${batch.batchLabel} restarted. ${res.data.data.studentsReactivated} student(s) have access again.`
        );
      } else setError(res.data.error.message);
    } catch (err) {
      setError(apiError(err, "Access could not be restarted."));
    } finally {
      setBusy(false);
    }
  }

  /** Stops (or restarts) the renewal emails sent every 4 days after this batch ended. */
  async function setRenewalEmails(enabled: boolean) {
    if (!enabled && !window.confirm(`Stop the renewal emails for ${batch.batchLabel}? The school will not get them any more.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<ApiResponse<{ renewalEmails: boolean }>>(`${base}/renewal-emails`, { enabled });
      if (res.data.success) {
        onDone(enabled ? `Renewal emails for ${batch.batchLabel} restarted (every 4 days).` : `Renewal emails for ${batch.batchLabel} stopped.`);
      } else setError(res.data.error.message);
    } catch (err) {
      setError(apiError(err, "The renewal emails could not be changed."));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!window.confirm(`Cancel ${batch.batchLabel}? Students in its classes lose access straight away. Other batches are not affected.`)) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`${base}/cancel`);
      onDone(`${batch.batchLabel} was cancelled.`);
    } catch (err) {
      setError(apiError(err, "The batch could not be cancelled."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className={`rounded-2xl border bg-white p-4 ${
        batch.isPaused ? "border-red-300" : endingSoon || batch.payment?.isOverdue ? "border-amber-300" : "border-cx-border"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-cx-heading">{batch.batchLabel}</h3>
            <StatusBadge status={batch.isPaused ? "PAUSED" : batch.status} />
            {endingSoon && <span className="badge border-amber-200 bg-amber-50 text-amber-700">Ending soon</span>}
          </div>
          <p className="mt-0.5 text-sm text-cx-muted">
            {formatDate(batch.startAt)} → {formatDate(batch.expiresAt)} ·{" "}
            <span className={endingSoon ? "font-medium text-amber-700" : batch.isLive ? "" : "font-medium text-amber-700"}>
              {describeDaysLeft(batch)}
            </span>
          </p>
        </div>
        <div className="flex items-start gap-3">
          <div className="text-right text-sm">
            <div className="font-semibold text-cx-heading">
              {batch.seatUsage.activatedSeats} / {batch.seatLimit}
            </div>
            <div className="text-xs text-cx-muted">students joined</div>
          </div>
          <ToggleButton open={open} onToggle={() => setOpen((value) => !value)} controls={bodyId} what={batch.batchLabel} />
        </div>
      </div>

      {/* Closed: a one-line summary so the card still says what needs doing */}
      {!open && (batch.payment?.isOverdue || batch.isPaused || batch.classes.some((item) => item.pendingSeats > 0)) && (
        <p className="mt-2 text-xs text-cx-muted">
          {[
            batch.isPaused && "Access stopped",
            batch.payment?.isOverdue && "Payment overdue",
            batch.classes.some((item) => item.pendingSeats > 0) && "Codes waiting in Create Codes",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      <Collapse id={bodyId} open={open}>
      <ul className="mt-3 divide-y divide-cx-line rounded-xl border border-cx-border bg-cx-surface text-sm">
        {batch.classes.length === 0 ? (
          <li className="px-3 py-2 text-cx-muted">No classes.</li>
        ) : (
          batch.classes.map((item) => (
            <li key={item.batchName} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
              <span className="min-w-0 break-words font-medium text-cx-heading">{item.batchName}</span>
              <span className="text-xs text-cx-muted">
                {item.seatCount} codes · {item.redeemedCount} joined
                {item.pendingSeats > 0 && <span className="ml-1 font-medium text-amber-700">· {item.pendingSeats} waiting in Create Codes</span>}
              </span>
            </li>
          ))
        )}
      </ul>

      {batch.isPaused && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Access stopped{batch.pausedAt ? ` on ${formatDate(batch.pausedAt)}` : ""}
          {batch.pauseReason ? `: ${batch.pauseReason}` : ""}. Students in this batch cannot use the app until you restart it.
        </p>
      )}

      {/* Ended: renewal emails go every 4 days until it is renewed (can be stopped) */}
      {!cancelled && !batch.isPaused && batch.status === "EXPIRED" && batch.isCurrentPeriod && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cx-border bg-cx-tint/50 px-3 py-2 text-sm">
          <span className="min-w-0 text-cx-text">
            {batch.renewalEmails === false
              ? "Renewal emails are stopped for this batch."
              : `Renewal emails go to the school every 4 days until it renews${batch.renewalEmailsSent ? ` (${batch.renewalEmailsSent} sent)` : ""}.`}
          </span>
          <button
            type="button"
            onClick={() => setRenewalEmails(batch.renewalEmails === false)}
            disabled={busy}
            className="cx-btn-secondary"
          >
            {batch.renewalEmails === false ? <Mail size={16} aria-hidden="true" /> : <MailX size={16} aria-hidden="true" />}
            {batch.renewalEmails === false ? "Restart renewal emails" : "Stop renewal emails"}
          </button>
        </div>
      )}

      <BatchPayments base={base} batch={batch} onDone={onDone} onShowBill={onShowBill} />

      {!cancelled && (
        <div className="mt-3 flex flex-wrap gap-2">
          {batch.isPaused ? (
            <button type="button" onClick={resume} disabled={busy} className="cx-btn-primary">
              <PlayCircle size={16} aria-hidden="true" />
              Restart access
            </button>
          ) : (
            batch.isLive && (
              <button type="button" onClick={pause} disabled={busy} className="cx-btn-secondary">
                <PauseCircle size={16} aria-hidden="true" />
                Stop access
              </button>
            )
          )}
          <button
            type="button"
            onClick={() => setPanel(panel === "RENEW" ? "" : "RENEW")}
            aria-expanded={panel === "RENEW"}
            className={panel === "RENEW" ? "cx-btn-primary" : "cx-btn-secondary"}
          >
            <RefreshCw size={16} aria-hidden="true" />
            Renew {batch.batchLabel}
          </button>
          {batch.isLive && batch.classes.length > 0 && (
            <button
              type="button"
              onClick={() => setPanel(panel === "ADD_CODES" ? "" : "ADD_CODES")}
              aria-expanded={panel === "ADD_CODES"}
              className={panel === "ADD_CODES" ? "cx-btn-primary" : "cx-btn-secondary"}
            >
              <UserPlus size={16} aria-hidden="true" />
              Add codes to a class
            </button>
          )}
          <button type="button" onClick={cancel} disabled={busy} className="cx-btn-danger sm:ml-auto">
            Cancel batch
          </button>
        </div>
      )}

      {error && <p role="alert" className="cx-alert-error mt-3">{error}</p>}

      {panel === "RENEW" && <RenewPanel base={base} batch={batch} onDone={(text, warning) => { setPanel(""); onDone(text, warning); }} />}
      {panel === "ADD_CODES" && (
        <AddCodesPanel base={base} batch={batch} onDone={(text, warning) => { setPanel(""); onDone(text, warning); }} />
      )}
      </Collapse>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------

/** "View" / "Hide" button for a section that opens and closes. */
function ToggleButton({
  open,
  onToggle,
  controls,
  what,
}: {
  open: boolean;
  onToggle: () => void;
  controls: string;
  /** Read out by screen readers, e.g. "Batch 2". */
  what: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={`${open ? "Hide" : "View"} ${what}`}
      className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-cx-border bg-white px-3 text-sm font-medium text-cx-accent transition-colors hover:border-cx-accent/40 hover:bg-cx-tint"
    >
      <span>{open ? "Hide" : "View"}</span>
      <ChevronDown
        size={16}
        aria-hidden="true"
        className={`transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
}

/**
 * Smoothly opens and closes its content. When closed the content is also made invisible, so
 * its buttons and fields cannot be reached with Tab or read by screen readers.
 */
function Collapse({ id, open, children }: { id: string; open: boolean; children: ReactNode }) {
  return (
    <div
      id={id}
      className={`grid transition-[grid-template-rows,visibility] duration-300 ease-out motion-reduce:transition-none ${
        open ? "visible grid-rows-[1fr]" : "invisible grid-rows-[0fr]"
      }`}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/** Step 3: the school's batches, in a section that opens and closes. */
function ManageBatchesSection({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section aria-labelledby="existing-batches" className="glass-card p-4 sm:p-6">
      <div className="flex items-start gap-3.5">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cx-dark text-sm font-bold text-white">3</span>
        <div className="min-w-0 flex-1">
          <h2 id="existing-batches" className="text-base font-semibold text-cx-heading">
            Renew or manage a batch
            {count > 0 && <span className="ml-2 text-sm font-normal text-cx-muted">({count})</span>}
          </h2>
          <p className="mt-0.5 text-sm text-cx-muted">Each batch renews on its own. Renewing keeps the same codes working for its classes.</p>
        </div>
        <ToggleButton open={open} onToggle={() => setOpen((value) => !value)} controls="existing-batches-body" what="batches" />
      </div>

      <Collapse id="existing-batches-body" open={open}>
        <div className="mt-4 space-y-3 sm:pl-[46px]">{children}</div>
      </Collapse>
    </section>
  );
}

function RenewPanel({
  base,
  batch,
  onDone,
}: {
  base: string;
  batch: BatchView;
  onDone: (text: string, warning?: string) => void;
}) {
  // A batch that has not ended yet renews from its current end date, so no paid time is lost.
  const defaultStart = batch.isLive && batch.expiresAt ? formatDateInput(new Date(batch.expiresAt)) : formatDateInput();
  const dates = useWindow(defaultStart);
  const billing = { codeCount: batch.seatLimit, months: monthsOf(dates) };
  const [withPayment, setWithPayment] = useState(true);
  const [payment, setPayment] = useState<PaymentFormState>(emptyPayment);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (!dates.startAt || !dates.expiresAt) return setError("Start and end dates are required.");
    if (new Date(dates.expiresAt) <= new Date(dates.startAt)) return setError("The end date must be after the start date.");
    if (batch.expiresAt && new Date(dates.expiresAt) <= new Date(batch.expiresAt)) {
      return setError(`The new end date must be after ${formatDate(batch.expiresAt)}.`);
    }
    if (withPayment) {
      const paymentError = validatePayment(payment, billing);
      if (paymentError) return setError(paymentError);
    }

    setBusy(true);
    try {
      const res = await apiClient.post<ApiResponse<{ batchLabel: string; licensesRestored: number; studentsReactivated: number; renewalEmail?: { sent: boolean; to: string } }>>(
        `${base}/renew`,
        {
          planDuration: dates.planDuration,
          startAt: isoFromDateInput(dates.startAt),
          expiresAt: isoFromDateInput(dates.expiresAt),
          ...(withPayment ? { payment: toPaymentPayload(payment, billing) } : {}),
          idempotencyKey: `${batch.subscriptionId}-renew-${Date.now()}`,
        }
      );
      if (!res.data.success) return setError(res.data.error.message);
      const result = res.data.data;
      onDone(
        `${result.batchLabel} renewed until ${formatDate(isoFromDateInput(dates.expiresAt))}. ${result.licensesRestored} code(s) kept working, ` +
          `${result.studentsReactivated} student(s) got access back.${result.renewalEmail?.sent ? ` The school was emailed at ${result.renewalEmail.to}.` : ""}`,
        (res.data.meta?.warning as string | undefined) ?? undefined
      );
    } catch (err) {
      setError(apiError(err, "The batch could not be renewed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-4 border-t border-cx-line pt-4">
      <p className="text-sm text-cx-muted">
        New dates for {batch.batchLabel}: {batch.classes.map((item) => item.batchName).join(", ") || "no classes"}. The same codes keep
        working. Other batches are not changed.
      </p>
      <WindowFields idPrefix={`renew-${batch.subscriptionId}`} {...dates} />
      <label className="flex min-h-11 items-center gap-2.5 text-sm font-semibold text-cx-heading">
        <input type="checkbox" checked={withPayment} onChange={(e) => setWithPayment(e.target.checked)} />
        Record the renewal payment and send a bill
      </label>
      {withPayment && <PaymentFields idPrefix={`renew-${batch.subscriptionId}-payment`} value={payment} onChange={setPayment} context={billing} />}
      {error && <p role="alert" className="cx-alert-error">{error}</p>}
      <button type="button" onClick={submit} disabled={busy} className="cx-btn-primary w-full sm:w-auto">
        {busy ? "Renewing..." : `Renew ${batch.batchLabel}`}
      </button>
    </div>
  );
}

function AddCodesPanel({
  base,
  batch,
  onDone,
}: {
  base: string;
  batch: BatchView;
  onDone: (text: string, warning?: string) => void;
}) {
  const [className, setClassName] = useState(batch.classes[0]?.batchName ?? "");
  const [extra, setExtra] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Default price: extra codes × the batch's price per code per month × months left.
  const rate = batch.payment?.amountPerCode ?? null;
  const months = Math.max(1, Math.round(Math.max(0, batch.daysRemaining) / 30.4375));
  const suggested = rate !== null && Number.isInteger(extra) && extra > 0 ? Math.round(rate * extra * months * 100) / 100 : null;
  const [price, setPrice] = useState(suggested !== null ? String(suggested) : "");
  const [priceTouched, setPriceTouched] = useState(false);
  // Paid on the spot: recorded with the codes, no installment or due date.
  const [paidNow, setPaidNow] = useState(false);
  const [payMethod, setPayMethod] = useState<PayMethod | "">("");
  const [payDetails, setPayDetails] = useState(emptyPayDetails);
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return formatDateInput(d);
  });

  // Follow the suggestion as the number of codes changes, until the price is typed by hand.
  useEffect(() => {
    if (!priceTouched && suggested !== null) setPrice(String(suggested));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extra]);

  const amount = Number(price) || 0;
  const usingSuggestion = suggested !== null && Math.abs(amount - suggested) < 0.01;
  const hasBill = !!batch.payment;

  async function submit() {
    setError(null);
    if (!className) return setError("Choose a class.");
    if (!Number.isInteger(extra) || extra <= 0) return setError("Enter a whole number of codes above 0.");
    if (extra > MAX_CODES_PER_CLASS) return setError(`A class can have at most ${MAX_CODES_PER_CLASS} codes.`);
    if (price.trim() && (Number.isNaN(Number(price)) || amount < 0)) return setError("Enter a price of 0 or more.");
    if (amount > 0 && !hasBill) return setError("This batch has no bill to add the charge to. Set the price to 0.");
    if (amount > 0 && !paidNow && !dueDate) return setError("Choose when the extra amount is due.");
    if (amount > 0 && paidNow) {
      const missing = payMethodError(payMethod, payDetails);
      if (missing) return setError(missing);
    }
    const confirmText =
      amount > 0
        ? paidNow
          ? `Add ${extra} code(s) to "${className}" and record ₹${amount.toLocaleString("en-IN")} paid now? A new bill is emailed to the school.`
          : `Add ${extra} code(s) to "${className}" for ₹${amount.toLocaleString("en-IN")}? A new bill is emailed to the school.`
        : `Add ${extra} free code(s) to "${className}"? The bill does not change.`;
    if (!window.confirm(confirmText)) return;

    setBusy(true);
    try {
      const res = await apiClient.post<ApiResponse<{ pendingSeats: number; bill: { billNumber: string; billEmail: { sent: boolean; to: string } } | null }>>(
        `${base}/classes/${encodeURIComponent(className)}/add-seats`,
        {
          extraSeats: extra,
          charge:
            amount > 0
              ? {
                  amount,
                  ...(paidNow && payMethod
                    ? { paidNow: { method: payMethod, ...(payMethodDetails(payMethod, payDetails) ? { methodDetails: payMethodDetails(payMethod, payDetails) } : {}) } }
                    : { dueDate: new Date(`${dueDate}T00:00:00`).toISOString() }),
                  ...(usingSuggestion && rate !== null ? { ratePerCodePerMonth: rate, months } : {}),
                }
              : { amount: 0 },
        }
      );
      if (!res.data.success) return setError(res.data.error.message);
      const { pendingSeats, bill } = res.data.data;
      onDone(
        `Added ${extra} code(s) to "${className}". Make the ${pendingSeats} waiting code(s) in Create Codes.` +
          (bill ? ` New bill ${bill.billNumber}${bill.billEmail.sent ? ` emailed to ${bill.billEmail.to}` : ""}.` : ""),
        (res.data.meta?.warning as string | undefined)?.includes("could not be emailed") ? (res.data.meta?.warning as string) : undefined
      );
    } catch (err) {
      setError(apiError(err, "The codes could not be added."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3 border-t border-cx-line pt-4">
      <p className="text-sm text-cx-muted">
        For one or two students who join a class later. They get the same end date as {batch.batchLabel}. For a new class, add a new
        batch instead.
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <label className="block min-w-0">
          <span className="cx-label">Class</span>
          <Select value={className} onChange={(e) => setClassName(e.target.value)} className="cx-input mt-1 w-full">
            {batch.classes.map((item) => (
              <option key={item.batchName} value={item.batchName}>
                {item.batchName}
              </option>
            ))}
          </Select>
        </label>
        <label className="block min-w-0">
          <span className="cx-label">Extra codes</span>
          <input type="number" min={1} max={MAX_CODES_PER_CLASS} value={extra} onChange={(e) => setExtra(Number(e.target.value))} className="cx-input mt-1 w-full" />
        </label>
      </div>

      {/* Price for the extra codes */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block min-w-0">
          <span className="cx-label">Price for these codes (₹)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={price}
            placeholder={hasBill ? "0 for free codes" : "0"}
            onChange={(e) => {
              setPrice(e.target.value);
              setPriceTouched(true);
            }}
            className="cx-input mt-1 w-full"
          />
        </label>
        {amount > 0 && !paidNow && (
          <label className="block min-w-0">
            <span className="cx-label">Due date</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="cx-input mt-1 w-full" />
          </label>
        )}
      </div>

      {/* Paid now: the school pays when asking for the codes, not in a later installment */}
      {amount > 0 && hasBill && (
        <div className="space-y-3 rounded-xl border border-cx-border bg-white p-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={paidNow}
              onChange={(e) => setPaidNow(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[#0f6b65]"
            />
            <span className="text-sm">
              <span className="font-medium text-cx-heading">Paid now</span>
              <span className="block text-cx-muted">
                The school pays for these codes now. It is recorded with the codes, so no installment or due date is added.
              </span>
            </span>
          </label>
          {paidNow && (
            <PaymentMethodPicker
              idPrefix={`${batch.subscriptionId}-extra`}
              method={payMethod}
              onMethod={setPayMethod}
              details={payDetails}
              onDetails={setPayDetails}
            />
          )}
        </div>
      )}
      <p className="text-xs text-cx-muted">
        {rate !== null
          ? `Suggested: ${extra} code${extra === 1 ? "" : "s"} × ₹${rate.toLocaleString("en-IN")} per code per month × ${months} month${
              months === 1 ? "" : "s"
            } left = ₹${(suggested ?? 0).toLocaleString("en-IN")}. You can change it, or enter 0 for free codes.`
          : hasBill
            ? "This batch's bill was not priced per code, so enter the price yourself, or 0 for free codes."
            : "This batch has no bill, so the codes are added free."}
        {amount > 0 &&
          (paidNow
            ? " The amount is added to the batch's bill as paid, and a new bill is emailed to the school."
            : " The amount is added to the batch's bill and a new bill is emailed to the school.")}
      </p>

      {error && <p role="alert" className="cx-alert-error">{error}</p>}
      <button type="button" onClick={submit} disabled={busy} className="cx-btn-primary w-full sm:w-auto">
        {busy ? "Adding..." : amount > 0 ? (paidNow ? "Add codes, record payment and send bill" : "Add codes and send bill") : "Add codes"}
      </button>
    </div>
  );
}

function WindowFields({
  idPrefix,
  planDuration,
  setPlanDuration,
  startAt,
  setStartAt,
  expiresAt,
  setExpiresAt,
}: ReturnType<typeof useWindow> & { idPrefix: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <label htmlFor={`${idPrefix}-plan`} className="block min-w-0">
        <span className="cx-label">Plan length</span>
        <Select
          id={`${idPrefix}-plan`}
          value={planDuration}
          onChange={(e) => setPlanDuration(e.target.value as PlanDuration)}
          className="cx-input mt-1 w-full"
        >
          {planOptions.map((plan) => (
            <option key={plan} value={plan}>
              {plan.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
      </label>
      <label className="block min-w-0">
        <span className="cx-label">Start date</span>
        <input type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="cx-input mt-1 w-full" />
      </label>
      <label className="block min-w-0">
        <span className="cx-label">End date</span>
        <input
          type="date"
          value={expiresAt}
          onChange={(e) => {
            setExpiresAt(e.target.value);
            setPlanDuration("CUSTOM");
          }}
          className="cx-input mt-1 w-full"
        />
      </label>
    </div>
  );
}
