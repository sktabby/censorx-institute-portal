import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import PortalLayout from "../../layouts/PortalLayout";
import PageHeader from "../../components/PageHeader";
import Select from "../../components/Select";
import SearchBox from "../../components/SearchBox";
import DataTable from "../../components/DataTable";
import { MobileActions, MobileField, MobileFields } from "../../components/MobileCard";
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
  liveBatchCount?: number;
  batchCount?: number;
  nextExpiresAt?: string | null;
  endingSoonCount?: number;
  pausedCount?: number;
  amountDue?: number;
  overdueCount?: number;
}

const inr = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

/** Small flags for a school: batches ending soon, access stopped, money overdue. */
function Flags({ row }: { row: OrgRow }) {
  const flags: Array<{ text: string; tone: string }> = [];
  if (row.endingSoonCount) flags.push({ text: `${row.endingSoonCount} ending soon`, tone: "border-amber-200 bg-amber-50 text-amber-700" });
  if (row.pausedCount) flags.push({ text: `${row.pausedCount} paused`, tone: "border-red-200 bg-red-50 text-red-700" });
  if (row.amountDue) {
    flags.push({
      text: `${inr(row.amountDue)} ${row.overdueCount ? "overdue" : "due"}`,
      tone: row.overdueCount ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700",
    });
  }
  if (flags.length === 0) return <span className="text-xs text-cx-muted">-</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((flag) => (
        <span key={flag.text} className={`badge whitespace-nowrap ${flag.tone}`}>
          {flag.text}
        </span>
      ))}
    </span>
  );
}

function nextEnd(row: OrgRow) {
  return row.nextExpiresAt ? new Date(row.nextExpiresAt).toLocaleDateString() : "-";
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

  function rowActions(r: OrgRow) {
    return (
      <>
        <Link to={`/admin/schools/${r.organizationId}`} className="cx-link inline-flex min-h-11 items-center">
          View
        </Link>
        <button
          onClick={() => deleteSchool(r)}
          disabled={busyId === r.organizationId || r.activeCodesRemaining > 0}
          className="cx-link-danger"
        >
          <Trash2 size={15} aria-hidden="true" /> Delete
        </button>
      </>
    );
  }

  return (
    <PortalLayout items={adminNavItems}>
      <PageHeader
        title="Schools"
        action={
          <Link to="/admin/schools/create" className="cx-btn-primary min-h-11 w-full sm:w-auto">
            <Plus size={16} aria-hidden="true" />
            Create School
          </Link>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_200px]">
        <SearchBox>
          <input
            aria-label="Search by name, identifier, or email"
            placeholder="Search by name, identifier, or email"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="cx-input w-full pl-10"
          />
        </SearchBox>
        <Select
          aria-label="Filter by status"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as typeof filter);
            setPage(1);
          }}
          className="cx-input w-full"
        >
          <option value="ALL">All</option>
          <option value="ACTIVE">Active</option>
          <option value="EXPIRED">Expired</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="ARCHIVED">Archived</option>
        </Select>
      </div>

      {error && <p role="alert" className="cx-alert-error mb-3">{error}</p>}
      {message && <p role="status" className="cx-alert-success mb-3">{message}</p>}

      <DataTable
        rows={orgs}
        columns={[
          { header: "School name", render: (r) => r.name },
          { header: "Batches", render: (r) => (r.batchCount ? `${r.liveBatchCount ?? 0} live of ${r.batchCount}` : "None") },
          { header: "Next end", render: (r) => nextEnd(r) },
          { header: "Attention", render: (r) => <Flags row={r} /> },
          { header: "Students", render: (r) => r.activatedSeats },
          { header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          {
            header: "Actions",
            render: (r) => <div className="flex items-center gap-3">{rowActions(r)}</div>,
          },
        ]}
        mobileCard={(r) => (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words font-semibold text-cx-heading">{r.name}</p>
                <p className="break-words text-xs text-cx-muted">{r.identifier}</p>
              </div>
              <StatusBadge status={r.status} />
            </div>
            <MobileFields>
              <MobileField label="Batches">{r.batchCount ? `${r.liveBatchCount ?? 0} live of ${r.batchCount}` : "None"}</MobileField>
              <MobileField label="Next end">{nextEnd(r)}</MobileField>
              <MobileField label="Students">{r.activatedSeats}</MobileField>
              <MobileField label="Active codes">{r.activeCodesRemaining}</MobileField>
              <MobileField label="Attention" wide>
                <Flags row={r} />
              </MobileField>
            </MobileFields>
            <MobileActions>{rowActions(r)}</MobileActions>
          </>
        )}
      />

      <div className="mt-4 flex items-center justify-between gap-2 text-sm sm:justify-start sm:gap-3">
        <button
          onClick={() => setPage((value) => Math.max(1, value - 1))}
          disabled={page <= 1}
          className="cx-btn-secondary px-3 py-1.5"
        >
          Previous
        </button>
        <span className="whitespace-nowrap text-center text-cx-muted">Page {page} of {totalPages}</span>
        <button
          onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
          disabled={page >= totalPages}
          className="cx-btn-secondary px-3 py-1.5"
        >
          Next
        </button>
      </div>
    </PortalLayout>
  );
}
