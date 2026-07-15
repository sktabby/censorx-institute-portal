import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import PortalLayout from "../../layouts/PortalLayout";
import StatusBadge from "../../components/StatusBadge";
import DataTable from "../../components/DataTable";
import { apiClient, type ApiResponse, type PagedResult } from "../../api/client";
import { adminNavItems } from "./navItems";

const licenseStatuses = ["ACTIVE", "UNUSED", "REVOKED", "REPLACED", "EXPIRED", "DELETED"] as const;

interface OrgDetail {
  organizationId: string;
  name: string;
  identifier: string;
  status: string;
  organizationStatus: string;
  subscriptionStatus: string;
  purchasedSeats: number;
  activatedSeats: number;
  allowedDevicesPerStudent: number;
}

interface LicenseRow {
  licenseId: string;
  studentName: string | null;
  studentIdentifier: string | null;
  parentName?: string | null;
  parentEmail?: string | null;
  deviceModel: string | null;
  status: string;
}

export default function SchoolDetail() {
  const { organizationId } = useParams();
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [licenseSearch, setLicenseSearch] = useState("");
  const [licenseStatus, setLicenseStatus] = useState("");
  const [licensePage, setLicensePage] = useState(1);
  const [licenseTotal, setLicenseTotal] = useState(0);
  const [licenseTotalPages, setLicenseTotalPages] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    if (!organizationId) return;
    const params = new URLSearchParams({ page: String(licensePage), pageSize: "10" });
    if (licenseSearch) params.set("search", licenseSearch);
    if (licenseStatus) params.set("status", licenseStatus);

    const [orgRes, licRes] = await Promise.all([
      apiClient.get<ApiResponse<OrgDetail>>(`/admin/organizations/${organizationId}`),
      apiClient.get<ApiResponse<PagedResult<LicenseRow>>>(
        `/admin/organizations/${organizationId}/licenses?${params.toString()}`
      ),
    ]);
    if (orgRes.data.success) setOrg(orgRes.data.data);
    if (licRes.data.success) {
      setLicenses(licRes.data.data.items);
      setLicenseTotal(licRes.data.data.total);
      setLicenseTotalPages(licRes.data.data.totalPages);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, licenseSearch, licenseStatus, licensePage]);

  async function toggleSuspend() {
    if (!organizationId || !org) return;
    setBusy(true);
    setMessage(null);
    try {
      const action = org.organizationStatus === "SUSPENDED" ? "reactivate" : "suspend";
      await apiClient.post(`/admin/organizations/${organizationId}/${action}`);
      await refresh();
      setMessage(`School ${action === "suspend" ? "suspended" : "reactivated"}.`);
    } finally {
      setBusy(false);
    }
  }

  if (!org) {
    return (
      <PortalLayout items={adminNavItems}>
        <div className="text-cx-muted">Loading school...</div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout items={adminNavItems}>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{org.name}</h1>
          <p className="text-sm text-cx-muted">{org.identifier}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={org.status} />
          <button
            onClick={toggleSuspend}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-cx-border text-sm hover:border-cx-accent/50"
          >
            {org.organizationStatus === "SUSPENDED" ? "Reactivate" : "Suspend"}
          </button>
        </div>
      </div>

      {message && <p className="text-sm text-cx-accent2 mb-4">{message}</p>}

      <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total seats" value={org.purchasedSeats} />
        <StatCard label="Activated" value={org.activatedSeats} />
        <StatCard label="Available" value={org.purchasedSeats - org.activatedSeats} />
        <StatCard label="Devices / student" value={org.allowedDevicesPerStudent} />
      </div>

      <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
        <h2 className="text-lg font-medium">Student Licenses</h2>
        <span className="text-sm text-cx-muted">
          Showing {licenses.length} of {licenseTotal} licenses
        </span>
      </div>

      <div className="grid md:grid-cols-[220px_1fr] gap-3 mb-4">
        <select
          value={licenseStatus}
          onChange={(e) => {
            setLicenseStatus(e.target.value);
            setLicensePage(1);
          }}
          className="px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
        >
          <option value="" className="bg-cx-panel">All statuses</option>
          {licenseStatuses.map((status) => (
            <option key={status} value={status} className="bg-cx-panel">{status}</option>
          ))}
        </select>
        <input
          placeholder="Search student name, student ID, or license ID"
          value={licenseSearch}
          onChange={(e) => {
            setLicenseSearch(e.target.value);
            setLicensePage(1);
          }}
          className="px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
        />
      </div>

      <DataTable
        rows={licenses}
        columns={[
          { header: "License ID", render: (r) => <span className="text-xs">{r.licenseId}</span> },
          { header: "Student Name", render: (r) => r.studentName ?? "-" },
          { header: "Student ID", render: (r) => r.studentIdentifier ?? "-" },
          { header: "Parent Name", render: (r) => r.parentName ?? "-" },
          { header: "Parent Email", render: (r) => r.parentEmail ?? "-" },
          { header: "Device", render: (r) => r.deviceModel ?? "-" },
          { header: "Status", render: (r) => <StatusBadge status={r.status} /> },
        ]}
        emptyMessage="No licenses generated yet."
      />

      <Pagination page={licensePage} totalPages={licenseTotalPages} onPage={setLicensePage} />

      <p className="text-xs text-cx-muted mt-4">
        To generate or manage activation codes for this school, use the Codes section.
      </p>
    </PortalLayout>
  );
}

function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (page: number) => void }) {
  return (
    <div className="flex items-center gap-3 mt-4 text-sm">
      <button
        onClick={() => onPage(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="px-3 py-1.5 rounded-lg border border-cx-border disabled:opacity-40"
      >
        Previous
      </button>
      <span className="text-cx-muted">Page {page} of {totalPages}</span>
      <button
        onClick={() => onPage(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="px-3 py-1.5 rounded-lg border border-cx-border disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="glass-card p-4">
      <div className="text-xs text-cx-muted mb-1">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}
