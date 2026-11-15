import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Building2, CalendarClock, PauseCircle, Users, UserCheck, Wallet } from "lucide-react";
import PortalLayout from "../../layouts/PortalLayout";
import PageHeader from "../../components/PageHeader";
import CountUp from "../../components/CountUp";
import StatusBadge from "../../components/StatusBadge";
import { apiClient, type ApiResponse, type PagedResult } from "../../api/client";
import { adminNavItems } from "./navItems";

interface DashboardSummary {
  totalSchools: number;
  activeSchools: number;
  expiredSchools: number;
  totalStudentSeats: number;
  activatedStudents: number;
  totalStudentsJoined: number;
  availableSeats: number;
  liveBatches?: number;
  endingSoon?: Array<{
    organizationId: string;
    schoolName: string;
    subscriptionId: string;
    batchLabel: string;
    expiresAt: string | null;
    daysRemaining: number;
    seatLimit: number;
  }>;
  paymentsDue?: Array<{
    organizationId: string;
    schoolName: string;
    subscriptionId: string;
    batchLabel: string;
    installmentNumber: number;
    installmentCount: number;
    amount: number;
    dueDate: string;
    status: "UPCOMING" | "PART_PAID" | "DUE" | "OVERDUE" | "PAID";
    daysLate: number;
    isPaused: boolean;
  }>;
  pausedBatches?: Array<{
    organizationId: string;
    schoolName: string;
    subscriptionId: string;
    batchLabel: string;
    pausedAt: string | null;
    pauseReason: string | null;
  }>;
}

const inr = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

interface OrgRow {
  organizationId: string;
  name: string;
  status: string;
  purchasedSeats: number;
  activatedSeats: number;
}

