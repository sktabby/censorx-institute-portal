import { type FormEvent, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import PortalLayout from "../../layouts/PortalLayout";
import DataTable from "../../components/DataTable";
import StatusBadge from "../../components/StatusBadge";
import { apiClient, type ApiResponse, type PagedResult } from "../../api/client";
import { firebaseAuth } from "../../config/firebase";
import { schoolNavItems } from "./navItems";

const statuses = ["UNUSED", "REDEEMED", "REVOKED", "REPLACED", "EXPIRED", "DELETED"] as const;

interface CodeRow {
  maskedCode: string;
  licenseId: string;
  batchName: string | null;
  status: string;
  studentIdentifier: string | null;
  createdAt: string | null;
  redeemedAt: string | null;
}

export default function SchoolCodes() {
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "10" });
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    apiClient.get<ApiResponse<PagedResult<CodeRow>>>(`/school/codes?${params.toString()}`).then((res) => {
      if (res.data.success) {
        setCodes(res.data.data.items);
        setTotalPages(res.data.data.totalPages);
      }
    });
  }, [search, status, page]);

  function openDownloadDialog() {
    setPassword("");
    setDownloadError(null);
    setDownloadOpen(true);
  }

  async function confirmDownload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const user = firebaseAuth.currentUser;
    if (!user?.email) {
      setDownloadError("We could not verify your session. Sign in again and try later.");
      return;
    }
    if (!password) {
      setDownloadError("Enter your password to continue.");
      return;
    }

    setDownloadBusy(true);
    setDownloadError(null);
    try {
      const credential = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, credential);
      downloadVisibleCodes(codes);
      setDownloadOpen(false);
      setPassword("");
    } catch {
      setDownloadError("Password could not be verified. Try again.");
    } finally {
      setDownloadBusy(false);
    }
  }

  return (
    <PortalLayout items={schoolNavItems}>
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Student Codes</h1>
          <p className="text-sm text-cx-muted mt-1">View masked codes and their current effective status.</p>
        </div>
        <div className="flex flex-col items-start lg:items-end gap-2">
          <button
            onClick={openDownloadDialog}
            disabled={codes.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cx-accent text-cx-bg text-sm font-medium disabled:opacity-40"
          >
            <Download size={16} />
            Download Codes
          </button>
          <p className="text-xs text-cx-muted">Re-enter your password to download student code data.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
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
          placeholder="Search by masked code or student ID"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm flex-1 min-w-[240px]"
        />
      </div>

      <DataTable
        rows={codes}
        columns={[
          { header: "Masked code", render: (row) => <span className="font-mono">{row.maskedCode}</span> },
          { header: "Status", render: (row) => <StatusBadge status={row.status} /> },
          { header: "Batch", render: (row) => row.batchName ?? "-" },
          { header: "Student ID", render: (row) => row.studentIdentifier ?? "-" },
          { header: "Created", render: (row) => formatDate(row.createdAt) },
          { header: "Redeemed", render: (row) => formatDate(row.redeemedAt) },
        ]}
      />

      <Pagination page={page} totalPages={totalPages} onPage={setPage} />

      {downloadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <form onSubmit={confirmDownload} className="glass-card p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-semibold mb-2">Confirm Download</h2>
            <p className="text-sm text-cx-muted mb-4">
              Re-enter your password to download the masked student codes currently visible on this page.
            </p>
            <label className="block text-sm text-cx-muted mb-2" htmlFor="download-password">
              Password
            </label>
            <input
              id="download-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setDownloadError(null);
              }}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
            />
            {downloadError && <p className="text-sm text-red-400 mt-3">{downloadError}</p>}
            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setDownloadOpen(false)}
                className="px-4 py-2 rounded-lg border border-cx-border text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={downloadBusy}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cx-accent text-cx-bg text-sm font-medium disabled:opacity-40"
              >
                <Download size={16} />
                {downloadBusy ? "Verifying..." : "Download CSV"}
              </button>
            </div>
          </form>
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

function downloadVisibleCodes(rows: CodeRow[]) {
  const headers = ["Masked code", "Status", "Batch", "Student ID", "Created", "Redeemed"];
  const csv = [
    headers,
    ...rows.map((row) => [
      row.maskedCode,
      row.status,
      row.batchName ?? "",
      row.studentIdentifier ?? "",
      formatDate(row.createdAt),
      formatDate(row.redeemedAt),
    ]),
  ]
    .map((line) => line.map(escapeCsv).join(","))
    .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `student-codes-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeCsv(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "-";
}
