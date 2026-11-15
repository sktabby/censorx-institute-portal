import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Plus, RefreshCw, Trash2 } from "lucide-react";
import { filenameFrom, saveBlob } from "../../types/batches";
import PortalLayout from "../../layouts/PortalLayout";
import ReplaceCodeDialog from "../../components/ReplaceCodeDialog";
import PageHeader from "../../components/PageHeader";
import Select from "../../components/Select";
import SearchBox from "../../components/SearchBox";
import Pagination from "../../components/Pagination";
import DataTable from "../../components/DataTable";
import { MobileActions, MobileField, MobileFields } from "../../components/MobileCard";
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
  batchLabel?: string | null;
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
  const [replaceTarget, setReplaceTarget] = useState<CodeRow | null>(null);

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

  /** Full codes of the chosen school as an Excel file (the same file the school can download). */
  async function exportFullCodes() {
    if (!selectedOrg) return;
    setBusyId("export");
    setError(null);
    setMessage(null);
    try {
      const params = new URLSearchParams();
      if (batchName.trim()) params.set("batchNames", batchName.trim());
      const res = await apiClient.get(`/admin/organizations/${selectedOrg}/codes/export?${params.toString()}`, {
        responseType: "blob",
      });
      saveBlob(res.data as Blob, filenameFrom(res.headers["content-disposition"], "activation-codes.xlsx"));
      const unavailable = Number(res.headers["x-codes-unavailable"] ?? 0);
      setMessage(
        unavailable > 0
          ? `Downloaded. ${unavailable} older code(s) were made before secure storage and show as "Not available".`
          : "Downloaded."
      );
    } catch (err: any) {
      let text = "The codes could not be downloaded.";
      const data = err?.response?.data;
      if (data instanceof Blob) {
        try {
          text = JSON.parse(await data.text())?.error?.message ?? text;
        } catch {
          // keep the default text
        }
      }
      setError(text);
    } finally {
      setBusyId(null);
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

  function rowActions(row: CodeRow) {
    return (
      <>
        {row.status === "UNUSED" && (
          <button onClick={() => setReplaceTarget(row)} className="cx-link inline-flex items-center gap-1 rounded-lg px-2">
            <RefreshCw size={15} aria-hidden="true" /> Replace
          </button>
        )}
        <button
          onClick={() => deleteLicense(row.licenseId)}
          disabled={busyId === row.licenseId || row.status === "DELETED"}
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
        title="Manage Codes"
        action={
          <Link to="/admin/codes/create" className="cx-btn-primary min-h-11 w-full sm:w-auto">
            <Plus size={16} aria-hidden="true" />
            Create Codes
          </Link>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          aria-label="Filter by school"
          value={selectedOrg}
          onChange={(e) => {
            setSelectedOrg(e.target.value);
            setPage(1);
          }}
          className="cx-input w-full"
        >
          <option value="">All schools</option>
          {orgs.map((org) => (
            <option key={org.organizationId} value={org.organizationId}>{org.name}</option>
          ))}
        </Select>
        <Select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="cx-input w-full"
        >
          <option value="">All statuses</option>
          {statuses.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </Select>
        <input
          aria-label="Class name"
          placeholder="Class name"
          value={batchName}
          onChange={(e) => {
            setBatchName(e.target.value);
            setPage(1);
          }}
          className="cx-input w-full"
        />
        <SearchBox>
          <input
            aria-label="Search code, school, student"
            placeholder="Search code, school, student"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="cx-input w-full pl-10"
          />
        </SearchBox>
      </div>

      {selectedOrg && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cx-border bg-cx-surface px-3.5 py-2.5">
          <span className="text-sm text-cx-muted">
            Full codes for this school{batchName.trim() ? ` (class “${batchName.trim()}”)` : ""}, as an Excel file.
          </span>
          <button onClick={exportFullCodes} disabled={busyId === "export"} className="cx-btn-secondary w-full sm:w-auto">
            <Download size={16} aria-hidden="true" />
            {busyId === "export" ? "Preparing..." : "Download full codes"}
          </button>
        </div>
      )}

      {error && <p role="alert" className="cx-alert-error mb-3">{error}</p>}
      {message && <p role="status" className="cx-alert-success mb-3">{message}</p>}

      <DataTable
        rows={rows}
        columns={[
          { header: "Masked code", render: (row) => <span className="font-mono">{row.maskedCode}</span> },
          { header: "School", render: (row) => row.schoolName },
          { header: "Status", render: (row) => <StatusBadge status={row.status} /> },
          { header: "Student", render: (row) => row.studentEmail ?? row.studentIdentifier ?? "-" },
          { header: "Class", render: (row) => row.batchName ?? "-" },
          { header: "Batch", render: (row) => row.batchLabel ?? "-" },
          { header: "Created", render: (row) => formatDate(row.createdAt) },
          { header: "Redeemed", render: (row) => formatDate(row.redeemedAt) },
          {
            header: "Actions",
            render: (row) => <div className="flex items-center gap-1">{rowActions(row)}</div>,
          },
        ]}
        mobileCard={(row) => (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-sm font-semibold tracking-wide text-cx-heading">{row.maskedCode}</p>
                <p className="break-words text-xs text-cx-muted">{row.schoolName}</p>
              </div>
              <StatusBadge status={row.status} />
            </div>
            <MobileFields>
              <MobileField label="Class">
                {row.batchName ?? "-"}
                {row.batchLabel ? ` · ${row.batchLabel}` : ""}
              </MobileField>
              <MobileField label="Student">{row.studentEmail ?? row.studentIdentifier ?? "-"}</MobileField>
              <MobileField label="Created">{formatDate(row.createdAt)}</MobileField>
              <MobileField label="Redeemed">{formatDate(row.redeemedAt)}</MobileField>
            </MobileFields>
            <MobileActions>{rowActions(row)}</MobileActions>
          </>
        )}
      />

      <Pagination page={page} totalPages={totalPages} onPage={setPage} />

      {sheets.length > 0 && (
        <div className="mt-8 space-y-3">
          <h2 className="text-lg font-semibold">Delete Sheet</h2>
          {sheets.map(([key, row]) => {
            const confirmText = confirmByBatch[key] ?? "";
            const canDelete = confirmText === row.schoolName;
            return (
              <div key={key} className="glass-card flex flex-col gap-3 p-4 sm:p-6 md:flex-row md:items-end">
                <div className="min-w-0 flex-1">
                  <div className="break-words text-sm font-medium">{row.batchName}</div>
                  <p className="text-xs text-cx-muted">
                    This will make all codes in this sheet permanently unavailable and invalid. Type the school name to confirm: {row.schoolName}
                  </p>
                  <input
                    value={confirmText}
                    onChange={(e) => setConfirmByBatch((value) => ({ ...value, [key]: e.target.value }))}
                    className="mt-2 w-full cx-input"
                  />
                </div>
                <button
                  onClick={() => deleteBatch(row)}
                  disabled={!canDelete || busyId === key}
                  className="cx-btn-danger w-full md:w-auto"
                >
                  Delete Sheet
                </button>
              </div>
            );
          })}
        </div>
      )}

      {replaceTarget && (
        <ReplaceCodeDialog
          key={replaceTarget.licenseId}
          target={replaceTarget}
          onClose={(replaced) => {
            setReplaceTarget(null);
            if (replaced) {
              setError(null);
              setMessage("Code replaced. The old code no longer works.");
              void refresh();
            }
          }}
        />
      )}
    </PortalLayout>
  );
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "-";
}
