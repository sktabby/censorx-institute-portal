import { useEffect, useState } from "react";
import PortalLayout from "../../layouts/PortalLayout";
import StatusBadge from "../../components/StatusBadge";
import { apiClient, type ApiResponse, type PagedResult } from "../../api/client";
import { adminNavItems } from "./navItems";
import {
  calculatePlanExpiryDate,
  formatDateInput,
  isPlanDuration,
  planOptions,
  type PlanDuration,
} from "../../utils/planDuration";

interface OrgOption {
  organizationId: string;
  name: string;
}

interface Subscription {
  planDuration: string;
  status: string;
  startAt: { _seconds?: number } | string | null;
  expiresAt: { _seconds?: number } | string | null;
  seatLimit: number;
}

interface OrgDetail extends OrgOption {
  purchasedSeats: number;
  activatedSeats: number;
  currentSubscription: Subscription | null;
}

export default function RenewSchool() {
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [planDuration, setPlanDuration] = useState<PlanDuration>("YEARLY");
  const [startAt, setStartAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [seatLimit, setSeatLimit] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiClient.get<ApiResponse<PagedResult<OrgOption>>>("/admin/organizations?pageSize=100").then((res) => {
      if (res.data.success) setOrgs(res.data.data.items);
    });
  }, []);

  useEffect(() => {
    if (!selectedOrg) {
      setDetail(null);
      setPlanDuration("YEARLY");
      setStartAt("");
      setExpiresAt("");
      setSeatLimit(0);
      return;
    }
    const nextStartAt = formatDateInput();
    setDetail(null);
    setPlanDuration("YEARLY");
    setStartAt(nextStartAt);
    setExpiresAt(calculatePlanExpiryDate(nextStartAt, "YEARLY"));
    setSeatLimit(0);
    refreshDetail(selectedOrg);
  }, [selectedOrg]);

  useEffect(() => {
    if (planDuration !== "CUSTOM" && startAt) {
      setExpiresAt(calculatePlanExpiryDate(startAt, planDuration));
    }
  }, [planDuration, startAt]);

  async function refreshDetail(organizationId = selectedOrg) {
    const res = await apiClient.get<ApiResponse<OrgDetail>>(`/admin/organizations/${organizationId}`);
    if (res.data.success) {
      const nextDetail = res.data.data;
      setDetail(nextDetail);
      applyRenewDefaults(nextDetail);
    }
  }

  function applyRenewDefaults(nextDetail: OrgDetail) {
    const current = nextDetail.currentSubscription;
    const nextPlan = isPlanDuration(current?.planDuration) ? current.planDuration : "YEARLY";
    const nextStartAt = formatDateInput();

    setPlanDuration(nextPlan);
    setSeatLimit(current?.seatLimit ?? nextDetail.purchasedSeats ?? 0);
    setStartAt(nextStartAt);
    setExpiresAt(nextPlan === "CUSTOM" ? "" : calculatePlanExpiryDate(nextStartAt, nextPlan));
  }

  function changePlanDuration(nextPlan: PlanDuration) {
    setPlanDuration(nextPlan);
    setExpiresAt(nextPlan === "CUSTOM" ? "" : calculatePlanExpiryDate(startAt || formatDateInput(), nextPlan));
  }

  async function cancelPlan() {
    if (!selectedOrg) return;
    if (!window.confirm("Cancel the current subscription for this school?")) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiClient.post(`/admin/organizations/${selectedOrg}/cancel`);
      setMessage("Subscription cancelled.");
      await refreshDetail();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? "Failed to cancel subscription.");
    } finally {
      setBusy(false);
    }
  }

  async function renewPlan() {
    if (!selectedOrg) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiClient.post(`/admin/organizations/${selectedOrg}/renew`, {
        planDuration,
        startAt: new Date(startAt).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        seatLimit: seatLimit || undefined,
      });
      setMessage("Subscription renewed successfully");
      await refreshDetail();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? "Failed to renew subscription.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalLayout items={adminNavItems}>
      <h1 className="text-2xl font-semibold mb-6">Renew School</h1>

      <div className="glass-card p-6 max-w-2xl space-y-4 mb-8">
        <div>
          <label className="text-sm text-cx-muted">School</label>
          <select
            value={selectedOrg}
            onChange={(e) => setSelectedOrg(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
          >
            <option value="" className="bg-cx-panel">Select a school</option>
            {orgs.map((org) => (
              <option key={org.organizationId} value={org.organizationId} className="bg-cx-panel">{org.name}</option>
            ))}
          </select>
        </div>

        {detail?.currentSubscription && (
          <div className="grid sm:grid-cols-4 gap-3 text-sm">
            <PlanField label="Plan" value={detail.currentSubscription.planDuration} />
            <div>
              <div className="text-xs text-cx-muted mb-1">Status</div>
              <StatusBadge status={detail.currentSubscription.status} />
            </div>
            <PlanField label="Seats" value={String(detail.currentSubscription.seatLimit)} />
            <PlanField label="Expires" value={formatAnyDate(detail.currentSubscription.expiresAt)} />
          </div>
        )}

        <button
          onClick={cancelPlan}
          disabled={!selectedOrg || busy || !detail?.currentSubscription}
          className="px-4 py-2 rounded-lg border border-red-400/50 text-red-300 text-sm disabled:opacity-40"
        >
          Cancel Plan
        </button>
      </div>

      <div className="glass-card p-6 max-w-2xl space-y-4">
        <h2 className="text-lg font-medium">Renew Plan</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-cx-muted">Plan duration</label>
            <select
              value={planDuration}
              onChange={(e) => changePlanDuration(e.target.value as PlanDuration)}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
            >
              {planOptions.map((plan) => (
                <option key={plan} value={plan} className="bg-cx-panel">{plan}</option>
              ))}
            </select>
          </div>
          <NumberField label="Seat limit" value={seatLimit} onChange={setSeatLimit} />
          <TextField label="Start date" type="date" value={startAt} onChange={setStartAt} />
          <TextField label="Expiry date" type="date" value={expiresAt} onChange={setExpiresAt} />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {message && <p className="text-sm text-cx-accent2">{message}</p>}

        <button
          onClick={renewPlan}
          disabled={!selectedOrg || busy || !startAt || !expiresAt}
          className="px-5 py-2.5 rounded-lg bg-cx-accent text-cx-bg font-medium disabled:opacity-50"
        >
          {busy ? "Submitting..." : "Renew Plan"}
        </button>
      </div>
    </PortalLayout>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="text-sm text-cx-muted">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label className="text-sm text-cx-muted">{label}</label>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
      />
    </div>
  );
}

function PlanField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-cx-muted mb-1">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function formatAnyDate(value: Subscription["expiresAt"]) {
  if (!value) return "-";
  if (typeof value === "string") return new Date(value).toLocaleDateString();
  if (value._seconds) return new Date(value._seconds * 1000).toLocaleDateString();
  return "-";
}
