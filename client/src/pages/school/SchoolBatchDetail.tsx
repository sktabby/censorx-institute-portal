import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarRange, Download, FileText, KeyRound, PauseCircle, Users, Wallet } from "lucide-react";
import PortalLayout from "../../layouts/PortalLayout";
import StatusBadge from "../../components/StatusBadge";
import BillDialog from "../../components/BillDialog";
import PaymentStatusBadge, { formatInr } from "../../components/PaymentStatusBadge";
import { apiClient, type ApiResponse } from "../../api/client";
import { describeDaysLeft, filenameFrom, billKindLabel, formatDate, INSTALLMENT_STATUS, METHOD_LABEL, saveBlob, type BatchView } from "../../types/batches";
import { schoolNavItems } from "./navItems";

/** One batch in full: dates, classes, seats, payment schedule, bills and payments. */
export default function SchoolBatchDetail() {
  const { subscriptionId } = useParams();
  const navigate = useNavigate();
  const [batch, setBatch] = useState<BatchView | null>(null);
  const [history, setHistory] = useState<BatchView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bill, setBill] = useState<{ html: string; billNumber: string; pdfPath: string } | null>(null);
  const [busyBill, setBusyBill] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<ApiResponse<BatchView[]>>("/school/batches")
      .then((res) => {
        if (!res.data.success) return setError(res.data.error.message);
        const all = res.data.data;
        const found = all.find((item) => item.subscriptionId === subscriptionId) ?? null;
        setBatch(found);
        if (!found) setError("This batch could not be found.");
        // Earlier (renewed) periods of the same batch.
        else setHistory(all.filter((item) => item.batchNumber === found.batchNumber && item.subscriptionId !== found.subscriptionId));
      })
      .catch(() => setError("Could not load this batch."))
      .finally(() => setLoading(false));
  }, [subscriptionId]);

  function goBack() {
    // Back to where the school came from, or to Subscription when opened directly.
    if (window.history.length > 1) navigate(-1);
    else navigate("/school/subscription");
  }

  async function openBill(periodId: string, billNumber: string) {
    setBusyBill(billNumber);
    try {
      const query = `?billNumber=${encodeURIComponent(billNumber)}`;
      const res = await apiClient.get<ApiResponse<{ billNumber: string; html: string }>>(`/school/batches/${periodId}/bill${query}`);
      if (res.data.success) setBill({ ...res.data.data, pdfPath: `/school/batches/${periodId}/bill/pdf${query}` });
    } finally {
      setBusyBill(null);
    }
  }

  async function downloadPdf(periodId: string, billNumber: string) {
    setBusyBill(billNumber);
    try {
      const res = await apiClient.get(`/school/batches/${periodId}/bill/pdf?billNumber=${encodeURIComponent(billNumber)}`, {
        responseType: "blob",
      });
      saveBlob(res.data as Blob, filenameFrom(res.headers["content-disposition"], `Invoice-${billNumber}.pdf`));
    } finally {
      setBusyBill(null);
    }
  }

  const payment = batch?.payment ?? null;
  const paidPercent = payment && payment.totalAmount > 0 ? Math.min(100, Math.round((payment.paidAmount / payment.totalAmount) * 100)) : 0;

  return (
    <PortalLayout items={schoolNavItems}>
      {/* Sticky header with a clear way back */}
      <div className="sticky top-16 z-20 -mx-4 -mt-4 mb-4 bg-white px-4 py-3 sm:-mx-6 sm:-mt-6 sm:px-6 md:-mx-8 md:-mt-8 md:px-8">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full pr-3 text-sm font-medium text-cx-accent transition-colors hover:text-cx-hover"
        >
          <ArrowLeft size={18} aria-hidden="true" />
          Back to Subscription
        </button>
        {batch && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-cx-heading">{batch.batchLabel}</h1>
            <StatusBadge status={batch.isPaused ? "PAUSED" : batch.status} />
            {payment?.isOverdue && <span className="badge border-red-200 bg-red-50 text-red-700">Payment overdue</span>}
          </div>
        )}
      </div>

      {loading ? (
        <p role="status" className="text-sm text-cx-muted">Loading batch...</p>
      ) : error || !batch ? (
        <div className="glass-card p-8 text-center">
          <p className="text-sm text-cx-muted">{error ?? "This batch could not be found."}</p>
          <Link to="/school/subscription" className="cx-btn-primary mt-4">
            Back to Subscription
          </Link>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-3xl space-y-4">
          {batch.isPaused && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800">
              <PauseCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              <p>
                Access for this batch is paused{batch.pausedAt ? ` since ${formatDate(batch.pausedAt)}` : ""}
                {batch.pauseReason ? `: ${batch.pauseReason}` : ""}. Students in its classes cannot use the app until it is restored.
                Their codes are kept. Contact CensorX at team@censorx.in.
              </p>
            </div>
          )}

          {/* Overview */}
          <Card icon={<CalendarRange size={18} />} title="Overview">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <Fact label="Starts">{formatDate(batch.startAt)}</Fact>
              <Fact label="Ends">{formatDate(batch.expiresAt)}</Fact>
              <Fact label="Time left">
                <span className={batch.isLive && batch.daysRemaining > 14 ? "" : "text-amber-700"}>{describeDaysLeft(batch)}</span>
              </Fact>
              <Fact label="Plan">{batch.planDuration.replace(/_/g, " ")}</Fact>
            </dl>
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-cx-muted">
                <span>Students joined</span>
                <span>
                  {batch.seatUsage.activatedSeats} of {batch.seatLimit}
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-cx-line">
                <div
                  className="h-full rounded-full bg-cx-accent"
                  style={{ width: `${batch.seatLimit ? Math.min(100, Math.round((batch.seatUsage.activatedSeats / batch.seatLimit) * 100)) : 0}%` }}
                />
              </div>
            </div>
          </Card>

          {/* Classes */}
          <Card icon={<Users size={18} />} title={`Classes (${batch.classes.length})`}>
            <ul className="cx-scroll divide-y divide-cx-line rounded-xl border border-cx-border text-sm">
              {batch.classes.map((item) => (
                <li key={item.batchName} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5">
                  <span className="min-w-0 break-words font-medium text-cx-heading">{item.batchName}</span>
                  <span className="text-xs text-cx-muted">
                    {item.seatCount} codes · {item.redeemedCount} joined{item.pendingSeats > 0 ? " · codes on the way" : ""}
                  </span>
                </li>
              ))}
            </ul>
            <Link to="/school/download-codes" className="cx-link mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm">
              <KeyRound size={15} aria-hidden="true" /> Download this batch's codes
            </Link>
          </Card>

          {/* Payment */}
          {payment ? (
            <Card icon={<Wallet size={18} />} title="Payment" action={<PaymentStatusBadge status={payment.status} />}>
              <div className="h-2 overflow-hidden rounded-full bg-cx-line" aria-hidden="true">
                <div className="h-full rounded-full bg-cx-accent" style={{ width: `${paidPercent}%` }} />
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-3">
                <Fact label="Total">{formatInr(payment.totalAmount)}</Fact>
                <Fact label="Paid">{formatInr(payment.paidAmount)}</Fact>
                <Fact label="Balance">
                  <span className={payment.pendingAmount > 0 ? "text-amber-700" : ""}>{formatInr(payment.pendingAmount)}</span>
                </Fact>
              </dl>
              {payment.discountAmount > 0 && (
                <p className="mt-2 text-xs text-cx-muted">
                  Includes a {payment.discountPercent}% discount of {formatInr(payment.discountAmount)}.
                </p>
              )}

              {(payment.upfrontAmount ?? 0) > 0 && (
                <p className="mt-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cx-accent/20 bg-cx-tint/60 px-3 py-2 text-sm">
                  <span className="text-cx-text">Paid separately (not in installments)</span>
                  <span className="font-semibold text-cx-heading">{formatInr(payment.upfrontAmount ?? 0)}</span>
                </p>
              )}
              {payment.schedule.length > 0 && (
                <>
                  <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-cx-muted">
                    {(payment.upfrontAmount ?? 0) > 0 ? "Installments for the rest" : "Installments"}
                  </h3>
                  <ul className="cx-scroll-sm divide-y divide-cx-line rounded-xl border border-cx-border text-sm">
                    {payment.schedule.map((item) => (
                      <li key={item.number} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5">
                        <span>
                          <span className="font-medium text-cx-heading">#{item.number}</span>
                          <span className="ml-2 text-cx-muted">due {formatDate(item.dueDate)}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-cx-text">{formatInr(item.amount)}</span>
                          <span className={`badge whitespace-nowrap ${INSTALLMENT_STATUS[item.status].tone}`}>
                            {INSTALLMENT_STATUS[item.status].label}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {payment.transactions.length > 0 && (
                <>
                  <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-cx-muted">Payments received</h3>
                  <ul className="cx-scroll-sm space-y-1.5 pr-1 text-sm">
                    {payment.transactions.map((txn) => (
                      <li key={txn.transactionId} className="flex justify-between gap-3">
                        <span className="text-cx-muted">
                          {formatDate(txn.paidAt)} · {METHOD_LABEL[txn.method]}
                        </span>
                        <span className="font-medium text-cx-heading">{formatInr(txn.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-cx-muted">Bills</h3>
              <BillList periodId={batch.subscriptionId} bills={payment.bills} busy={busyBill} onOpen={openBill} onPdf={downloadPdf} />
            </Card>
          ) : (
            <Card icon={<Wallet size={18} />} title="Payment">
              <p className="text-sm text-cx-muted">No bill has been issued for this batch.</p>
            </Card>
          )}

          {/* Earlier periods of this batch */}
          {history.length > 0 && (
            <Card icon={<FileText size={18} />} title="Earlier periods">
              <ul className="cx-scroll space-y-3 pr-1">
                {history.map((period) => (
                  <li key={period.subscriptionId} className="rounded-xl border border-cx-border p-3">
                    <p className="text-sm font-medium text-cx-heading">
                      {formatDate(period.startAt)} → {formatDate(period.expiresAt)}
                    </p>
                    {period.payment ? (
                      <div className="mt-2">
                        <BillList periodId={period.subscriptionId} bills={period.payment.bills} busy={busyBill} onOpen={openBill} onPdf={downloadPdf} />
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-cx-muted">No bill for this period.</p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      <BillDialog html={bill?.html ?? null} billNumber={bill?.billNumber ?? ""} pdfPath={bill?.pdfPath} onClose={() => setBill(null)} />
    </PortalLayout>
  );
}

function BillList({
  periodId,
  bills,
  busy,
  onOpen,
  onPdf,
}: {
  periodId: string;
  bills: Array<{ billNumber: string; issuedAt: string | null; kind: "INVOICE" | "PAYMENT" | "ADJUSTMENT"; reason?: "EXTRA_CODES" | "SCHEDULE_CHANGE" | null; balance: number }>;
  busy: string | null;
  onOpen: (periodId: string, billNumber: string) => void;
  onPdf: (periodId: string, billNumber: string) => void;
}) {
  return (
    <ul className="cx-scroll-sm divide-y divide-cx-line rounded-xl border border-cx-border text-sm">
      {[...bills].reverse().map((bill, index) => (
        <li key={bill.billNumber} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
          <span className="min-w-0">
            <span className="block [overflow-wrap:anywhere] font-medium text-cx-heading">
              {bill.billNumber}
              {index === 0 ? (
                <span className="ml-2 text-xs font-medium text-cx-accent">latest</span>
              ) : (
                <span className="ml-2 text-xs font-medium text-cx-muted">replaced</span>
              )}
            </span>
            <span className="text-xs text-cx-muted">
              {billKindLabel(bill.kind, bill.reason)} · {formatDate(bill.issuedAt)} · balance {formatInr(bill.balance)}
            </span>
          </span>
          <span className="flex gap-1">
            <button
              type="button"
              onClick={() => onOpen(periodId, bill.billNumber)}
              disabled={busy === bill.billNumber}
              className="cx-link inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm"
            >
              <FileText size={15} aria-hidden="true" /> View
            </button>
            <button
              type="button"
              onClick={() => onPdf(periodId, bill.billNumber)}
              disabled={busy === bill.billNumber}
              className="cx-link inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm"
            >
              <Download size={15} aria-hidden="true" /> PDF
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Card({ icon, title, action, children }: { icon: ReactNode; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="glass-card p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="text-cx-accent">
            {icon}
          </span>
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-cx-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-semibold text-cx-heading">{children}</dd>
    </div>
  );
}
