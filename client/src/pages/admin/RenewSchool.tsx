import { useEffect, useMemo, useState } from "react";
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
  subscriptionId: string;
  planDuration: string;
  status: string;
  startAt: { _seconds?: number } | string | null;
  expiresAt: { _seconds?: number } | string | null;
  seatLimit: number;
}

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

interface OrgDetail extends OrgOption {
  seatUsage: SeatUsage;
  currentSubscription: Subscription | null;
}

/** Mirrors OrganizationBatchSummary in server/src/services/batchService.ts. */
interface BatchSummary {
  batchName: string;
  subscriptionId: string;
  codeCount: number;
  unusedCount: number;
  redeemedCount: number;
  expiredCount: number;
  revokedCount: number;
  replacedCount: number;
  deletedCount: number;
  renewableCount: number;
  status: "PENDING" | "ACTIVE" | "PARTIALLY_EXPIRED" | "EXPIRED" | "RETIRED";
  createdAt: string | null;
  expiresAt: string | null;
  seatCount: number;
  isPending: boolean;
  startAt: string | null;
  pendingSeats: number;
  windowUpdatedAt: string | null;
}

interface RenewBatchesResponse {
  subscriptionId: string;
  renewedBatches: string[];
  licensesRestored: number;
  codesRestored: number;
  studentsReactivated: number;
  renewalEmail?: { sent: boolean; to: string; warning?: string };
  allocatedBatch: { batchId: string; batchName: string; seatCount: number } | null;
  repointedBatches: string[];
  seatLimit: number;
}

type BatchFilter = "RENEWABLE" | "NON_RENEWABLE" | "ALL";

const BATCH_FILTERS: Array<{ value: BatchFilter; label: string }> = [
  { value: "RENEWABLE", label: "Renewable" },
  { value: "NON_RENEWABLE", label: "Non-renewable" },
  { value: "ALL", label: "All" },
];

/**
 * Renewable = has codes that can still have their expiry extended.
 * RETIRED (every code revoked/replaced/deleted) and PENDING (no codes yet)
 * both have nothing to extend, so neither is renewable.
 */
function isRenewable(batch: BatchSummary) {
  return batch.renewableCount > 0;
}

