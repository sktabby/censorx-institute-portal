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

interface OrgOption { organizationId: string; name: string; }

interface Subscription {
  planDuration: string;
  status: string;
  expiresAt: { _seconds?: number } | string | null;
  seatLimit: number;
}

interface OrgDetail extends OrgOption {
  purchasedSeats: number;
  currentSubscription: Subscription | null;
}

export default function SubscriptionsManagement() {
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [mode, setMode] = useState<"RENEW" | "EXTEND" | "SEATS">("RENEW");
  const [planDuration, setPlanDuration] = useState<PlanDuration>("YEARLY");
  const [startAt, setStartAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [seatLimit, setSeatLimit] = useState(0);
  const [additionalSeats, setAdditionalSeats] = useState(0);
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

  async function submit() {
    if (!selectedOrg) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "RENEW") {
        await apiClient.post(`/admin/organizations/${selectedOrg}/renew`, {
          planDuration,
          startAt: new Date(startAt).toISOString(),
          expiresAt: new Date(expiresAt).toISOString(),
          seatLimit: seatLimit || undefined,
        });
        setMessage("Subscription renewed.");
      } else if (mode === "EXTEND") {
        await apiClient.post(`/admin/organizations/${selectedOrg}/extend`, {
          newExpiresAt: new Date(expiresAt).toISOString(),
        });
        setMessage("Subscription extended.");
      } else {
        await apiClient.post(`/admin/organizations/${selectedOrg}/seats/increase`, { additionalSeats });
        setMessage("Seats increased.");
      }
      await refreshDetail();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalLayout items={adminNavItems}>
      <h1 className="text-2xl font-semibold mb-6">Subscriptions</h1>

      <div className="glass-card p-6 max-w-xl space-y-4">
        <div>
          <label className="text-sm text-cx-muted">School</label>
          <select
            className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
            value={selectedOrg}
            onChange={(e) => setSelectedOrg(e.target.value)}
          >
            <option value="" className="bg-cx-panel">Select a school</option>
            {orgs.map((o) => (
              <option key={o.organizationId} value={o.organizationId} className="bg-cx-panel">{o.name}</option>
            ))}
          </select>
        </div>

        {detail?.currentSubscription && (
          <div className="grid sm:grid-cols-3 gap-3 text-sm">
            <PlanField label="Plan" value={detail.currentSubscription.planDuration} />
            <div>
              <div className="text-xs text-cx-muted mb-1">Status</div>
              <StatusBadge status={detail.currentSubscription.status} />
            </div>
            <PlanField label="Expires" value={formatAnyDate(detail.currentSubscription.expiresAt)} />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {(["RENEW", "EXTEND", "SEATS"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-lg text-sm border ${mode === m ? "border-cx-accent text-cx-accent" : "border-cx-border text-cx-muted"}`}
            >
              {m === "RENEW" ? "Renew" : m === "EXTEND" ? "Extend" : "Increase Seats"}
            </button>
          ))}
        </div>

        {mode === "RENEW" && (
          <>
            <div>
              <label className="text-sm text-cx-muted">Plan duration</label>
              <select
                className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
                value={planDuration}
                onChange={(e) => changePlanDuration(e.target.value as PlanDuration)}
              >
                {planOptions.map((p) => (
                  <option key={p} value={p} className="bg-cx-panel">{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm text-cx-muted">Seat limit</label>
              <input type="number" min={1} value={seatLimit} onChange={(e) => setSeatLimit(Number(e.target.value))} className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm" />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-cx-muted">Start date</label>
                <input type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm" />
              </div>
              <div>
                <label className="text-sm text-cx-muted">Expiry date</label>
                <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm" />
              </div>
            </div>
          </>
        )}

        {mode === "EXTEND" && (
          <div>
            <label className="text-sm text-cx-muted">New expiry date</label>
            <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm" />
          </div>
        )}

        {mode === "SEATS" && (
          <div>
            <label className="text-sm text-cx-muted">Additional seats</label>
            <input type="number" value={additionalSeats} onChange={(e) => setAdditionalSeats(Number(e.target.value))} className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm" />
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}
        {message && <p className="text-sm text-cx-accent2">{message}</p>}

        <button onClick={submit} disabled={busy || !selectedOrg} className="px-5 py-2.5 rounded-lg bg-cx-accent text-cx-bg font-medium disabled:opacity-50">
          {busy ? "Submitting..." : "Submit"}
        </button>
      </div>
    </PortalLayout>
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
