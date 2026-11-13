import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Building2, Users, UserCheck } from "lucide-react";
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
}

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
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Schools" value={summary?.totalSchools ?? 0} icon={<Building2 size={18} />} delay={0}>
              <p className="mt-1 text-xs text-cx-muted">
                <span className="font-medium text-cx-accent">{summary?.activeSchools ?? 0} active</span>
                {" · "}
                {summary?.expiredSchools ?? 0} expired
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

            <div className="glass-card overflow-hidden">
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
                          <span className="min-w-0 truncate font-medium text-cx-heading">{row.name}</span>
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
      className="glass-card p-4 animate-fade-up motion-reduce:animate-none sm:p-5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-cx-muted">{label}</p>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-cx-tint text-cx-accent">
          {icon}
        </span>
      </div>
      <p className="mt-3 text-3xl font-bold tracking-tight text-cx-heading">
        <CountUp value={value} />
      </p>
      {children}
    </div>
  );
}
