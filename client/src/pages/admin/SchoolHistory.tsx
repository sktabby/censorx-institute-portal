import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PortalLayout from "../../layouts/PortalLayout";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import DataTable from "../../components/DataTable";
import { MobileField, MobileFields } from "../../components/MobileCard";
import { apiClient, type ApiResponse } from "../../api/client";
import { adminNavItems } from "./navItems";

interface OrgSummary {
  organizationId: string;
  name: string;
  identifier: string;
}

/** Mirrors SubscriptionHistoryRow in server/src/services/batchService.ts. */
interface SubscriptionHistoryRow {
  subscriptionId: string;
  planDuration: string;
  seatLimit: number;
  status: string;
  storedStatus: string;
  startAt: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  renewedFromSubscriptionId: string | null;
  sequence: number;
  isCurrent: boolean;
  licenseCount: number;
  activeLicenseCount: number;
  batchLabel?: string;
  billNumber?: string | null;
}

export default function SchoolHistory() {
  const { organizationId } = useParams();
  const [org, setOrg] = useState<OrgSummary | null>(null);
  const [history, setHistory] = useState<SubscriptionHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const [orgRes, historyRes] = await Promise.all([
          apiClient.get<ApiResponse<OrgSummary>>(`/admin/organizations/${organizationId}`),
          apiClient.get<ApiResponse<SubscriptionHistoryRow[]>>(
            `/admin/organizations/${organizationId}/subscriptions`
          ),
        ]);
        if (cancelled) return;
        if (orgRes.data.success) setOrg(orgRes.data.data);
        if (historyRes.data.success) setHistory(historyRes.data.data);
      } catch {
        if (!cancelled) setError("Could not load subscription history.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  return (
    <PortalLayout items={adminNavItems}>
      <PageHeader
        title={org ? `${org.name} — history` : "Subscription History"}
        action={
          <Link to={`/admin/schools/${organizationId}`} className="cx-btn-secondary">
            Back to school
          </Link>
        }
      />

      {error && <p role="alert" className="cx-alert-error mb-4">{error}</p>}

      {loading ? (
        <div role="status" className="text-cx-muted">Loading history...</div>
      ) : (
        <>
          <p className="mb-3 text-xs text-cx-muted">
            Every period of every batch this school has had, oldest first. Each renewal adds a new period to its batch. Read-only.
          </p>
          {/* Grows up to a fixed height, then scrolls inside. */}
          <div className="cx-scroll">
            <DataTable
              rows={history}
              columns={[
                {
                  header: "#",
                  render: (row) => (
                    <span className="text-xs">
                      {row.sequence}
                      {row.isCurrent && <span className="ml-2 font-medium text-cx-accent">live</span>}
                    </span>
                  ),
                },
                { header: "Batch", render: (row) => row.batchLabel ?? "Batch 1" },
                { header: "Plan", render: (row) => row.planDuration },
                { header: "Bill", render: (row) => <span className="text-xs">{row.billNumber ?? "-"}</span> },
                { header: "Seats", render: (row) => row.seatLimit },
                {
                  header: "Licences",
                  render: (row) => (
                    <span className="text-xs">
                      {row.activeLicenseCount} active / {row.licenseCount}
                    </span>
                  ),
                },
                { header: "Start", render: (row) => formatDate(row.startAt) },
                { header: "Expiry", render: (row) => formatDate(row.expiresAt) },
                { header: "Status", render: (row) => <StatusBadge status={row.status} /> },
                {
                  header: "Renewed from",
                  render: (row) =>
                    row.renewedFromSubscriptionId ? (
                      <span className="text-xs font-mono">{row.renewedFromSubscriptionId}</span>
                    ) : (
                      <span className="text-xs text-cx-muted">initial</span>
                    ),
                },
              ]}
              emptyMessage="This school has no subscription history yet."
              mobileCard={(row) => (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words font-semibold text-cx-heading">
                        {row.batchLabel ?? "Batch 1"} · {row.planDuration.replace(/_/g, " ")}
                      </p>
                      <p className="text-xs text-cx-muted">
                        #{row.sequence}
                        {row.isCurrent && <span className="ml-2 font-medium text-cx-accent">live</span>}
                        {row.billNumber && <span className="ml-2">Bill {row.billNumber}</span>}
                      </p>
                    </div>
                    <StatusBadge status={row.status} />
                  </div>
                  <MobileFields>
                    <MobileField label="Seats">{row.seatLimit}</MobileField>
                    <MobileField label="Licences">
                      {row.activeLicenseCount} active / {row.licenseCount}
                    </MobileField>
                    <MobileField label="Start">{formatDate(row.startAt)}</MobileField>
                    <MobileField label="End">{formatDate(row.expiresAt)}</MobileField>
                    <MobileField label="Renewed from" wide>
                      {row.renewedFromSubscriptionId ? (
                        <span className="[overflow-wrap:anywhere] font-mono text-xs">{row.renewedFromSubscriptionId}</span>
                      ) : (
                        <span className="text-cx-muted">initial</span>
                      )}
                    </MobileField>
                  </MobileFields>
                </>
              )}
            />
          </div>
        </>
      )}
    </PortalLayout>
  );
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString();
}
