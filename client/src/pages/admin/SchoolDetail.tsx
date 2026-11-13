import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { FileText, Send } from "lucide-react";
import PortalLayout from "../../layouts/PortalLayout";
import BillDialog from "../../components/BillDialog";
import PaymentStatusBadge, { formatInr, type PaymentStatusValue } from "../../components/PaymentStatusBadge";
import PageHeader from "../../components/PageHeader";
import Select from "../../components/Select";
import SearchBox from "../../components/SearchBox";
import Pagination from "../../components/Pagination";
import SummaryCard from "../../components/SummaryCard";
import StatusBadge from "../../components/StatusBadge";
import DataTable from "../../components/DataTable";
import { apiClient, type ApiResponse, type PagedResult } from "../../api/client";
import { adminNavItems } from "./navItems";

const licenseStatuses = ["ACTIVE", "UNUSED", "REVOKED", "REPLACED", "EXPIRED", "DELETED"] as const;

/** Mirrors SeatUsage in server/src/utils/seatAccounting.ts. */
interface SeatUsage {
  totalSeats: number;
  activatedSeats: number;
  unusedCodes: number;
  expiredSeats: number;
  revokedSeats: number;
  seatLimit: number;
  remainingCapacity: number;
  availableSeats: number;
}

/** Payment recorded when the school was created. Missing on older schools. */
interface PaymentInfo {
  billNumber: string;
  status: PaymentStatusValue;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  installments: number;
  method: "CASH" | "CHEQUE" | "UPI" | "CARD" | null;
  methodDetails: {
    chequeNumber?: string;
    bankName?: string;
    chequeDate?: string;
    transactionId?: string;
    upiId?: string;
    cardLast4?: string;
    cardReference?: string;
  } | null;
}

interface OrgDetail {
  organizationId: string;
  name: string;
  identifier: string;
  status: string;
  organizationStatus: string;
  subscriptionStatus: string;
  seatUsage: SeatUsage;
  allowedDevicesPerStudent: number;
  payment?: PaymentInfo | null;
}

const METHOD_LABEL = { CASH: "Cash", CHEQUE: "Cheque", UPI: "UPI", CARD: "Card" } as const;

