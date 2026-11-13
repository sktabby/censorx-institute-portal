import { useEffect, useState } from "react";
import { ArrowRight, History, Info, Layers, ShieldCheck, UserCheck, Users, Wallet } from "lucide-react";
import PaymentStatusBadge, { formatInr, type PaymentStatusValue } from "../../components/PaymentStatusBadge";
import PortalLayout from "../../layouts/PortalLayout";
import PageHeader from "../../components/PageHeader";
import StatTile from "../../components/StatTile";
import CountUp from "../../components/CountUp";
import StatusBadge from "../../components/StatusBadge";
import { apiClient, type ApiResponse } from "../../api/client";
import { schoolNavItems } from "./navItems";

interface SubscriptionHistoryRow {
  subscriptionId: string;
  planDuration: string;
  seatLimit: number;
  startAt: string | null;
  expiresAt: string | null;
  status: string;
  createdAt: string | null;
}

/** Payment summary for the school. Missing for schools created before billing existed. */
interface PaymentSummary {
  status: PaymentStatusValue;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  installments: number;
  method: "CASH" | "CHEQUE" | "UPI" | "CARD" | null;
  billNumber: string;
}

const METHOD_LABEL = { CASH: "Cash", CHEQUE: "Cheque", UPI: "UPI", CARD: "Card" } as const;

interface SubscriptionInfo {
  plan: string | null;
  status: string;
  startAt: string | null;
  expiresAt: string | null;
  totalSeats: number;
  activatedSeats: number;
  availableSeats: number;
  allowedDevicesPerStudent: number;
  payment?: PaymentSummary | null;
  history: SubscriptionHistoryRow[];
}

export default function SchoolSubscription() {
  const [data, setData] = useState<SubscriptionInfo | null>(null);

  useEffect(() => {
    apiClient.get<ApiResponse<SubscriptionInfo>>("/school/subscription").then((res) => {
      if (res.data.success) setData(res.data.data);
    });
  }, []);

  const history = data?.history ?? [];

  return (
    <PortalLayout items={schoolNavItems}>
      <PageHeader title="Subscription" />

      {/* Four tiles: two per row on phones, one even row on desktop */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile
          variant="black"
          compact
          label="Plan"
          value={formatPlan(data?.plan ?? null)}
          icon={<Layers size={16} />}
          delay={0}
        />
        <StatTile
          variant="black"
          compact
          label="Status"
          value={<StatusBadge status={data?.status ?? "NONE"} tone="dark" />}
          icon={<ShieldCheck size={16} />}
          delay={70}
        />
        <StatTile
          variant="black"
          compact
          label="Total seats"
          value={<CountUp value={data?.totalSeats ?? 0} />}
          icon={<Users size={16} />}
          delay={140}
        />
        <StatTile
          variant="black"
          compact
          label="Available seats"
          value={<CountUp value={data?.availableSeats ?? 0} />}
          icon={<UserCheck size={16} />}
          delay={210}
        />
      </div>

      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-cx-accent/20 bg-cx-tint px-3.5 py-3 text-sm leading-relaxed text-cx-text">
        <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-cx-accent" />
        <p>
          For renewal, extension, or additional student seats, contact the CensorX team at{" "}
          <a
            href="mailto:team@censorx.in"
            className="font-medium text-cx-accent underline underline-offset-2 hover:text-cx-hover"
          >
            team@censorx.in
          </a>
          .
        </p>
      </div>

      {/* Payment: its own card, only for schools that have a payment record */}
      {data?.payment && (
        <section aria-labelledby="payment-heading" className="glass-card mt-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Wallet size={18} aria-hidden="true" className="text-cx-accent" />
              <h2 id="payment-heading" className="text-base font-semibold">
                Payment
              </h2>
            </div>
            <PaymentStatusBadge status={data.payment.status} />
          </div>

          <div
            className="mt-4 h-1.5 overflow-hidden rounded-full bg-cx-line"
            role="img"
            aria-label={`${formatInr(data.payment.paidAmount)} paid of ${formatInr(data.payment.totalAmount)}`}
          >
            <div
              className="h-full rounded-full bg-cx-accent"
              style={{
                width: `${
                  data.payment.totalAmount > 0
                    ? Math.min(100, Math.round((data.payment.paidAmount / data.payment.totalAmount) * 100))
                    : 0
                }%`,
              }}
            />
          </div>

          <dl className="mt-4 grid grid-cols-3 gap-3">
            <div className="min-w-0">
              <dt className="text-[11px] font-medium uppercase tracking-wider text-cx-muted">Total</dt>
              <dd className="mt-0.5 break-words text-sm font-semibold text-cx-heading">
                {formatInr(data.payment.totalAmount)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] font-medium uppercase tracking-wider text-cx-muted">Paid</dt>
              <dd className="mt-0.5 break-words text-sm font-semibold text-cx-heading">
                {formatInr(data.payment.paidAmount)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] font-medium uppercase tracking-wider text-cx-muted">Pending</dt>
              <dd className="mt-0.5 break-words text-sm font-semibold text-cx-heading">
                {formatInr(data.payment.pendingAmount)}
              </dd>
            </div>
          </dl>

          <p className="mt-3 text-xs text-cx-muted">
            {[
              data.payment.installments > 1 ? `${data.payment.installments} installments` : null,
              data.payment.method ? `Paid by ${METHOD_LABEL[data.payment.method]}` : null,
              `Bill ${data.payment.billNumber}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </section>
      )}

      {/* History: a plain list in a fixed-height scroll area */}
      <section aria-labelledby="subscription-history" className="mt-6">
        <div className="glass-card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-cx-line px-4 py-3.5 sm:px-5">
            <div className="flex items-center gap-2.5">
              <History size={18} aria-hidden="true" className="text-cx-accent" />
              <h2 id="subscription-history" className="text-base font-semibold">
                Subscription History
              </h2>
            </div>
            <span className="text-xs text-cx-muted">{history.length} total</span>
          </div>

          <div className="h-[22rem] overflow-y-auto [scrollbar-width:thin]">
            {history.length === 0 ? (
              <p className="py-12 text-center text-sm text-cx-muted">No subscription history found.</p>
            ) : (
              <ul className="divide-y divide-cx-line">
                {history.map((row) => {
                  const isActive = row.status === "ACTIVE";
                  return (
                    <li
                      key={row.subscriptionId}
                      className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 px-4 py-3.5 sm:px-5 ${
                        isActive ? "bg-cx-tint/60 shadow-[inset_3px_0_0_#0f6b65]" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-cx-heading">{formatPlan(row.planDuration)}</p>
                        <p className="text-xs text-cx-muted">{row.seatLimit} seats</p>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-cx-muted">
                        <span>{formatDate(row.startAt)}</span>
                        <ArrowRight size={14} aria-hidden="true" className="text-cx-accent" />
                        <span>{formatDate(row.expiresAt)}</span>
                      </div>
                      <StatusBadge status={row.status} />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </section>
    </PortalLayout>
  );
}

function formatPlan(value: string | null) {
  if (!value) return "-";
  return value.replace(/_/g, " ");
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "-";
}