export default function RenewSchool() {
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [selectedBatches, setSelectedBatches] = useState<string[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);

  const [planDuration, setPlanDuration] = useState<PlanDuration>("YEARLY");
  const [startAt, setStartAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const [batchSearch, setBatchSearch] = useState("");
  const [batchFilter, setBatchFilter] = useState<BatchFilter>("RENEWABLE");

  const [allocateNewBatch, setAllocateNewBatch] = useState(false);
  const [newBatchName, setNewBatchName] = useState("");
  const [newBatchSeats, setNewBatchSeats] = useState(10);

  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiClient.get<ApiResponse<PagedResult<OrgOption>>>("/admin/organizations?pageSize=100").then((res) => {
      if (res.data.success) setOrgs(res.data.data.items);
    });
  }, []);

  useEffect(() => {
    resetForm();
    if (selectedOrg) void refreshSchool(selectedOrg);
  }, [selectedOrg]);

  useEffect(() => {
    if (planDuration !== "CUSTOM" && startAt) {
      setExpiresAt(calculatePlanExpiryDate(startAt, planDuration));
    }
  }, [planDuration, startAt]);

  // What the current search + filter actually shows. "Select all renewable"
  // operates on this, never on the full underlying list.
  const visibleBatches = useMemo(() => {
    const needle = batchSearch.trim().toLowerCase();
    return batches.filter((batch) => {
      const matchesSearch = !needle || batch.batchName.toLowerCase().includes(needle);
      const matchesFilter =
        batchFilter === "ALL" ||
        (batchFilter === "RENEWABLE" ? isRenewable(batch) : !isRenewable(batch));
      return matchesSearch && matchesFilter;
    });
  }, [batches, batchSearch, batchFilter]);

  const visibleRenewable = visibleBatches.filter(isRenewable);
  const selectedSeatCount = batches
    .filter((batch) => selectedBatches.includes(batch.batchName))
    .reduce((sum, batch) => sum + batch.renewableCount, 0);
  // Seats still held by live batches that this renewal is not touching.
  const retainedSeats = batches
    .filter((batch) => !selectedBatches.includes(batch.batchName) && !batch.isPending)
    .reduce((sum, batch) => sum + batch.unusedCount + batch.redeemedCount, 0);
  const projectedSeats = selectedSeatCount + retainedSeats + (allocateNewBatch ? newBatchSeats : 0);
  const trimmedBatchName = newBatchName.trim();
  const canSubmit =
    (selectedBatches.length > 0 || allocateNewBatch) && (!allocateNewBatch || trimmedBatchName.length > 0);

  function resetForm() {
    setDetail(null);
    setBatches([]);
    setSelectedBatches([]);
    setBatchSearch("");
    setBatchFilter("RENEWABLE");
    setAllocateNewBatch(false);
    setNewBatchName("");
    setNewBatchSeats(10);
    setMessage(null);
    setWarning(null);
    setError(null);

    const nextStartAt = formatDateInput();
    setPlanDuration("YEARLY");
    setStartAt(nextStartAt);
    setExpiresAt(calculatePlanExpiryDate(nextStartAt, "YEARLY"));
  }

  async function refreshSchool(organizationId = selectedOrg) {
    setLoadingBatches(true);
    try {
      const [detailRes, batchRes] = await Promise.all([
        apiClient.get<ApiResponse<OrgDetail>>(`/admin/organizations/${organizationId}`),
        apiClient.get<ApiResponse<BatchSummary[]>>(`/admin/organizations/${organizationId}/batches`),
      ]);

      if (detailRes.data.success) {
        const nextDetail = detailRes.data.data;
        setDetail(nextDetail);
        const currentPlan = nextDetail.currentSubscription?.planDuration;
        if (isPlanDuration(currentPlan)) setPlanDuration(currentPlan);
      }

      if (batchRes.data.success) {
        const nextBatches = batchRes.data.data;
        setBatches(nextBatches);
        // Pre-select the batches that have actually lapsed — the common case.
        setSelectedBatches(
          nextBatches
            .filter((batch) => isRenewable(batch) && batch.status !== "ACTIVE")
            .map((batch) => batch.batchName)
        );
      }
    } catch {
      setError("Could not load this school's code sheets.");
    } finally {
      setLoadingBatches(false);
    }
  }

  function toggleBatch(batchName: string) {
    setSelectedBatches((current) =>
      current.includes(batchName) ? current.filter((name) => name !== batchName) : [...current, batchName]
    );
  }

  /** Adds only what the current search + filter shows, preserving hidden picks. */
  function selectAllVisibleRenewable() {
    setSelectedBatches((current) => {
      const next = new Set(current);
      visibleRenewable.forEach((batch) => next.add(batch.batchName));
      return Array.from(next);
    });
  }

  function clearVisibleSelection() {
    setSelectedBatches((current) => {
      const visibleNames = new Set(visibleRenewable.map((batch) => batch.batchName));
      return current.filter((name) => !visibleNames.has(name));
    });
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
      await refreshSchool();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? "Failed to cancel subscription.");
    } finally {
      setBusy(false);
    }
  }

  async function submitRenewal() {
    if (!selectedOrg) return;
    setError(null);
    setMessage(null);
    setWarning(null);

    if (!canSubmit) {
      setError("Select at least one code sheet to renew, or allocate a new batch.");
      return;
    }
    if (!startAt || !expiresAt) {
      setError("Start and expiry dates are required.");
      return;
    }
    if (allocateNewBatch) {
      if (!trimmedBatchName) {
        setError("Enter a name for the new batch.");
        return;
      }
      if (batches.some((batch) => batch.batchName.toLowerCase() === trimmedBatchName.toLowerCase())) {
        setError(`A batch named "${trimmedBatchName}" already exists for this school.`);
        return;
      }
      if (newBatchSeats <= 0) {
        setError("Enter a positive number of seats for the new batch.");
        return;
      }
    }

    setBusy(true);
    try {
      const res = await apiClient.post<ApiResponse<RenewBatchesResponse>>(
        `/admin/organizations/${selectedOrg}/batches/renew`,
        {
          batchNames: selectedBatches,
          newBatch: allocateNewBatch ? { batchName: trimmedBatchName, seatCount: newBatchSeats } : undefined,
          planDuration,
          startAt: new Date(startAt).toISOString(),
          expiresAt: new Date(expiresAt).toISOString(),
          idempotencyKey: `${selectedOrg}-renew-${Date.now()}`,
        }
      );

      if (!res.data.success) {
        setError(res.data.error.message);
        return;
      }

      const result = res.data.data;
      const notes: string[] = [];
      const warnings: string[] = [];

      if (result.renewedBatches.length > 0) {
        notes.push(
          `Renewed ${result.renewedBatches.length} sheet(s) — ${result.licensesRestored} licence(s) extended, ` +
            `${result.studentsReactivated} student(s) reactivated. Existing codes stay valid.`
        );
        if (result.renewalEmail?.sent) notes.push(`Renewal notice emailed to ${result.renewalEmail.to}.`);
        else if (result.renewalEmail?.warning) warnings.push(result.renewalEmail.warning);
      }

      if (result.allocatedBatch) {
        notes.push(
          `Allocated ${result.allocatedBatch.seatCount} seat(s) in batch "${result.allocatedBatch.batchName}". ` +
            `No codes generated — generate them in Create Codes when ready.`
        );
      }

      // Never let a silent date change slip past: batches still awaiting code
      // generation were moved onto this renewal's window.
      if (result.repointedBatches.length > 0) {
        warnings.push(
          `Start/expiry dates updated on ${result.repointedBatches.length} batch(es) still awaiting code generation: ` +
            `${result.repointedBatches.join(", ")}. Their codes will now be issued under this renewal's window.`
        );
      }

      setMessage(notes.join(" "));
      if (warnings.length) setWarning(warnings.join(" "));
      setAllocateNewBatch(false);
      setNewBatchName("");
      await refreshSchool();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? "Failed to renew.");
    } finally {
      setBusy(false);
    }
  }

  // No CSV download here by design: Renew School never produces codes, so there
  // is nothing to export. Code CSVs come from Create Codes.

  return (
    <PortalLayout items={adminNavItems}>
      <h1 className="text-2xl font-semibold mb-6">Renew School</h1>

      <div className="glass-card p-6 max-w-4xl space-y-4 mb-6">
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
            <PlanField label="Seat limit" value={String(detail.seatUsage.seatLimit)} />
            <PlanField label="Expires" value={formatAnyDate(detail.currentSubscription.expiresAt)} />
          </div>
        )}

        {selectedOrg && (
          <button
            onClick={cancelPlan}
            disabled={busy || !detail?.currentSubscription}
            className="px-4 py-2 rounded-lg border border-red-400/50 text-red-300 text-sm disabled:opacity-40"
          >
            Cancel Plan
          </button>
        )}
      </div>

      {selectedOrg && (
        <>
          <div className="glass-card p-6 max-w-4xl space-y-4 mb-6">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-medium">Renew existing code sheets</h2>
              <span className="text-xs text-cx-muted">{selectedBatches.length} selected</span>
            </div>
            <p className="text-xs text-cx-muted">
              Selected sheets keep their existing activation codes — the expiry date is extended in place and no new
              codes are issued. Students who were locked out regain access.
            </p>

            <div className="grid sm:grid-cols-[1fr_auto] gap-3">
              <input
                value={batchSearch}
                onChange={(e) => setBatchSearch(e.target.value)}
                placeholder="Search by batch name"
                className="px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
              />
              <div className="flex gap-1 rounded-lg border border-cx-border p-1">
                {BATCH_FILTERS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setBatchFilter(option.value)}
                    className={`px-3 py-1.5 rounded-md text-xs whitespace-nowrap ${
                      batchFilter === option.value ? "bg-cx-accent text-cx-bg font-medium" : "text-cx-muted"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {visibleRenewable.length > 0 && (
              <div className="flex items-center gap-3 text-xs">
                <button onClick={selectAllVisibleRenewable} className="text-cx-accent hover:underline">
                  Select all renewable ({visibleRenewable.length} shown)
                </button>
                <button onClick={clearVisibleSelection} className="text-cx-muted hover:underline">
                  Clear shown
                </button>
              </div>
            )}

            {loadingBatches ? (
              <p className="text-sm text-cx-muted">Loading code sheets...</p>
            ) : batches.length === 0 ? (
              <p className="text-sm text-cx-muted">This school has no code sheets yet.</p>
            ) : visibleBatches.length === 0 ? (
              <p className="text-sm text-cx-muted">No batches match this search or filter.</p>
            ) : (
              // Fixed height with internal scrolling: schools accumulate many
              // batches and the list previously grew without bound.
              <div className="max-h-80 overflow-y-auto pr-1 space-y-2 rounded-lg border border-cx-border/50 p-2">
                {visibleBatches.map((batch) => {
                  const renewable = isRenewable(batch);
                  const checked = selectedBatches.includes(batch.batchName);
                  return (
                    <label
                      key={batch.batchName}
                      className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${
                        !renewable
                          ? "border-cx-border opacity-60 cursor-not-allowed"
                          : checked
                            ? "border-cx-accent/60 bg-cx-accent/5 cursor-pointer"
                            : "border-cx-border cursor-pointer hover:border-cx-accent/40"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!renewable}
                        onChange={() => toggleBatch(batch.batchName)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">{batch.batchName}</span>
                          <StatusBadge status={batch.status} />
                        </div>
                        {batch.isPending ? (
                          <div className="text-xs text-cx-muted mt-1">
                            {batch.seatCount} seat(s) allocated · codes not generated yet
                          </div>
                        ) : (
                          <div className="text-xs text-cx-muted mt-1">
                            {batch.codeCount} code(s) · {batch.redeemedCount} redeemed · {batch.unusedCount} unused ·{" "}
                            {batch.expiredCount} expired
                            {batch.revokedCount > 0 && ` · ${batch.revokedCount} revoked`}
                          </div>
                        )}
                        <div className="text-xs text-cx-muted">
                          Created {formatIsoDate(batch.createdAt)} · Expires {formatIsoDate(batch.expiresAt)}
                        </div>
                        {!renewable && (
                          <div className="text-xs text-cx-muted mt-1 italic">
                            {batch.isPending
                              ? "Nothing to extend yet — generate its codes in Create Codes."
                              : "All codes revoked, replaced or deleted — cannot be extended."}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="glass-card p-6 max-w-4xl space-y-4 mb-6">
            <label className="flex items-center gap-2 text-lg font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={allocateNewBatch}
                onChange={(e) => setAllocateNewBatch(e.target.checked)}
              />
              Also allocate a new batch (seats only)
            </label>
            <p className="text-xs text-cx-muted">
              Optional. Reserves named, sized seats under this renewal's plan window. No codes are generated and no
              email is sent — generate the codes from Create Codes when you're ready.
            </p>

            {allocateNewBatch && (
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <TextField label="Batch name (required)" value={newBatchName} onChange={setNewBatchName} />
                  {!trimmedBatchName && <p className="mt-1 text-xs text-amber-300">A batch name is required.</p>}
                </div>
                <NumberField label="Number of seats" value={newBatchSeats} onChange={setNewBatchSeats} />
              </div>
            )}
          </div>

          <div className="glass-card p-6 max-w-4xl space-y-4">
            <h2 className="text-lg font-medium">New plan window</h2>
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="text-sm text-cx-muted">Plan duration</label>
                <select
                  value={planDuration}
                  onChange={(e) => setPlanDuration(e.target.value as PlanDuration)}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
                >
                  {planOptions.map((plan) => (
                    <option key={plan} value={plan} className="bg-cx-panel">{plan}</option>
                  ))}
                </select>
              </div>
              <TextField label="Start date" type="date" value={startAt} onChange={setStartAt} />
              <TextField label="Expiry date" type="date" value={expiresAt} onChange={setExpiresAt} />
            </div>

            <p className="text-sm text-cx-muted">
              Renewing <span className="text-cx-accent2 font-medium">{selectedBatches.length}</span> sheet(s)
              {allocateNewBatch && (
                <>
                  {" "}
                  plus allocating <span className="text-cx-accent2 font-medium">{newBatchSeats}</span> new seat(s) in
                  batch <span className="text-cx-accent2 font-medium">"{trimmedBatchName || "…"}"</span>
                </>
              )}{" "}
              — new seat limit will be <span className="text-cx-accent2 font-medium">{projectedSeats}</span>.
              {allocateNewBatch && trimmedBatchName && (
                <> Generate codes for "{trimmedBatchName}" in Create Codes when ready.</>
              )}
            </p>

            {error && <p className="text-sm text-red-400">{error}</p>}
            {message && <p className="text-sm text-cx-accent2">{message}</p>}
            {warning && <p className="text-sm text-amber-300">{warning}</p>}

            <button
              onClick={submitRenewal}
              disabled={busy || !canSubmit}
              className="px-5 py-2.5 rounded-lg bg-cx-accent text-cx-bg font-medium disabled:opacity-50"
            >
              {busy ? "Submitting..." : "Renew"}
            </button>
          </div>
        </>
      )}

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

function formatIsoDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString();
}

function formatAnyDate(value: Subscription["expiresAt"]) {
  if (!value) return "-";
  if (typeof value === "string") return new Date(value).toLocaleDateString();
  if (value._seconds) return new Date(value._seconds * 1000).toLocaleDateString();
  return "-";
}
