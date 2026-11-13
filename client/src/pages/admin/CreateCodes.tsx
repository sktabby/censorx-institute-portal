import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Download, HelpCircle } from "lucide-react";
import PortalLayout from "../../layouts/PortalLayout";
import PageHeader from "../../components/PageHeader";
import Step from "../../components/Step";
import Select from "../../components/Select";
import DataTable from "../../components/DataTable";
import StatusBadge from "../../components/StatusBadge";
import { apiClient, type ApiResponse, type PagedResult } from "../../api/client";
import { adminNavItems } from "./navItems";

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

interface OrgDetail extends OrgOption {
  contactEmail: string;
  seatUsage: SeatUsage;
  currentSubscription: Subscription | null;
}

/** Mirrors OrganizationBatchSummary in server/src/services/batchService.ts. */
interface BatchSummary {
  batchName: string;
  codeCount: number;
  unusedCount: number;
  redeemedCount: number;
  expiredCount: number;
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

/** Sentinel for the batch selector's "start a new sheet" option. */
const NEW_BATCH = "__NEW__";

interface GeneratedCode {
  plaintextCode: string;
  codeLast4: string;
  licenseId: string;
  studentIdentifier?: string | null;
}

interface GenerateCodesResponse {
  batchName: string;
  codes: GeneratedCode[];
  emailDelivery?: { sent: boolean; to: string; warning?: string };
}

export default function CreateCodes() {
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [orgDetail, setOrgDetail] = useState<OrgDetail | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [loadingOrgDetail, setLoadingOrgDetail] = useState(false);

  const [batchSelection, setBatchSelection] = useState<string>(NEW_BATCH);
  const [batchName, setBatchName] = useState("");
  const [mode, setMode] = useState<"RANDOM" | "STUDENT_IDS">("RANDOM");
  const [studentIdsText, setStudentIdsText] = useState("");

  const [generated, setGenerated] = useState<GeneratedCode[] | null>(null);
  const [generatedBatch, setGeneratedBatch] = useState("");
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
    setOrgDetail(null);
    setBatches([]);
    setBatchSelection(NEW_BATCH);
    setBatchName("");
    setMode("RANDOM");
    setStudentIdsText("");
    setGenerated(null);
    setMessage(null);
    setWarning(null);
    setError(null);
    if (selectedOrg) void refreshSelectedSchool(selectedOrg);
  }, [selectedOrg]);

  const studentIdentifiers = useMemo(
    () =>
      studentIdsText
        .split(/[\n,]+/)
        .map((id) => id.trim())
        .filter(Boolean),
    [studentIdsText]
  );

  const seatUsage = orgDetail?.seatUsage ?? null;
  const currentSubscription = orgDetail?.currentSubscription ?? null;
  const hasActiveSubscription = currentSubscription?.status === "ACTIVE";
  const remainingCapacity = seatUsage?.remainingCapacity ?? 0;

  const pendingBatches = batches.filter((batch) => batch.isPending);
  const selectedBatch = batches.find((batch) => batch.batchName === batchSelection) ?? null;
  /** A batch allocated in Renew School, awaiting its codes. */
  const pendingSelection = selectedBatch?.isPending ? selectedBatch : null;

  /**
   * Quantity is derived, never typed. Fulfilling a pending allocation issues
   * exactly the seats Renew School reserved; otherwise student-ID mode issues
   * one code per identifier and random mode fills remaining seat capacity.
   */
  const quantity = pendingSelection
    ? pendingSelection.pendingSeats
    : mode === "STUDENT_IDS"
      ? studentIdentifiers.length
      : remainingCapacity;

  const blockingReason = !selectedOrg
    ? "Select a school."
    : !orgDetail
      ? null
      : !hasActiveSubscription
        ? "This school has no active plan yet. Go to Renew School to start one."
        : remainingCapacity <= 0
          ? "No seats left. Go to Renew School to add seats first."
          : pendingSelection
            ? mode === "STUDENT_IDS" && studentIdentifiers.length !== pendingSelection.pendingSeats
              ? `"${pendingSelection.batchName}" has ${pendingSelection.pendingSeats} seat(s) waiting. Paste exactly ${pendingSelection.pendingSeats} student IDs.`
              : null
            : mode === "STUDENT_IDS" && studentIdentifiers.length === 0
              ? "Paste the student IDs to make codes for."
              : mode === "STUDENT_IDS" && studentIdentifiers.length > remainingCapacity
                ? `Only ${remainingCapacity} seat(s) are left. Remove ${studentIdentifiers.length - remainingCapacity} student ID(s).`
                : null;

  async function refreshSelectedSchool(organizationId = selectedOrg) {
    setLoadingOrgDetail(true);
    try {
      const [detailRes, batchRes] = await Promise.all([
        apiClient.get<ApiResponse<OrgDetail>>(`/admin/organizations/${organizationId}`),
        apiClient.get<ApiResponse<BatchSummary[]>>(`/admin/organizations/${organizationId}/batches`),
      ]);
      setOrgDetail(detailRes.data.success ? detailRes.data.data : null);
      setBatches(batchRes.data.success ? batchRes.data.data : []);
    } catch {
      setOrgDetail(null);
      setBatches([]);
    } finally {
      setLoadingOrgDetail(false);
    }
  }

  async function createCodes() {
    setError(null);
    setMessage(null);
    setWarning(null);
    setGenerated(null);

    if (blockingReason) {
      setError(blockingReason);
      return;
    }
    if (mode === "STUDENT_IDS") {
      const normalized = studentIdentifiers.map((id) => id.toUpperCase());
      if (new Set(normalized).size !== normalized.length) {
        setError("Remove duplicate student IDs before creating codes.");
        return;
      }
    }

    setBusy(true);
    try {
      const res = await apiClient.post<ApiResponse<GenerateCodesResponse>>(
        `/admin/organizations/${selectedOrg}/licenses/generate`,
        {
          numberOfCodes: quantity,
          subscriptionId: currentSubscription!.subscriptionId,
          // An existing selection appends to that sheet; otherwise the typed
          // name (or a server-generated one) starts a new sheet.
          batchName: batchSelection === NEW_BATCH ? batchName || undefined : batchSelection,
          codeGenerationMode: mode,
          studentIdentifiers: mode === "STUDENT_IDS" ? studentIdentifiers : undefined,
          idempotencyKey: `${selectedOrg}-${Date.now()}`,
        }
      );

      if (!res.data.success) {
        setError(res.data.error.message);
        return;
      }

      setGenerated(res.data.data.codes);
      setGeneratedBatch(res.data.data.batchName);
      if (res.data.data.emailDelivery?.sent) {
        setMessage(`Codes created and emailed to ${res.data.data.emailDelivery.to}.`);
      } else {
        setWarning(
          res.data.data.emailDelivery?.warning ??
            "Codes were created, but the email to the school could not be sent. Download the CSV and share it with the school."
        );
      }
      await refreshSelectedSchool();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? "Failed to create codes.");
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    if (!generated) return;
    const rows = [
      ["Serial number", "Student activation code", "Student ID", "Code last four", "License ID"],
      ...generated.map((c, i) => [String(i + 1), c.plaintextCode, c.studentIdentifier ?? "", c.codeLast4, c.licenseId]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${generatedBatch || "codes"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const needsSeats = !!orgDetail && (!hasActiveSubscription || remainingCapacity <= 0);

  return (
    <PortalLayout items={adminNavItems}>
      <PageHeader
        title="Create Codes"
        description="Make the codes for a class and email them to the school."
        action={
          <Link to="/admin/guide" className="cx-link inline-flex min-h-11 items-center gap-1.5 text-sm">
            <HelpCircle size={16} aria-hidden="true" />
            How it works
          </Link>
        }
      />

      <div className="mx-auto w-full max-w-3xl space-y-4">
        {/* Step 1: school */}
        <Step number={1} title="Choose the school" hint="Pick the school you are making codes for.">
          <label htmlFor="create-codes-school" className="sr-only">
            School
          </label>
          <Select
            id="create-codes-school"
            value={selectedOrg}
            onChange={(e) => setSelectedOrg(e.target.value)}
            className="cx-input w-full"
          >
            <option value="">Select a school</option>
            {orgs.map((org) => (
              <option key={org.organizationId} value={org.organizationId}>
                {org.name}
              </option>
            ))}
          </Select>

          {selectedOrg && (
            <div className="mt-4 rounded-xl border border-cx-border bg-cx-tint/50 p-4">
              {loadingOrgDetail ? (
                <p role="status" className="text-sm text-cx-muted">Loading school details...</p>
              ) : !orgDetail ? (
                <p role="alert" className="text-sm font-medium text-red-700">
                  Could not load this school's details.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-words font-semibold text-cx-heading">{orgDetail.name}</span>
                    <StatusBadge status={currentSubscription?.status ?? "NONE"} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <InfoField label="Plan" value={(currentSubscription?.planDuration ?? "NONE").replace(/_/g, " ")} />
                    <InfoField label="Starts" value={formatAnyDate(currentSubscription?.startAt ?? null)} />
                    <InfoField label="Ends" value={formatAnyDate(currentSubscription?.expiresAt ?? null)} />
                    <InfoField label="Total seats" value={seatUsage?.seatLimit ?? 0} />
                    <InfoField label="Students joined" value={seatUsage?.activatedSeats ?? 0} />
                    <InfoField label="Unused codes" value={seatUsage?.unusedCodes ?? 0} />
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 ring-1 ring-cx-border">
                    <span className="text-sm text-cx-muted">Seats left to make codes for</span>
                    <span className="text-xl font-bold text-cx-accent">{remainingCapacity}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </Step>

        {/* Step 2: sheet */}
        {selectedOrg && orgDetail && (
          <Step
            number={2}
            title="Choose the code sheet"
            hint="A sheet is a group of codes, usually one class. Pick the class that is waiting for codes."
          >
            {pendingBatches.length > 0 && (
              <p className="mb-3 rounded-xl border border-cx-accent/20 bg-cx-tint px-3.5 py-2.5 text-sm text-cx-text">
                <span className="font-semibold">Waiting for codes:</span>{" "}
                {pendingBatches.map((batch) => `${batch.batchName} (${batch.pendingSeats})`).join(", ")}
              </p>
            )}

            <label htmlFor="create-codes-sheet" className="sr-only">
              Code sheet
            </label>
            <Select
              id="create-codes-sheet"
              value={batchSelection}
              onChange={(e) => setBatchSelection(e.target.value)}
              className="cx-input w-full"
            >
              <option value={NEW_BATCH}>New sheet</option>
              {pendingBatches.length > 0 && (
                <optgroup label="Waiting for codes">
                  {pendingBatches.map((batch) => (
                    <option key={batch.batchName} value={batch.batchName}>
                      {batch.batchName} — {batch.pendingSeats} seat(s) waiting
                    </option>
                  ))}
                </optgroup>
              )}
              {batches.filter((batch) => !batch.isPending).length > 0 && (
                <optgroup label="Existing sheets">
                  {batches
                    .filter((batch) => !batch.isPending)
                    .map((batch) => (
                      <option key={batch.batchName} value={batch.batchName}>
                        {batch.batchName} ({batch.codeCount} codes)
                      </option>
                    ))}
                </optgroup>
              )}
            </Select>

            {batchSelection === NEW_BATCH ? (
              <div className="mt-3 space-y-3">
                {pendingBatches.length > 0 ? (
                  <p className="cx-alert-warn">
                    A class is still waiting for codes. Choose it above first. A new sheet uses all the seats that are
                    left.
                  </p>
                ) : (
                  <p className="text-sm text-cx-muted">Give the sheet a name, for example Class 5A.</p>
                )}
                <input
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value)}
                  aria-label="New sheet name"
                  placeholder="Sheet name (optional)"
                  className="cx-input w-full"
                />
              </div>
            ) : pendingSelection ? (
              // Dates come from the renewal that added these seats and cannot be changed here.
              <div className="mt-3 rounded-xl border border-cx-accent bg-cx-tint p-3.5 text-sm">
                <p className="font-medium text-cx-accent">
                  This class has {pendingSelection.pendingSeats} seat(s) waiting. It will make exactly that many codes.
                </p>
                <p className="mt-1 text-xs text-cx-muted">
                  Starts {formatIsoDate(pendingSelection.startAt)} · Ends {formatIsoDate(pendingSelection.expiresAt)}
                </p>
                {pendingSelection.windowUpdatedAt && (
                  <p className="mt-2 text-xs text-amber-700">
                    These dates were changed by a later renewal on {formatIsoDate(pendingSelection.windowUpdatedAt)}.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-cx-muted">New codes will be added to this existing sheet.</p>
            )}
          </Step>
        )}

        {/* Step 3: how */}
        {selectedOrg && orgDetail && (
          <Step number={3} title="Choose how to make the codes" hint="Most schools use random codes.">
            <div className="flex flex-wrap gap-2">
              <ModeButton active={mode === "RANDOM"} onClick={() => setMode("RANDOM")} label="Random codes" />
              <ModeButton
                active={mode === "STUDENT_IDS"}
                onClick={() => setMode("STUDENT_IDS")}
                label="From student IDs"
              />
            </div>

            {mode === "RANDOM" ? (
              <p className="mt-3 text-sm text-cx-muted">Each code is made at random, so nobody can guess it.</p>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="cx-alert-warn flex gap-2">
                  <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
                  <span>
                    These codes are made from the student IDs, so they are easier to guess. Make sure the ID list is not
                    public.
                  </span>
                </div>
                <div>
                  <label htmlFor="create-codes-student-ids" className="cx-label">
                    Student IDs
                  </label>
                  <textarea
                    id="create-codes-student-ids"
                    value={studentIdsText}
                    onChange={(e) => setStudentIdsText(e.target.value)}
                    rows={6}
                    placeholder="One ID per line, or separate them with commas"
                    className="cx-input mt-1 w-full"
                  />
                </div>
              </div>
            )}

            <p className="mt-4 rounded-xl border border-cx-border bg-cx-surface px-3.5 py-2.5 text-sm text-cx-text">
              {pendingSelection ? (
                <>
                  This will make <span className="font-semibold text-cx-accent">{quantity}</span> code(s) for “
                  {pendingSelection.batchName}”.
                </>
              ) : mode === "STUDENT_IDS" ? (
                <>
                  This will make <span className="font-semibold text-cx-accent">{quantity}</span> code(s), one for each
                  student ID.
                </>
              ) : (
                <>
                  This will make <span className="font-semibold text-cx-accent">{quantity}</span> code(s), using all the
                  seats that are left.
                </>
              )}
            </p>
          </Step>
        )}

        {/* Action */}
        <div className="space-y-3">
          {blockingReason && selectedOrg && !loadingOrgDetail && (
            <div className="cx-alert-warn flex flex-wrap items-center justify-between gap-3">
              <span>{blockingReason}</span>
              {needsSeats && (
                <Link to="/admin/subscriptions" className="cx-btn-secondary px-3 py-1.5">
                  Open Renew School
                </Link>
              )}
            </div>
          )}
          {error && <p role="alert" className="cx-alert-error">{error}</p>}
          {message && <p role="status" className="cx-alert-success">{message}</p>}
          {warning && <p role="status" className="cx-alert-warn">{warning}</p>}

          <button
            onClick={createCodes}
            disabled={busy || !!blockingReason || quantity <= 0}
            className="cx-btn-primary w-full py-3 sm:w-auto"
          >
            {busy ? "Creating..." : "Create Codes"}
          </button>
        </div>

        {/* Result */}
        {generated && (
          <section aria-labelledby="your-codes" className="space-y-3">
            <h2 id="your-codes" className="text-lg font-semibold">
              Your codes
            </h2>
            <p className="cx-alert-warn">
              Download these codes now. You cannot see the full codes again after you leave this page.
            </p>
            <DataTable
              rows={generated}
              columns={[
                { header: "Code", render: (row) => <span className="font-mono">{row.plaintextCode}</span> },
                { header: "Student ID", render: (row) => row.studentIdentifier ?? "-" },
                { header: "License ID", render: (row) => <span className="text-xs">{row.licenseId}</span> },
              ]}
            />
            <button onClick={downloadCsv} className="cx-btn-secondary w-full sm:w-auto">
              <Download size={16} aria-hidden="true" /> Download CSV
            </button>
          </section>
        )}
      </div>
    </PortalLayout>
  );
}

function formatIsoDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString();
}

function InfoField({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wider text-cx-muted">{label}</div>
      <div className="mt-0.5 break-words text-sm font-semibold text-cx-heading">{value}</div>
    </div>
  );
}

function ModeButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-cx-accent bg-cx-tint text-cx-accent"
          : "border-cx-border bg-white text-cx-text hover:bg-cx-surface"
      }`}
    >
      {label}
    </button>
  );
}

function formatAnyDate(value: { _seconds?: number } | string | null) {
  if (!value) return "-";
  if (typeof value === "string") return new Date(value).toLocaleDateString();
  if (value._seconds) return new Date(value._seconds * 1000).toLocaleDateString();
  return "-";
}
