import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { HelpCircle, Plus, X } from "lucide-react";
import PortalLayout from "../../layouts/PortalLayout";
import PageHeader from "../../components/PageHeader";
import Step from "../../components/Step";
import Select from "../../components/Select";
import SearchBox from "../../components/SearchBox";
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
  /** Every class added by this renewal. Older servers only send `allocatedBatch`. */
  allocatedBatches?: Array<{ batchId: string; batchName: string; seatCount: number }>;
  repointedBatches: string[];
  seatLimit: number;
}

/** One row of the "Add a new class" list. */
interface NewClass {
  id: number;
  name: string;
  seats: number;
}

const FIRST_CLASS: NewClass = { id: 1, name: "", seats: 10 };
const MAX_NEW_CLASSES = 50;

type BatchFilter = "RENEWABLE" | "NON_RENEWABLE" | "ALL";

const BATCH_FILTERS: Array<{ value: BatchFilter; label: string }> = [
  { value: "RENEWABLE", label: "Renewable" },
  { value: "NON_RENEWABLE", label: "Not renewable" },
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
  const [newClasses, setNewClasses] = useState<NewClass[]>([FIRST_CLASS]);
  const nextClassId = useRef(2);

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
  // Classes still waiting for their codes keep their seats.
  const waitingSeats = batches
    .filter((batch) => batch.isPending && !selectedBatches.includes(batch.batchName))
    .reduce((sum, batch) => sum + batch.pendingSeats, 0);
  const newSeatTotal = allocateNewBatch ? newClasses.reduce((sum, item) => sum + (Number(item.seats) || 0), 0) : 0;
  const projectedSeats = selectedSeatCount + retainedSeats + waitingSeats + newSeatTotal;
  const newClassNames = newClasses.map((item) => item.name.trim()).filter(Boolean);
  const canSubmit =
    (selectedBatches.length > 0 || allocateNewBatch) &&
    (!allocateNewBatch || newClasses.every((item) => item.name.trim().length > 0));

  function resetForm() {
    setDetail(null);
    setBatches([]);
    setSelectedBatches([]);
    setBatchSearch("");
    setBatchFilter("RENEWABLE");
    setAllocateNewBatch(false);
    setNewClasses([FIRST_CLASS]);
    nextClassId.current = 2;
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

  function addClass() {
    setNewClasses((current) =>
      current.length >= MAX_NEW_CLASSES ? current : [...current, { id: nextClassId.current++, name: "", seats: 10 }]
    );
  }

  function removeClass(id: number) {
    setNewClasses((current) => (current.length > 1 ? current.filter((item) => item.id !== id) : current));
  }

  function updateClass(id: number, patch: Partial<Omit<NewClass, "id">>) {
    setNewClasses((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function cancelPlan() {
    if (!selectedOrg) return;
    if (!window.confirm("Cancel this school's plan?")) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiClient.post(`/admin/organizations/${selectedOrg}/cancel`);
      setMessage("Plan cancelled.");
      await refreshSchool();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? "Failed to cancel the plan.");
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
      setError("Select at least one sheet to renew, or add a new class.");
      return;
    }
    if (!startAt || !expiresAt) {
      setError("Start and end dates are required.");
      return;
    }
    if (allocateNewBatch) {
      const seen = new Set<string>();
      for (const item of newClasses) {
        const name = item.name.trim();
        if (!name) {
          setError("Enter a name for every new class.");
          return;
        }
        if (batches.some((batch) => batch.batchName.toLowerCase() === name.toLowerCase())) {
          setError(`A sheet named "${name}" already exists for this school.`);
          return;
        }
        if (seen.has(name.toLowerCase())) {
          setError(`"${name}" is used more than once. Each class needs its own name.`);
          return;
        }
        seen.add(name.toLowerCase());
        if (!Number.isInteger(item.seats) || item.seats <= 0) {
          setError(`Enter a whole number of seats above 0 for "${name}".`);
          return;
        }
      }
    }

    setBusy(true);
    try {
      const res = await apiClient.post<ApiResponse<RenewBatchesResponse>>(
        `/admin/organizations/${selectedOrg}/batches/renew`,
        {
          batchNames: selectedBatches,
          newBatches: allocateNewBatch
            ? newClasses.map((item) => ({ batchName: item.name.trim(), seatCount: item.seats }))
            : undefined,
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
          `Renewed ${result.renewedBatches.length} sheet(s). ${result.licensesRestored} code(s) were extended and ` +
            `${result.studentsReactivated} student(s) can use the app again. The same codes still work.`
        );
        if (result.renewalEmail?.sent) notes.push(`A renewal notice was emailed to ${result.renewalEmail.to}.`);
        else if (result.renewalEmail?.warning) warnings.push(result.renewalEmail.warning);
      }

      const added = result.allocatedBatches ?? (result.allocatedBatch ? [result.allocatedBatch] : []);
      if (added.length === 1) {
        notes.push(
          `Added ${added[0].seatCount} seat(s) as "${added[0].batchName}". Next, make its codes in Create Codes.`
        );
      } else if (added.length > 1) {
        notes.push(
          `Added ${added.length} classes (${added.reduce((sum, item) => sum + item.seatCount, 0)} seats): ` +
            `${added.map((item) => item.batchName).join(", ")}. Next, make the codes for each class in Create Codes.`
        );
      }

      // Never let a silent date change slip past: batches still awaiting code
      // generation were moved onto this renewal's window.
      if (result.repointedBatches.length > 0) {
        warnings.push(
          `The dates changed on ${result.repointedBatches.length} sheet(s) that were waiting for codes: ` +
            `${result.repointedBatches.join(", ")}. Their codes will use these new dates.`
        );
      }

      setMessage(notes.join(" "));
      if (warnings.length) setWarning(warnings.join(" "));
      setAllocateNewBatch(false);
      setNewClasses([FIRST_CLASS]);
      nextClassId.current = 2;
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
      <PageHeader
        title="Renew School"
        description="Renew class sheets, or add seats for a new class."
        action={
          <Link to="/admin/guide" className="cx-link inline-flex min-h-11 items-center gap-1.5 text-sm">
            <HelpCircle size={16} aria-hidden="true" />
            How it works
          </Link>
        }
      />

      <div className="mx-auto w-full max-w-3xl space-y-4">
        {/* Step 1: school */}
        <Step number={1} title="Choose the school" hint="Pick the school you want to renew or add seats for.">
          <label htmlFor="renew-school" className="sr-only">
            School
          </label>
          <Select
            id="renew-school"
            value={selectedOrg}
            onChange={(e) => setSelectedOrg(e.target.value)}
            className="cx-input w-full"
          >
            <option value="">Select a school</option>
            {orgs.map((org) => (
              <option key={org.organizationId} value={org.organizationId}>{org.name}</option>
            ))}
          </Select>

          {selectedOrg && detail?.currentSubscription && (
            <div className="mt-4 grid grid-cols-2 gap-4 rounded-xl border border-cx-border bg-cx-tint/50 p-4 sm:grid-cols-4">
              <PlanField label="Plan" value={detail.currentSubscription.planDuration.replace(/_/g, " ")} />
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-cx-muted">Status</div>
                <div className="mt-1">
                  <StatusBadge status={detail.currentSubscription.status} />
                </div>
              </div>
              <PlanField label="Total seats" value={String(detail.seatUsage.seatLimit)} />
              <PlanField label="Ends" value={formatAnyDate(detail.currentSubscription.expiresAt)} />
            </div>
          )}

          {selectedOrg && detail && !detail.currentSubscription && (
            <p className="mt-4 rounded-xl border border-cx-accent/20 bg-cx-tint px-3.5 py-2.5 text-sm text-cx-text">
              This school has no plan yet. Add a new class below to start one.
            </p>
          )}
        </Step>

        {selectedOrg && (
          <>
            {/* Step 2: what to do */}
            <Step number={2} title="What do you want to do?" hint="You can renew sheets, add a new class, or do both.">
              {/* A: renew existing sheets */}
              <div className="space-y-4">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-cx-heading">Renew existing class sheets</h3>
                    <span className="text-xs text-cx-muted">{selectedBatches.length} selected</span>
                  </div>
                  <p className="mt-0.5 text-sm text-cx-muted">
                    Use this when the plan has ended. The same codes keep working and students get access back.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <SearchBox>
                    <input
                      aria-label="Search by sheet name"
                      value={batchSearch}
                      onChange={(e) => setBatchSearch(e.target.value)}
                      placeholder="Search by sheet name"
                      className="cx-input w-full pl-10"
                    />
                  </SearchBox>
                  <div className="flex gap-1 overflow-x-auto rounded-full border border-cx-border bg-white p-1">
                    {BATCH_FILTERS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setBatchFilter(option.value)}
                        className={`min-h-11 flex-1 rounded-full px-3 py-1.5 text-xs whitespace-nowrap transition-colors sm:flex-none ${
                          batchFilter === option.value
                            ? "bg-cx-accent text-white font-medium"
                            : "text-cx-muted hover:bg-cx-surface hover:text-cx-text"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {visibleRenewable.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <button onClick={selectAllVisibleRenewable} className="cx-link rounded-lg px-1">
                      Select all renewable ({visibleRenewable.length} shown)
                    </button>
                    <button
                      onClick={clearVisibleSelection}
                      className="rounded-lg px-1 text-cx-muted hover:text-cx-text hover:underline"
                    >
                      Clear shown
                    </button>
                  </div>
                )}

                {loadingBatches ? (
                  <p role="status" className="text-sm text-cx-muted">Loading code sheets...</p>
                ) : batches.length === 0 ? (
                  <p className="text-sm text-cx-muted">This school has no code sheets yet.</p>
                ) : visibleBatches.length === 0 ? (
                  <p className="text-sm text-cx-muted">No sheets match this search or filter.</p>
                ) : (
                  // Fixed height with internal scrolling: schools collect many sheets over time.
                  <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl border border-cx-border bg-cx-surface p-2">
                    {visibleBatches.map((batch) => {
                      const renewable = isRenewable(batch);
                      const checked = selectedBatches.includes(batch.batchName);
                      return (
                        <label
                          key={batch.batchName}
                          className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${
                            !renewable
                              ? "cursor-not-allowed border-cx-border bg-white opacity-60"
                              : checked
                                ? "cursor-pointer border-cx-accent bg-cx-tint"
                                : "cursor-pointer border-cx-border bg-white hover:border-cx-accent/50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!renewable}
                            onChange={() => toggleBatch(batch.batchName)}
                            className="mt-1"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate font-medium">{batch.batchName}</span>
                              <StatusBadge status={batch.status} />
                            </div>
                            <div className="mt-1 text-xs text-cx-muted">
                              {batch.isPending
                                ? `${batch.seatCount} seat(s) waiting for codes`
                                : `${batch.codeCount} code(s) · ${batch.redeemedCount} joined · ${batch.unusedCount} unused · ${batch.expiredCount} expired${
                                    batch.revokedCount > 0 ? ` · ${batch.revokedCount} revoked` : ""
                                  }`}
                            </div>
                            <div className="text-xs text-cx-muted">Ends {formatIsoDate(batch.expiresAt)}</div>
                            {!renewable && (
                              <div className="mt-1 text-xs italic text-cx-muted">
                                {batch.isPending
                                  ? "Nothing to renew yet. Make its codes in Create Codes."
                                  : "All codes were removed, so this sheet cannot be renewed."}
                              </div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* B: add a new class */}
              <div className="mt-6 space-y-4 border-t border-cx-line pt-6">
                <div>
                  <label className="flex cursor-pointer items-center gap-2 font-semibold text-cx-heading">
                    <input
                      type="checkbox"
                      checked={allocateNewBatch}
                      onChange={(e) => setAllocateNewBatch(e.target.checked)}
                    />
                    Add a new class or extra seats
                  </label>
                  <p className="mt-0.5 text-sm text-cx-muted sm:pl-6">
                    Use this for a new class or extra students. You will make its codes next in Create Codes.
                  </p>
                </div>

                {allocateNewBatch && (
                  <div className="space-y-3 sm:pl-6">
                    {newClasses.map((item, index) => (
                      <div key={item.id} className="rounded-xl border border-cx-border bg-cx-surface p-3.5">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wider text-cx-muted">
                            Class {index + 1}
                          </span>
                          {newClasses.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeClass(item.id)}
                              aria-label={`Remove class ${index + 1}`}
                              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-cx-muted transition-colors hover:bg-red-50 hover:text-red-700"
                            >
                              <X size={16} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
                          <TextField
                            label="Class name"
                            value={item.name}
                            onChange={(value) => updateClass(item.id, { name: value })}
                          />
                          <NumberField
                            label="Seats"
                            value={item.seats}
                            onChange={(value) => updateClass(item.id, { seats: value })}
                          />
                        </div>
                        {!item.name.trim() && (
                          <p className="mt-1.5 text-xs text-amber-700">Enter a class name, for example Class 5A.</p>
                        )}
                      </div>
                    ))}

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={addClass}
                        disabled={newClasses.length >= MAX_NEW_CLASSES}
                        className="cx-btn-secondary w-full sm:w-auto"
                      >
                        <Plus size={16} aria-hidden="true" />
                        Add another class
                      </button>
                      <span className="text-sm text-cx-muted">
                        {newClasses.length} class{newClasses.length === 1 ? "" : "es"} · {newSeatTotal} seats in total
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </Step>

            {/* Step 3: dates */}
            <Step
              number={3}
              title="Set the dates"
              hint="Use the same dates for every class so they all end together."
            >
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label htmlFor="renew-plan-duration" className="cx-label">Plan length</label>
                  <Select
                    id="renew-plan-duration"
                    value={planDuration}
                    onChange={(e) => setPlanDuration(e.target.value as PlanDuration)}
                    className="cx-input mt-1 w-full"
                  >
                    {planOptions.map((plan) => (
                      <option key={plan} value={plan}>{plan.replace(/_/g, " ")}</option>
                    ))}
                  </Select>
                </div>
                <TextField label="Start date" type="date" value={startAt} onChange={setStartAt} />
                <TextField label="End date" type="date" value={expiresAt} onChange={setExpiresAt} />
              </div>

              <p className="mt-4 rounded-xl border border-cx-border bg-cx-surface px-3.5 py-2.5 text-sm text-cx-text">
                Renewing <span className="font-semibold text-cx-accent">{selectedBatches.length}</span> sheet(s)
                {allocateNewBatch && (
                  <>
                    {" "}
                    and adding <span className="font-semibold text-cx-accent">{newSeatTotal}</span> seat(s) in{" "}
                    <span className="font-semibold text-cx-accent">{newClasses.length}</span> new class
                    {newClasses.length === 1 ? "" : "es"}
                  </>
                )}
                . Total seats after this:{" "}
                <span className="font-semibold text-cx-accent">{projectedSeats}</span>.
              </p>

              {allocateNewBatch && newClassNames.length > 0 && (
                <p className="mt-2 text-sm text-cx-muted">
                  Next, go to{" "}
                  <Link to="/admin/codes/create" className="cx-link">
                    Create Codes
                  </Link>{" "}
                  to make the codes for {newClassNames.map((name) => `“${name}”`).join(", ")}, one class at a time.
                </p>
              )}
            </Step>

            {/* Action */}
            <div className="space-y-3">
              {error && <p role="alert" className="cx-alert-error">{error}</p>}
              {message && <p role="status" className="cx-alert-success">{message}</p>}
              {warning && <p role="status" className="cx-alert-warn">{warning}</p>}

              <button
                onClick={submitRenewal}
                disabled={busy || !canSubmit}
                className="cx-btn-primary w-full py-3 sm:w-auto"
              >
                {busy ? "Submitting..." : "Renew"}
              </button>
            </div>

            {/* Cancel plan, kept apart so it is not clicked by mistake */}
            <section className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50/50 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div>
                <h2 className="font-semibold text-cx-heading">Cancel this school's plan</h2>
                <p className="mt-0.5 text-sm text-cx-muted">Only use this to stop the current plan.</p>
              </div>
              <button
                onClick={cancelPlan}
                disabled={busy || !detail?.currentSubscription}
                className="cx-btn-danger w-full sm:w-auto"
              >
                Cancel plan
              </button>
            </section>
          </>
        )}
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
    <label className="block min-w-0">
      <span className="cx-label">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cx-input mt-1 w-full"
      />
    </label>
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
    <label className="block min-w-0">
      <span className="cx-label">{label}</span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="cx-input mt-1 w-full"
      />
    </label>
  );
}

function PlanField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wider text-cx-muted">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold text-cx-heading">{value}</div>
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
