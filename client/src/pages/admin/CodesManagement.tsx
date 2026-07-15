import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Trash2 } from "lucide-react";
import PortalLayout from "../../layouts/PortalLayout";
import DataTable from "../../components/DataTable";
import StatusBadge from "../../components/StatusBadge";
import { apiClient, type ApiResponse, type PagedResult } from "../../api/client";
import { adminNavItems } from "./navItems";

const statuses = ["UNUSED", "REDEEMED", "REVOKED", "REPLACED", "EXPIRED", "DELETED"] as const;

interface OrgOption {
  organizationId: string;
  name: string;
}

interface CodeRow {
  licenseId: string;
  organizationId: string;
  schoolName: string;
  maskedCode: string;
  status: string;
  batchName: string | null;
  studentIdentifier: string | null;
  studentEmail: string | null;
  createdAt: string | null;
  redeemedAt: string | null;
}

export default function CodesManagement() {
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [rows, setRows] = useState<CodeRow[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [status, setStatus] = useState("");
  const [batchName, setBatchName] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [confirmByBatch, setConfirmByBatch] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get<ApiResponse<PagedResult<OrgOption>>>("/admin/organizations?pageSize=100").then((res) => {
      if (res.data.success) setOrgs(res.data.data.items);
    });
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrg, status, batchName, search, page]);

  async function refresh() {
    const params = new URLSearchParams({ page: String(page), pageSize: "10" });
    if (selectedOrg) params.set("organizationId", selectedOrg);
    if (status) params.set("status", status);
    if (batchName) params.set("batchName", batchName);
    if (search) params.set("search", search);

    const res = await apiClient.get<ApiResponse<PagedResult<CodeRow>>>(`/admin/licenses?${params.toString()}`);
    if (res.data.success) {
      setRows(res.data.data.items);
      setTotalPages(res.data.data.totalPages);
    }
  }

  async function deleteLicense(licenseId: string) {
    if (!window.confirm("This will make this code permanently unavailable.")) return;
    setBusyId(licenseId);
    setError(null);
    setMessage(null);
    try {
      await apiClient.delete(`/admin/licenses/${licenseId}`);
      setMessage("Code deleted.");
      await refresh();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? "Failed to delete code.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteBatch(row: CodeRow) {
    if (!row.batchName) return;
    const key = `${row.organizationId}:${row.batchName}`;
    setBusyId(key);
    setError(null);
    setMessage(null);
    try {
      await apiClient.post(
        `/admin/organizations/${row.organizationId}/codes/batches/${encodeURIComponent(row.batchName)}/delete`,
        { confirmSchoolName: confirmByBatch[key] ?? "" }
      );
      setMessage("Code sheet deleted.");
      setConfirmByBatch((value) => ({ ...value, [key]: "" }));
      await refresh();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? "Failed to delete code sheet.");
    } finally {
      setBusyId(null);
    }
  }

  const sheets = useMemo(() => {
    const map = new Map<string, CodeRow>();
    rows.forEach((row) => {
      if (row.batchName) map.set(`${row.organizationId}:${row.batchName}`, row);
    });
    return Array.from(map.entries());
  }, [rows]);

  return (
    <PortalLayout items={adminNavItems}>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">Manage Codes</h1>
        <Link to="/admin/codes/create" className="min-h-11 inline-flex items-center px-4 py-2 rounded-lg bg-cx-accent text-cx-bg text-sm font-medium">
          Create Codes
        </Link>
      </div>

      <div className="grid md:grid-cols-4 gap-3 mb-4">
        <select
          value={selectedOrg}
          onChange={(e) => {
            setSelectedOrg(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
        >
          <option value="" className="bg-cx-panel">All schools</option>
          {orgs.map((org) => (
            <option key={org.organizationId} value={org.organizationId} className="bg-cx-panel">{org.name}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
        >
          <option value="" className="bg-cx-panel">All statuses</option>
          {statuses.map((item) => (
            <option key={item} value={item} className="bg-cx-panel">{item}</option>
          ))}
        </select>
        <input
          placeholder="Batch / sheet name"
          value={batchName}
          onChange={(e) => {
            setBatchName(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
        />
        <input
          placeholder="Search code, school, student"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
        />
      </div>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
      {message && <p className="text-sm text-cx-accent2 mb-3">{message}</p>}

      <DataTable
        rows={rows}
        columns={[
          { header: "Masked code", render: (row) => <span className="font-mono">{row.maskedCode}</span> },
          { header: "School", render: (row) => row.schoolName },
          { header: "Status", render: (row) => <StatusBadge status={row.status} /> },
          { header: "Student", render: (row) => row.studentEmail ?? row.studentIdentifier ?? "-" },
          { header: "Batch", render: (row) => row.batchName ?? "-" },
          { header: "Created", render: (row) => formatDate(row.createdAt) },
          { header: "Redeemed", render: (row) => formatDate(row.redeemedAt) },
          {
            header: "Delete",
            render: (row) => (
              <button
                onClick={() => deleteLicense(row.licenseId)}
                disabled={busyId === row.licenseId || row.status === "DELETED"}
                className="inline-flex items-center gap-1 text-red-300 hover:text-red-200 disabled:opacity-40"
              >
                <Trash2 size={15} /> Delete
              </button>
            ),
          },
        ]}
      />

      <Pagination page={page} totalPages={totalPages} onPage={setPage} />

      {sheets.length > 0 && (
        <div className="mt-8 space-y-3">
          <h2 className="text-lg font-medium">Delete Sheet</h2>
          {sheets.map(([key, row]) => {
            const confirmText = confirmByBatch[key] ?? "";
            const canDelete = confirmText === row.schoolName;
            return (
              <div key={key} className="glass-card p-4 flex flex-col md:flex-row md:items-end gap-3">
                <div className="flex-1">
                  <div className="text-sm font-medium">{row.batchName}</div>
                  <p className="text-xs text-cx-muted">
                    This will make all codes in this sheet permanently unavailable and invalid. Type the school name to confirm: {row.schoolName}
                  </p>
                  <input
                    value={confirmText}
                    onChange={(e) => setConfirmByBatch((value) => ({ ...value, [key]: e.target.value }))}
                    className="mt-2 w-full px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
                  />
                </div>
                <button
                  onClick={() => deleteBatch(row)}
                  disabled={!canDelete || busyId === key}
                  className="px-4 py-2 rounded-lg border border-red-400/50 text-red-300 text-sm disabled:opacity-40"
                >
                  Delete Sheet
                </button>
              </div>
            );
          })}
        </div>
      )}
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

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "-";
}
