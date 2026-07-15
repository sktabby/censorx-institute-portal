import { useEffect, useMemo, useState } from "react";
import PortalLayout from "../../layouts/PortalLayout";
import SummaryCard from "../../components/SummaryCard";
import StatusBadge from "../../components/StatusBadge";
import DataTable from "../../components/DataTable";
import { apiClient, type ApiResponse } from "../../api/client";
import { schoolNavItems } from "./navItems";

interface RecentActivation {
  licenseId: string;
  studentName: string | null;
  studentIdentifier: string | null;
  studentEmail: string | null;
  redeemedAt: string | null;
  status: string;
}

interface Dashboard {
  schoolName: string;
  subscriptionStatus: string;
  subscriptionDisplayStatus: string;
  plan: string | null;
  planDuration: string | null;
  totalSeats: number;
  totalStudentSeats: number;
  activatedSeats: number;
  totalRedeemedStudents: number;
  availableSeats: number;
  unusedCodes: number;
  revokedCodes: number;
  recentActivations: RecentActivation[];
}

export default function SchoolDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);

  useEffect(() => {
    apiClient.get<ApiResponse<Dashboard>>("/school/dashboard").then((res) => {
      if (res.data.success) setData(res.data.data);
    });
  }, []);

  const seatUsage = useMemo(() => {
    const totalSeats = data?.totalStudentSeats ?? data?.totalSeats ?? 0;
    const usedSeats = data?.totalRedeemedStudents ?? data?.activatedSeats ?? 0;
    const percent = totalSeats > 0 ? Math.min(100, Math.round((usedSeats / totalSeats) * 100)) : 0;
    return { totalSeats, usedSeats, percent };
  }, [data]);

  const plan = data?.planDuration ?? data?.plan ?? "No plan";
  const status = data?.subscriptionStatus ?? "NONE";

  return (
    <PortalLayout items={schoolNavItems}>
      <section className="glass-card p-6 md:p-8 mb-6 overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          <div>
            <p className="text-sm text-cx-muted mb-2">School dashboard</p>
            <h1 className="text-3xl md:text-4xl font-semibold leading-tight">{data?.schoolName ?? "Dashboard"}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <StatusBadge status={status} />
              <span className="text-sm text-cx-muted">Current plan: {formatPlan(plan)}</span>
            </div>
          </div>

          <div className="min-w-full lg:min-w-[320px] lg:w-[360px]">
            <div className="flex items-end justify-between gap-4 mb-3">
              <div>
                <p className="text-sm text-cx-muted">Seat usage</p>
                <p className="text-2xl font-semibold">
                  {seatUsage.usedSeats} of {seatUsage.totalSeats}
                </p>
              </div>
              <span className="text-sm font-medium text-cx-accent2">{seatUsage.percent}% used</span>
            </div>
            <div className="h-3 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cx-accent to-cx-accent2 transition-all"
                style={{ width: `${seatUsage.percent}%` }}
              />
            </div>
            <p className="text-xs text-cx-muted mt-3">
              {data?.availableSeats ?? 0} seats available, {data?.unusedCodes ?? 0} unused codes ready.
            </p>
          </div>
        </div>
      </section>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <SummaryCard label="Plan Duration" value={formatPlan(plan)} />
        <SummaryCard label="Subscription" value={data?.subscriptionDisplayStatus ?? "Not Subscribed"} />
        <SummaryCard label="Available Seats" value={data?.availableSeats ?? 0} />
        <SummaryCard label="Unused Codes" value={data?.unusedCodes ?? 0} />
      </div>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Recent Activations</h2>
          <span className="text-sm text-cx-muted">Latest redeemed student codes</span>
        </div>
        <DataTable
          rows={data?.recentActivations ?? []}
          emptyMessage="No activations yet."
          columns={[
            { header: "Student", render: (row) => row.studentName ?? row.studentIdentifier ?? row.studentEmail ?? "-" },
            { header: "Student ID", render: (row) => row.studentIdentifier ?? "-" },
            { header: "Status", render: (row) => <StatusBadge status={row.status} /> },
            { header: "Redeemed", render: (row) => formatDate(row.redeemedAt) },
          ]}
        />
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