export default function AdminDashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [dashRes, orgRes] = await Promise.all([
        apiClient.get<ApiResponse<DashboardSummary>>("/admin/dashboard"),
        apiClient.get<ApiResponse<PagedResult<OrgRow>>>("/admin/organizations?pageSize=8"),
      ]);
      if (dashRes.data.success) setSummary(dashRes.data.data);
      if (orgRes.data.success) setOrgs(orgRes.data.data.items);
      setLoading(false);
    })();
  }, []);

  // Display-only figure, taken from numbers the server already returned.
  const seatTotal = summary?.totalStudentSeats ?? 0;
  const joined = summary?.activatedStudents ?? 0;
  const seatPercent = seatTotal > 0 ? Math.min(100, Math.round((joined / seatTotal) * 100)) : 0;

  return (
    <PortalLayout items={adminNavItems}>
      <PageHeader title="Dashboard" />

      {loading ? (
        <div role="status" className="text-cx-muted">Loading dashboard...</div>
      ) : (
        <>
          {/* Three figures, each shown once */}
          {/* Two per row on phones (the last one spans the row), three across from sm up */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
            <Stat label="Schools" value={summary?.totalSchools ?? 0} icon={<Building2 size={18} />} delay={0}>
              <p className="mt-1 text-xs text-cx-muted">
                <span className="font-medium text-cx-accent">{summary?.activeSchools ?? 0} active</span>
                {" · "}
                {summary?.expiredSchools ?? 0} expired
                {summary?.liveBatches !== undefined && ` · ${summary.liveBatches} live batches`}
              </p>
            </Stat>

            <Stat label="Seats" value={seatTotal} icon={<Users size={18} />} delay={70}>
              <p className="mt-1 text-xs text-cx-muted">{summary?.availableSeats ?? 0} available</p>
            </Stat>

            <Stat label="Students joined" value={joined} icon={<UserCheck size={18} />} delay={140}>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-cx-line">
                <div
                  className="h-full rounded-full bg-cx-accent transition-[width] duration-1000 ease-out motion-reduce:transition-none"
                  style={{ width: `${seatPercent}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-cx-muted">{seatPercent}% of seats used</p>
            </Stat>
          </div>

          {/* Money to collect: overdue first, then due, then due within a week */}
          {(summary?.paymentsDue?.length ?? 0) > 0 && (
            <section className="mt-8" aria-labelledby="payments-due">
              <div className="mb-3 flex items-center gap-2">
                <Wallet size={18} aria-hidden="true" className="text-red-600" />
                <h2 id="payments-due" className="text-lg font-semibold">
                  Payments to collect
                </h2>
                <span className="badge border-cx-border bg-cx-tint text-cx-heading">{summary!.paymentsDue!.length}</span>
              </div>
              <div className="glass-card cx-scroll">
                <ul className="divide-y divide-cx-line">
                  {[...summary!.paymentsDue!]
                    .sort((a, b) => Number(b.status === "OVERDUE") - Number(a.status === "OVERDUE") || a.dueDate.localeCompare(b.dueDate))
                    .map((row) => (
                      <li key={`${row.subscriptionId}-${row.installmentNumber}`}>
                        <Link
                          to={`/admin/subscriptions?school=${row.organizationId}`}
                          className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3.5 transition-colors hover:bg-cx-tint/60 sm:px-5"
                        >
                          <span className="min-w-0">
                            <span className="block break-words font-medium text-cx-heading">{row.schoolName}</span>
                            <span className="block text-xs text-cx-muted">
                              {row.batchLabel} · installment {row.installmentNumber} of {row.installmentCount} · due{" "}
                              {new Date(row.dueDate).toLocaleDateString()}
                              {row.isPaused && " · access stopped"}
                            </span>
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="font-semibold text-cx-heading">{inr(row.amount)}</span>
                            <span
                              className={`badge whitespace-nowrap ${
                                row.status === "OVERDUE"
                                  ? "border-red-200 bg-red-50 text-red-700"
                                  : row.status === "DUE"
                                    ? "border-amber-200 bg-amber-50 text-amber-700"
                                    : "border-gray-200 bg-gray-100 text-gray-700"
                              }`}
                            >
                              {row.status === "OVERDUE" ? `${row.daysLate} days late` : row.status === "DUE" ? "Due" : "Due soon"}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            </section>
          )}

          {/* Batches whose access was stopped by hand */}
          {(summary?.pausedBatches?.length ?? 0) > 0 && (
            <section className="mt-8" aria-labelledby="paused-batches">
              <div className="mb-3 flex items-center gap-2">
                <PauseCircle size={18} aria-hidden="true" className="text-red-600" />
                <h2 id="paused-batches" className="text-lg font-semibold">
                  Access stopped
                </h2>
                <span className="badge border-cx-border bg-cx-tint text-cx-heading">{summary!.pausedBatches!.length}</span>
              </div>
              <div className="glass-card cx-scroll">
                <ul className="divide-y divide-cx-line">
                  {summary!.pausedBatches!.map((row) => (
                    <li key={row.subscriptionId}>
                      <Link
                        to={`/admin/subscriptions?school=${row.organizationId}`}
                        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3.5 transition-colors hover:bg-cx-tint/60 sm:px-5"
                      >
                        <span className="min-w-0">
                          <span className="block break-words font-medium text-cx-heading">{row.schoolName}</span>
                          <span className="block text-xs text-cx-muted">
                            {row.batchLabel}
                            {row.pausedAt && ` · since ${new Date(row.pausedAt).toLocaleDateString()}`}
                            {row.pauseReason && ` · ${row.pauseReason}`}
                          </span>
                        </span>
                        <span className="badge whitespace-nowrap border-red-200 bg-red-50 text-red-700">Paused</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {/* Batches that end soon: the renewal to-do list */}
          {(summary?.endingSoon?.length ?? 0) > 0 && (
            <section className="mt-8" aria-labelledby="ending-soon">
              <div className="mb-3 flex items-center gap-2">
                <CalendarClock size={18} aria-hidden="true" className="text-amber-600" />
                <h2 id="ending-soon" className="text-lg font-semibold">
                  Batches ending in the next 14 days
                </h2>
                <span className="badge border-cx-border bg-cx-tint text-cx-heading">{summary!.endingSoon!.length}</span>
              </div>
              <div className="glass-card cx-scroll">
                <ul className="divide-y divide-cx-line">
                  {summary!.endingSoon!.map((row) => (
                    <li key={row.subscriptionId}>
                      <Link
                        to={`/admin/subscriptions?school=${row.organizationId}`}
                        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3.5 transition-colors hover:bg-cx-tint/60 sm:px-5"
                      >
                        <span className="min-w-0">
                          <span className="block break-words font-medium text-cx-heading">{row.schoolName}</span>
                          <span className="block text-xs text-cx-muted">
                            {row.batchLabel} · {row.seatLimit} seats · ends{" "}
                            {row.expiresAt ? new Date(row.expiresAt).toLocaleDateString() : "-"}
                          </span>
                        </span>
                        <span className="badge whitespace-nowrap border-amber-200 bg-amber-50 text-amber-700">
                          {row.daysRemaining === 0 ? "Ends today" : `${row.daysRemaining} day${row.daysRemaining === 1 ? "" : "s"} left`}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {/* Recent schools */}
          <section className="mt-8" aria-labelledby="recent-schools">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="recent-schools" className="text-lg font-semibold">
                Recent schools
              </h2>
              <Link to="/admin/schools" className="cx-link inline-flex min-h-11 items-center gap-1 text-sm">
                View all <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>

            <div className="glass-card cx-scroll">
              {orgs.length === 0 ? (
                <p className="p-8 text-center text-sm text-cx-muted">No records found.</p>
              ) : (
                <ul className="divide-y divide-cx-line">
                  {orgs.map((row) => {
                    const percent =
                      row.purchasedSeats > 0
                        ? Math.min(100, Math.round((row.activatedSeats / row.purchasedSeats) * 100))
                        : 0;
                    return (
                      <li key={row.organizationId}>
                        <Link
                          to={`/admin/schools/${row.organizationId}`}
                          className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2.5 px-4 py-3.5 transition-colors hover:bg-cx-tint/60 sm:grid-cols-[1fr_15rem_auto] sm:px-5"
                        >
                          <span className="min-w-0 break-words font-medium text-cx-heading">{row.name}</span>
                          <StatusBadge status={row.status} />
                          <span className="col-span-2 flex items-center gap-3 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-cx-line">
                              <span
                                className="block h-full rounded-full bg-cx-accent"
                                style={{ width: `${percent}%` }}
                              />
                            </span>
                            <span className="w-16 shrink-0 text-right text-xs text-cx-muted">
                              {row.activatedSeats} / {row.purchasedSeats}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </PortalLayout>
  );
}

function Stat({
  label,
  value,
  icon,
  delay,
  children,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  delay: number;
  children?: ReactNode;
}) {
  return (
    <div
      className="glass-card p-3.5 animate-fade-up motion-reduce:animate-none sm:p-5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-[11px] font-medium uppercase leading-tight tracking-wider text-cx-muted sm:text-xs">
          {label}
        </p>
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cx-tint text-cx-accent sm:h-9 sm:w-9">
          {icon}
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-cx-heading sm:mt-3 sm:text-3xl">
        <CountUp value={value} />
      </p>
      {children}
    </div>
  );
}
