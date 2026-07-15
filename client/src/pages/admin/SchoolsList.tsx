import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trash2 } from "lucide-react";
import PortalLayout from "../../layouts/PortalLayout";
import DataTable from "../../components/DataTable";
import StatusBadge from "../../components/StatusBadge";
import { apiClient, type ApiResponse, type PagedResult } from "../../api/client";
import { adminNavItems } from "./navItems";

interface OrgRow {
  organizationId: string;
  name: string;
  identifier: string;
  contactEmail: string;
  status: string;
  purchasedSeats: number;
  activatedSeats: number;
  activeCodesRemaining: number;
}

export default function SchoolsList() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | "ACTIVE" | "EXPIRED" | "SUSPENDED" | "ARCHIVED">("ALL");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filter, page]);

  async function refresh() {
    const params = new URLSearchParams({ page: String(page), pageSize: "10" });
    if (search) params.set("search", search);
    if (filter === "ARCHIVED") {
      params.set("status", "ARCHIVED");
      params.set("includeArchived", "true");
    } else if (filter !== "ALL") {
      params.set("status", filter);
    }
    const res = await apiClient.get<ApiResponse<PagedResult<OrgRow>>>(`/admin/organizations?${params.toString()}`);
    if (res.data.success) {
      setOrgs(res.data.data.items);
      setTotalPages(res.data.data.totalPages);
    }
  }

  async function deleteSchool(row: OrgRow) {
    if (row.activeCodesRemaining > 0) {
      setError("Delete all active codes for this school first (Manage Codes section) before deleting the school.");
      return;
    }
    if (!window.confirm(`Archive ${row.name} and disable its school admin account?`)) return;
    setBusyId(row.organizationId);
    setError(null);
    setMessage(null);
    try {
      await apiClient.delete(`/admin/organizations/${row.organizationId}`);
      setMessage("School archived.");
      await refresh();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? "Failed to delete school.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <PortalLayout items={adminNavItems}>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">Schools</h1>
        <Link to="/admin/schools/create" className="min-h-11 inline-flex items-center px-4 py-2 rounded-lg bg-cx-accent text-cx-bg text-sm font-medium">
          Create School
        </Link>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          placeholder="Search by name, identifier, or email"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 rounded-lg bg-white/5 border border-cx-border focus:border-cx-accent outline-none text-sm flex-1 min-w-[240px]"
        />
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as typeof filter);
            setPage(1);
          }}
          className="px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
        >
          <option value="ALL" className="bg-cx-panel">All</option>
          <option value="ACTIVE" className="bg-cx-panel">Active</option>
          <option value="EXPIRED" className="bg-cx-panel">Expired</option>
          <option value="SUSPENDED" className="bg-cx-panel">Suspended</option>
          <option value="ARCHIVED" className="bg-cx-panel">Archived</option>
        </select>
      </div>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
      {message && <p className="text-sm text-cx-accent2 mb-3">{message}</p>}

      <DataTable
        rows={orgs}
        columns={[
          { header: "School name", render: (r) => r.name },
          { header: "Identifier", render: (r) => r.identifier },
          { header: "Total seats", render: (r) => r.purchasedSeats },
          { header: "Activated", render: (r) => r.activatedSeats },
          { header: "Active codes", render: (r) => r.activeCodesRemaining },
          { header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          {
            header: "Actions",
            render: (r) => (
              <div className="flex items-center gap-3">
                <Link to={`/admin/schools/${r.organizationId}`} className="text-cx-accent hover:underline">
                  View
                </Link>
                <button
                  onClick={() => deleteSchool(r)}
                  disabled={busyId === r.organizationId || r.activeCodesRemaining > 0}
                  className="inline-flex items-center gap-1 text-red-300 hover:text-red-200 disabled:opacity-40"
                >
                  <Trash2 size={15} /> Delete
                </button>
              </div>
            ),
          },
        ]}
      />

      <div className="flex items-center gap-3 mt-4 text-sm">
        <button
          onClick={() => setPage((value) => Math.max(1, value - 1))}
          disabled={page <= 1}
          className="px-3 py-1.5 rounded-lg border border-cx-border disabled:opacity-40"
        >
          Previous
        </button>
        <span className="text-cx-muted">Page {page} of {totalPages}</span>
        <button
          onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
          disabled={page >= totalPages}
          className="px-3 py-1.5 rounded-lg border border-cx-border disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </PortalLayout>
  );
}
