import { useEffect, useState } from "react";
import PortalLayout from "../../layouts/PortalLayout";
import SummaryCard from "../../components/SummaryCard";
import DataTable from "../../components/DataTable";
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

  return (
    <PortalLayout items={adminNavItems}>
      <h1 className="text-2xl font-semibold mb-6">Dashboard</h1>

      {loading ? (
        <div className="text-cx-muted">Loading dashboard...</div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <SummaryCard label="Total Schools" value={summary?.totalSchools ?? 0} />
            <SummaryCard label="Active Schools" value={summary?.activeSchools ?? 0} />
            <SummaryCard label="Expired Schools" value={summary?.expiredSchools ?? 0} />
            <SummaryCard label="Total Student Seats" value={summary?.totalStudentSeats ?? 0} />
            <SummaryCard label="Activated Students" value={summary?.activatedStudents ?? 0} />
            <SummaryCard label="Total Students Joined" value={summary?.totalStudentsJoined ?? 0} />
            <SummaryCard label="Available Seats" value={summary?.availableSeats ?? 0} />
          </div>

          <h2 className="text-lg font-medium mb-3">Recent Schools</h2>
          <DataTable
            rows={orgs}
            columns={[
              { header: "School name", render: (r) => r.name },
              { header: "Total seats", render: (r) => r.purchasedSeats },
              { header: "Used seats", render: (r) => r.activatedSeats },
              { header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
        </>
      )}
    </PortalLayout>
  );
}
