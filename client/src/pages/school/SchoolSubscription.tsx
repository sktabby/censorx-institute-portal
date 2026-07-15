import { useEffect, useState } from "react";
import PortalLayout from "../../layouts/PortalLayout";
import SummaryCard from "../../components/SummaryCard";
import DataTable from "../../components/DataTable";
import StatusBadge from "../../components/StatusBadge";
import { apiClient, type ApiResponse } from "../../api/client";
import { schoolNavItems } from "./navItems";

interface SubscriptionHistoryRow {
  subscriptionId: string;
  planDuration: string;
  seatLimit: number;
  startAt: string | null;
  expiresAt: string | null;
  status: string;
  createdAt: string | null;
}

interface SubscriptionInfo {
  plan: string | null;
  status: string;
  startAt: string | null;
  expiresAt: string | null;
  totalSeats: number;
  activatedSeats: number;
  availableSeats: number;
  allowedDevicesPerStudent: number;
  history: SubscriptionHistoryRow[];
}

export default function SchoolSubscription() {
  const [data, setData] = useState<SubscriptionInfo | null>(null);
  const [historyPage, setHistoryPage] = useState(1);

  useEffect(() => {
    apiClient.get<ApiResponse<SubscriptionInfo>>("/school/subscription").then((res) => {
      if (res.data.success) setData(res.data.data);
    });
  }, []);

  const history = data?.history ?? [];
  const historyPageSize = 10;
  const historyTotalPages = Math.max(1, Math.ceil(history.length / historyPageSize));
  const visibleHistory = history.slice((historyPage - 1) * historyPageSize, historyPage * historyPageSize);

  return (
    <PortalLayout items={schoolNavItems}>
      <h1 className="text-2xl font-semibold mb-6">Subscription</h1>

      <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <SummaryCard label="Plan" value={formatPlan(data?.plan ?? null)} />
        <SummaryCard label="Status" value={<StatusBadge status={data?.status ?? "NONE"} />} />
        <SummaryCard label="Total Seats" value={data?.totalSeats ?? 0} />
        <SummaryCard label="Available Seats" value={data?.availableSeats ?? 0} />
      </div>

      <p className="text-sm text-cx-muted mb-8">
        For renewal, extension, or additional student seats, contact the CensorX team.
      </p>

      <section>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="text-xl font-semibold">Subscription History</h2>
          <span className="text-sm text-cx-muted">
            Showing {visibleHistory.length} of {history.length} subscriptions
          </span>
        </div>
        <DataTable
          rows={visibleHistory}
          emptyMessage="No subscription history found."
          columns={[
            { header: "Plan Duration", render: (row) => formatPlan(row.planDuration) },
            { header: "Seat Limit", render: (row) => row.seatLimit },
            { header: "Start", render: (row) => formatDate(row.startAt) },
            { header: "Expiry", render: (row) => formatDate(row.expiresAt) },
            { header: "Status", render: (row) => <StatusBadge status={row.status} /> },
          ]}
        />
        <Pagination page={historyPage} totalPages={historyTotalPages} onPage={setHistoryPage} />
      </section>
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

function formatPlan(value: string | null) {
  if (!value) return "-";
  return value.replace(/_/g, " ");
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "-";
}