function methodSummary(payment: PaymentInfo): string {
  if (!payment.method) return "None yet";
  const label = METHOD_LABEL[payment.method];
  const d = payment.methodDetails ?? {};
  const detail =
    payment.method === "CHEQUE"
      ? [d.chequeNumber && `No. ${d.chequeNumber}`, d.bankName].filter(Boolean).join(" · ")
      : payment.method === "UPI"
        ? d.transactionId && `Txn ${d.transactionId}`
        : payment.method === "CARD"
          ? d.cardLast4 && `•••• ${d.cardLast4}`
          : "";
  return detail ? `${label} (${detail})` : label;
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
  const [billHtml, setBillHtml] = useState<string | null>(null);
  const [billBusy, setBillBusy] = useState(false);
  const [billNotice, setBillNotice] = useState<string | null>(null);
  const [billError, setBillError] = useState<string | null>(null);

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

  async function viewBill() {
    if (!organizationId) return;
    setBillBusy(true);
    setBillNotice(null);
    setBillError(null);
    try {
      const res = await apiClient.get<ApiResponse<{ billNumber: string; html: string }>>(
        `/admin/organizations/${organizationId}/bill`
      );
      if (res.data.success) setBillHtml(res.data.data.html);
      else setBillError(res.data.error.message);
    } catch (err: any) {
      setBillError(err?.response?.data?.error?.message ?? "Could not load the bill.");
    } finally {
      setBillBusy(false);
    }
  }

  async function sendBill() {
    if (!organizationId) return;
    setBillBusy(true);
    setBillNotice(null);
    setBillError(null);
    try {
      const res = await apiClient.post<ApiResponse<{ sent: boolean; to: string }>>(
        `/admin/organizations/${organizationId}/bill/send`
      );
      if (res.data.success) setBillNotice(`Bill emailed to ${res.data.data.to}.`);
      else setBillError(res.data.error.message);
    } catch (err: any) {
      setBillError(err?.response?.data?.error?.message ?? "The bill could not be emailed.");
    } finally {
      setBillBusy(false);
    }
  }

  if (!org) {
    return (
      <PortalLayout items={adminNavItems}>
        <div role="status" className="text-cx-muted">Loading school...</div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout items={adminNavItems}>
      <PageHeader
        title={org.name}
        description={<span className="break-all">{org.identifier}</span>}
        action={
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            <StatusBadge status={org.status} />
            <Link
              to={`/admin/schools/${organizationId}/history`}
              className="cx-btn-secondary min-h-11 w-full sm:w-auto"
            >
              Subscription History
            </Link>
            <button
              onClick={toggleSuspend}
              disabled={busy}
              className="cx-btn-secondary w-full sm:w-auto"
            >
              {org.organizationStatus === "SUSPENDED" ? "Reactivate" : "Suspend"}
            </button>
          </div>
        }
      />

      {message && <p role="status" className="cx-alert-success mb-4">{message}</p>}

      {/* Seat numbers come straight from the server's seat-accounting module —
          no arithmetic here, so admin and school views cannot disagree. */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Total seats" value={org.seatUsage.totalSeats} />
        <StatCard label="Activated" value={org.seatUsage.activatedSeats} />
        <StatCard label="Unused codes" value={org.seatUsage.unusedCodes} />
        <StatCard label="Remaining capacity" value={org.seatUsage.remainingCapacity} />
        <StatCard label="Devices / student" value={org.allowedDevicesPerStudent} />
      </div>

      {/* Payment: only for schools created with payment details */}
      {org.payment && (
        <section aria-labelledby="school-payment" className="glass-card mb-8 p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="school-payment" className="text-lg font-semibold">
                Payment
              </h2>
              <PaymentStatusBadge status={org.payment.status} />
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <button onClick={viewBill} disabled={billBusy} className="cx-btn-secondary">
                <FileText size={16} aria-hidden="true" />
                View bill
              </button>
              <button onClick={sendBill} disabled={billBusy} className="cx-btn-primary">
                <Send size={16} aria-hidden="true" />
                {billBusy ? "Please wait..." : "Send bill to school"}
              </button>
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-5">
            <PayFigure label="Total">{formatInr(org.payment.totalAmount)}</PayFigure>
            <PayFigure label="Paid">{formatInr(org.payment.paidAmount)}</PayFigure>
            <PayFigure label="Pending">{formatInr(org.payment.pendingAmount)}</PayFigure>
            <PayFigure label="Installments">{org.payment.installments}</PayFigure>
            <PayFigure label="Method">{methodSummary(org.payment)}</PayFigure>
          </dl>

          <p className="mt-4 text-xs text-cx-muted">Bill {org.payment.billNumber}</p>

          {billNotice && <p role="status" className="cx-alert-success mt-4">{billNotice}</p>}
          {billError && <p role="alert" className="cx-alert-error mt-4">{billError}</p>}
        </section>
      )}

      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">Student Licenses</h2>
        <span className="text-sm text-cx-muted">
          Showing {licenses.length} of {licenseTotal} licenses
        </span>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-[220px_1fr]">
        <Select
          aria-label="Filter by status"
          value={licenseStatus}
          onChange={(e) => {
            setLicenseStatus(e.target.value);
            setLicensePage(1);
          }}
          className="cx-input w-full"
        >
          <option value="">All statuses</option>
          {licenseStatuses.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </Select>
        <SearchBox>
          <input
            aria-label="Search student name, student ID, or license ID"
            placeholder="Search student name, student ID, or license ID"
            value={licenseSearch}
            onChange={(e) => {
              setLicenseSearch(e.target.value);
              setLicensePage(1);
            }}
            className="cx-input w-full pl-10"
          />
        </SearchBox>
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

      <BillDialog html={billHtml} billNumber={org.payment?.billNumber ?? ""} onClose={() => setBillHtml(null)} />
    </PortalLayout>
  );
}

function PayFigure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-cx-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-semibold text-cx-heading">{children}</dd>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return <SummaryCard label={label} value={value} />;
}
