import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Download, KeyRound, ShieldAlert } from "lucide-react";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import PortalLayout from "../../layouts/PortalLayout";
import PageHeader from "../../components/PageHeader";
import Select from "../../components/Select";
import SearchBox from "../../components/SearchBox";
import Pagination from "../../components/Pagination";
import StatusBadge from "../../components/StatusBadge";
import { apiClient, type ApiResponse, type PagedResult } from "../../api/client";
import { firebaseAuth } from "../../config/firebase";
import { schoolNavItems } from "./navItems";

const statuses = ["UNUSED", "REDEEMED", "REVOKED", "REPLACED", "EXPIRED", "DELETED"] as const;

// Column layout shared by the header labels and every row on large screens.
const CODE_GRID = "lg:grid-cols-[minmax(0,1.4fr)_7rem_minmax(0,1fr)_minmax(0,1fr)_6rem_6rem]";

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
      <PageHeader
        title="Student Codes"
        action={
          <button
            onClick={openDownloadDialog}
            disabled={codes.length === 0}
            aria-label="Download codes"
            title="Download codes"
            className="cx-btn-primary w-11 px-0 sm:w-auto sm:px-5"
          >
            <Download size={16} aria-hidden="true" />
            <span className="hidden sm:inline">Download</span>
          </button>
        }
      />

      <p className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs leading-snug text-amber-800 sm:inline-flex sm:items-center sm:rounded-full sm:text-sm">
        <ShieldAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 sm:mt-0" />
        Students will redeem CensorX services on their mobile app using these codes. Handle with care.
      </p>

      <div className="mb-4 grid gap-3 sm:grid-cols-[220px_1fr]">
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
        <SearchBox>
          <input
            aria-label="Search by masked code or student ID"
            placeholder="Search by masked code or student ID"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="cx-input w-full pl-10"
          />
        </SearchBox>
      </div>

      {/* Codes as row cards: stacked on phones, aligned columns on large screens */}
      {codes.length === 0 ? (
        <div className="glass-card p-8 text-center text-sm text-cx-muted">No records found.</div>
      ) : (
        <div>
          <div
            aria-hidden="true"
            className={`hidden gap-4 px-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-cx-muted lg:grid ${CODE_GRID}`}
          >
            <span>Masked code</span>
            <span>Status</span>
            <span>Batch</span>
            <span>Student ID</span>
            <span>Created</span>
            <span>Redeemed</span>
          </div>
          <ul className="space-y-2.5">
            {codes.map((row, index) => (
              <li
                key={`${row.licenseId}-${index}`}
                className={`grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-2xl border border-cx-border bg-white px-4 py-3 transition duration-200 animate-fade-up hover:border-cx-accent/40 hover:shadow-card motion-reduce:animate-none motion-reduce:transition-none lg:items-center lg:gap-x-4 ${CODE_GRID}`}
                style={{ animationDelay: `${index * 40}ms` }}
              >
                <div className="col-span-2 flex min-w-0 items-center justify-between gap-3 lg:col-span-1 lg:justify-start">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cx-dark text-white">
                      <KeyRound size={16} aria-hidden="true" />
                    </span>
                    <span className="truncate font-mono text-sm font-semibold tracking-wide text-cx-heading">
                      {row.maskedCode}
                    </span>
                  </div>
                  <span className="lg:hidden">
                    <StatusBadge status={row.status} />
                  </span>
                </div>
                <div className="hidden lg:block">
                  <StatusBadge status={row.status} />
                </div>
                <Field label="Batch">{row.batchName ?? "-"}</Field>
                <Field label="Student ID">{row.studentIdentifier ?? "-"}</Field>
                <Field label="Created">{formatDate(row.createdAt)}</Field>
                <Field label="Redeemed">{formatDate(row.redeemedAt)}</Field>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onPage={setPage} />

      {downloadOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="download-dialog-title"
          className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-cx-deep/60 p-4"
        >
          <form
            onSubmit={confirmDownload}
            className="cx-form-card w-full max-w-md shadow-2xl"
          >
            <h2 id="download-dialog-title" className="mb-2 text-xl font-semibold">Confirm Download</h2>
            <p className="mb-4 text-sm text-cx-muted">
              Re-enter your password to download the masked student codes currently visible on this page.
            </p>
            <label className="cx-label mb-2 block" htmlFor="download-password">
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
              className="cx-input w-full"
            />
            {downloadError && <p role="alert" className="cx-alert-error mt-3">{downloadError}</p>}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDownloadOpen(false)}
                className="cx-btn-secondary w-full sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={downloadBusy}
                className="cx-btn-primary w-full sm:w-auto"
              >
                <Download size={16} aria-hidden="true" />
                {downloadBusy ? "Verifying..." : "Download CSV"}
              </button>
            </div>
          </form>
        </div>
      )}
    </PortalLayout>
  );
}

/** A labelled value. The label shows on phones only; large screens use the column header. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="block text-[10px] font-medium uppercase tracking-wider text-cx-muted lg:hidden">{label}</span>
      <span className="block truncate text-sm text-cx-text">{children}</span>
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
