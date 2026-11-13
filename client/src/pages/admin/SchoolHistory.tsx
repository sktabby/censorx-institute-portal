import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PortalLayout from "../../layouts/PortalLayout";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import DataTable from "../../components/DataTable";
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
        title="Subscription History"
        description={
          org ? (
            <>
              {org.name} · {org.identifier} ·{" "}
              <Link to={`/admin/schools/${organizationId}`} className="cx-link">
                Back to school
              </Link>
            </>
          ) : undefined
        }
      />

      {error && <p role="alert" className="cx-alert-error mb-4">{error}</p>}

      {loading ? (
        <div role="status" className="text-cx-muted">Loading history...</div>
      ) : (
        <>
          <p className="mb-3 text-xs text-cx-muted">
            Every subscription period this school has had, oldest first, following the renewal chain. Read-only.
          </p>
          <DataTable
            rows={history}
            columns={[
              {
                header: "#",
                render: (row) => (
                  <span className="text-xs">
                    {row.sequence}
                    {row.isCurrent && <span className="ml-2 font-medium text-cx-accent">current</span>}
                  </span>
                ),
              },
              { header: "Plan", render: (row) => row.planDuration },
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
          />
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
