import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlarmClock, ChevronRight, Info, Layers, PauseCircle, ShieldCheck, UserCheck, Users, Wallet } from "lucide-react";
import PaymentStatusBadge, { formatInr } from "../../components/PaymentStatusBadge";
import PortalLayout from "../../layouts/PortalLayout";
import PageHeader from "../../components/PageHeader";
import StatTile from "../../components/StatTile";
import CountUp from "../../components/CountUp";
import StatusBadge from "../../components/StatusBadge";
import { apiClient, type ApiResponse } from "../../api/client";
import { describeDaysLeft, formatDate, type BatchView } from "../../types/batches";
import { schoolNavItems } from "./navItems";

interface SubscriptionInfo {
  organizationStatus: string;
  statusExplanation: string;
  liveBatchCount: number;
  batchCount: number;
  batches: BatchView[];
  seatLimit: number;
  activatedSeats: number;
}

type Filter = "ALL" | "LIVE" | "ENDED";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "LIVE", label: "Live" },
  { value: "ENDED", label: "Ended / paused" },
];

export default function SchoolSubscription() {
  const [data, setData] = useState<SubscriptionInfo | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");

  useEffect(() => {
    apiClient.get<ApiResponse<SubscriptionInfo>>("/school/subscription").then((res) => {
      if (res.data.success) setData(res.data.data);
    });
  }, []);

  // Current periods only (renewed periods are history, shown on each batch's page).
  const batches = useMemo(() => {
    const current = (data?.batches ?? []).filter((batch) => batch.isCurrentPeriod);
    return current
      .filter((batch) => (filter === "ALL" ? true : filter === "LIVE" ? batch.isLive : !batch.isLive))
      .sort((a, b) => Number(b.isLive) - Number(a.isLive) || b.batchNumber - a.batchNumber);
  }, [data, filter]);

  const current = (data?.batches ?? []).filter((batch) => batch.isCurrentPeriod);
  const due = current.filter((batch) => (batch.payment?.amountDueNow ?? 0) > 0);
  const totalDue = due.reduce((sum, batch) => sum + (batch.payment?.amountDueNow ?? 0), 0);
  const endingSoon = current.filter((batch) => batch.isLive && batch.daysRemaining <= 14);
  const paused = current.filter((batch) => batch.isPaused);

  return (
    <PortalLayout items={schoolNavItems}>
      <PageHeader title="Subscription" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile
          variant="black"
          compact
          label="School status"
          value={<StatusBadge status={data?.organizationStatus ?? "NONE"} tone="dark" />}
          icon={<ShieldCheck size={16} />}
          delay={0}
        />
        <StatTile
          variant="black"
          compact
          label="Live batches"
          value={
            <>
              <CountUp value={data?.liveBatchCount ?? 0} />
              <span className="text-sm font-medium text-white/60"> of {data?.batchCount ?? 0}</span>
            </>
          }
          icon={<Layers size={16} />}
          delay={70}
        />
        <StatTile variant="black" compact label="Seats in live batches" value={<CountUp value={data?.seatLimit ?? 0} />} icon={<Users size={16} />} delay={140} />
        <StatTile variant="black" compact label="Students joined" value={<CountUp value={data?.activatedSeats ?? 0} />} icon={<UserCheck size={16} />} delay={210} />
      </div>

      {/* Things that need attention, most urgent first */}
      <div className="mt-4 space-y-2">
        {paused.length > 0 && (
          <Notice tone="red" icon={<PauseCircle size={16} />}>
            Access is paused for {paused.map((batch) => batch.batchLabel).join(", ")}. Students in these batches cannot use the app.
            Contact CensorX to restore it.
          </Notice>
        )}
        {totalDue > 0 && (
          <Notice tone={due.some((batch) => batch.payment?.isOverdue) ? "red" : "amber"} icon={<Wallet size={16} />}>
            {formatInr(totalDue)} is due now ({due.map((batch) => batch.batchLabel).join(", ")}). Open the batch to see the schedule and
            your bills.
          </Notice>
        )}
        {endingSoon.length > 0 && (
          <Notice tone="amber" icon={<AlarmClock size={16} />}>
            Ending soon:{" "}
            {endingSoon.map((batch) => `${batch.batchLabel} (${batch.daysRemaining <= 0 ? "today" : `${batch.daysRemaining} days`})`).join(", ")}.
            Contact CensorX to renew — the same codes keep working.
          </Notice>
        )}
        {data && (
          <Notice tone="teal" icon={<Info size={16} />}>
            {data.statusExplanation} Each batch has its own dates: a student's code works until the end date of their class's batch.
          </Notice>
        )}
      </div>

      {/* Batches: fixed-height list, details on their own page */}
      <section aria-labelledby="your-batches" className="mt-6">
        <div className="glass-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cx-line px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2.5">
              <Layers size={18} aria-hidden="true" className="text-cx-accent" />
              <h2 id="your-batches" className="text-base font-semibold">
                Your subscribed plans
              </h2>
              <span className="text-xs text-cx-muted">{current.length}</span>
            </div>
            <div className="flex gap-1 rounded-full border border-cx-border bg-white p-1" role="tablist" aria-label="Filter subscribed plans">
              {FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={filter === option.value}
                  onClick={() => setFilter(option.value)}
                  className={`min-h-9 rounded-full px-3 text-xs font-medium transition-colors ${
                    filter === option.value ? "bg-cx-accent text-white" : "text-cx-muted hover:bg-cx-surface hover:text-cx-text"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="h-[26rem] overflow-y-auto [scrollbar-width:thin] sm:h-[28rem]">
            {!data ? (
              <p role="status" className="py-12 text-center text-sm text-cx-muted">Loading...</p>
            ) : batches.length === 0 ? (
              <p className="py-12 text-center text-sm text-cx-muted">
                {current.length === 0 ? "No batch has been set up yet." : "No batch matches this filter."}
              </p>
            ) : (
              <ul className="divide-y divide-cx-line">
                {batches.map((batch) => (
                  <BatchRow key={batch.subscriptionId} batch={batch} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </PortalLayout>
  );
}

function BatchRow({ batch }: { batch: BatchView }) {
  const soon = batch.isLive && batch.daysRemaining <= 14;
  const percent = batch.seatLimit > 0 ? Math.min(100, Math.round((batch.seatUsage.activatedSeats / batch.seatLimit) * 100)) : 0;
  return (
    <li
      className={`px-4 py-3.5 sm:px-5 ${batch.isPaused ? "shadow-[inset_3px_0_0_#dc2626]" : batch.isLive ? "shadow-[inset_3px_0_0_#0f6b65]" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-cx-heading">{batch.batchLabel}</span>
            <StatusBadge status={batch.isPaused ? "PAUSED" : batch.status} />
            {batch.payment?.isOverdue && <span className="badge border-red-200 bg-red-50 text-red-700">Payment overdue</span>}
          </div>
          <p className="mt-0.5 text-xs text-cx-muted">
            {formatDate(batch.startAt)} → {formatDate(batch.expiresAt)} ·{" "}
            <span className={soon || !batch.isLive ? "font-medium text-amber-700" : ""}>{describeDaysLeft(batch)}</span>
          </p>
          <p className="mt-0.5 break-words text-xs text-cx-muted">
            {batch.classes.length} class{batch.classes.length === 1 ? "" : "es"}: {batch.classes.map((item) => item.batchName).join(", ") || "-"}
          </p>
        </div>
        <Link
          to={`/school/subscription/${batch.subscriptionId}`}
          className="cx-btn-secondary shrink-0 px-3 py-1.5 text-xs sm:text-sm"
          aria-label={`View details of ${batch.batchLabel}`}
        >
          <span className="hidden sm:inline">View details</span>
          <span className="sm:hidden">Details</span>
          <ChevronRight size={15} aria-hidden="true" />
        </Link>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-[10rem] flex-1 items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-cx-line">
            <span className="block h-full rounded-full bg-cx-accent" style={{ width: `${percent}%` }} />
          </span>
          <span className="shrink-0 text-xs text-cx-muted">
            {batch.seatUsage.activatedSeats}/{batch.seatLimit} joined
          </span>
        </div>
        {batch.payment && <PaymentStatusBadge status={batch.payment.status} />}
      </div>
    </li>
  );
}

function Notice({ tone, icon, children }: { tone: "red" | "amber" | "teal"; icon: React.ReactNode; children: React.ReactNode }) {
  const style =
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-800"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-cx-accent/20 bg-cx-tint text-cx-text";
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-relaxed ${style}`}>
      <span aria-hidden="true" className={`mt-0.5 shrink-0 ${tone === "teal" ? "text-cx-accent" : ""}`}>
        {icon}
      </span>
      <p>{children}</p>
    </div>
  );
}
