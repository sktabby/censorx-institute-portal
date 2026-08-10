import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download } from "lucide-react";
import PortalLayout from "../../layouts/PortalLayout";
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
        ? "This school has no active subscription. Use Renew School to start one and allocate seats."
        : remainingCapacity <= 0
          ? "No seats remaining. Allocate more seats in Renew School before creating codes."
          : pendingSelection
            ? mode === "STUDENT_IDS" && studentIdentifiers.length !== pendingSelection.pendingSeats
              ? `Batch "${pendingSelection.batchName}" has ${pendingSelection.pendingSeats} allocated seat(s) — paste exactly that many student IDs.`
              : null
            : mode === "STUDENT_IDS" && studentIdentifiers.length === 0
              ? "Paste the student IDs to generate codes for."
              : mode === "STUDENT_IDS" && studentIdentifiers.length > remainingCapacity
                ? `Only ${remainingCapacity} seat(s) remain — remove ${studentIdentifiers.length - remainingCapacity} student ID(s).`
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
        setMessage(`Codes generated and emailed to ${res.data.data.emailDelivery.to}.`);
      } else {
        setWarning(
          res.data.data.emailDelivery?.warning ??
            "Codes generated successfully, but the email to the school could not be sent. Please download the CSV and share it manually."
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

  return (
    <PortalLayout items={adminNavItems}>
      <h1 className="text-2xl font-semibold mb-6">Create Codes</h1>

      <div className="glass-card p-6 max-w-3xl space-y-5 mb-8">
        <div>
          <label className="text-sm text-cx-muted">School</label>
          <select
            value={selectedOrg}
            onChange={(e) => setSelectedOrg(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
          >
            <option value="" className="bg-cx-panel">Select a school</option>
            {orgs.map((org) => (
              <option key={org.organizationId} value={org.organizationId} className="bg-cx-panel">
                {org.name}
              </option>
            ))}
          </select>
        </div>

        {/* Subscription and seat facts are read-only — they come from the
            active subscription and are changed via Renew School. */}
        {selectedOrg && (
          <div className="rounded-lg border border-cx-border bg-white/5 p-4">
            {loadingOrgDetail ? (
              <p className="text-sm text-cx-muted">Loading subscription details...</p>
            ) : !orgDetail ? (
              <p className="text-sm text-red-400">Could not load subscription details for this school.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{orgDetail.name}</span>
                  <StatusBadge status={currentSubscription?.status ?? "NONE"} />
                </div>
                <div className="grid sm:grid-cols-3 gap-3 text-sm">
                  <InfoField label="Plan" value={currentSubscription?.planDuration ?? "NONE"} />
                  <InfoField label="Starts" value={formatAnyDate(currentSubscription?.startAt ?? null)} />
                  <InfoField label="Expires" value={formatAnyDate(currentSubscription?.expiresAt ?? null)} />
                  <InfoField label="Seat limit" value={seatUsage?.seatLimit ?? 0} />
                  <InfoField label="Activated" value={seatUsage?.activatedSeats ?? 0} />
                  <InfoField label="Unused codes" value={seatUsage?.unusedCodes ?? 0} />
                </div>
                <div className="pt-2 border-t border-cx-border">
                  <InfoField label="Remaining capacity" value={remainingCapacity} highlight />
                </div>
              </div>
            )}
          </div>
        )}

        {selectedOrg && orgDetail && (
          <>
            <div>
              <label className="text-sm text-cx-muted">Code sheet</label>
              <select
                value={batchSelection}
                onChange={(e) => setBatchSelection(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
              >
                <option value={NEW_BATCH} className="bg-cx-panel">New sheet</option>
                {pendingBatches.length > 0 && (
                  <optgroup label="Awaiting code generation">
                    {pendingBatches.map((batch) => (
                      <option key={batch.batchName} value={batch.batchName} className="bg-cx-panel">
                        {batch.batchName} — {batch.pendingSeats} seat(s) allocated
                      </option>
                    ))}
                  </optgroup>
                )}
                {batches.filter((batch) => !batch.isPending).length > 0 && (
                  <optgroup label="Existing sheets">
                    {batches
                      .filter((batch) => !batch.isPending)
                      .map((batch) => (
                        <option key={batch.batchName} value={batch.batchName} className="bg-cx-panel">
                          {batch.batchName} ({batch.codeCount} codes)
                        </option>
                      ))}
                  </optgroup>
                )}
              </select>

              {batchSelection === NEW_BATCH ? (
                <input
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value)}
                  placeholder="New sheet name (optional)"
                  className="w-full mt-2 px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
                />
              ) : pendingSelection ? (
                // Dates are inherited from the renewal that allocated this
                // batch, and are not editable here.
                <div className="mt-2 rounded-lg border border-cx-accent/40 bg-cx-accent/5 p-3 text-sm space-y-2">
                  <div className="font-medium text-cx-accent2">
                    Allocated in Renew School — {pendingSelection.pendingSeats} seat(s), codes not generated yet.
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2 text-xs">
                    <ReadOnlyField label="Starts (inherited)" value={formatIsoDate(pendingSelection.startAt)} />
                    <ReadOnlyField label="Expires (inherited)" value={formatIsoDate(pendingSelection.expiresAt)} />
                  </div>
                  {pendingSelection.windowUpdatedAt && (
                    <p className="text-xs text-amber-300">
                      Dates updated by a later renewal on {formatIsoDate(pendingSelection.windowUpdatedAt)} — these are
                      not the dates originally allocated.
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-xs text-cx-muted">New codes will be added to this existing sheet.</p>
              )}
            </div>

            <div>
              <label className="text-sm text-cx-muted">Code type</label>
              <div className="flex flex-wrap gap-2 mt-1">
                <ModeButton active={mode === "RANDOM"} onClick={() => setMode("RANDOM")} label="Random unique codes" />
                <ModeButton
                  active={mode === "STUDENT_IDS"}
                  onClick={() => setMode("STUDENT_IDS")}
                  label="From student IDs"
                />
              </div>
            </div>

            {mode === "STUDENT_IDS" && (
              <div className="space-y-3">
                <div className="flex gap-2 text-sm text-amber-300">
                  <AlertTriangle size={18} className="shrink-0" />
                  <span>
                    Note: these codes are derived from student IDs and are less random than auto-generated codes. Ensure
                    student ID lists are not publicly guessable.
                  </span>
                </div>
                <div>
                  <label className="text-sm text-cx-muted">Student identifiers</label>
                  <textarea
                    value={studentIdsText}
                    onChange={(e) => setStudentIdsText(e.target.value)}
                    rows={6}
                    placeholder="One per line, or paste comma-separated values"
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border focus:border-cx-accent outline-none text-sm"
                  />
                </div>
              </div>
            )}

            <div className="rounded-lg border border-cx-border bg-white/5 p-3 text-sm">
              {pendingSelection ? (
                <>
                  Will generate <span className="text-cx-accent2 font-semibold">{quantity}</span> code(s), fulfilling
                  the seats allocated to "{pendingSelection.batchName}".
                </>
              ) : mode === "STUDENT_IDS" ? (
                <>
                  Will generate <span className="text-cx-accent2 font-semibold">{quantity}</span> code(s) — one per
                  student ID.
                </>
              ) : (
                <>
                  Will generate <span className="text-cx-accent2 font-semibold">{quantity}</span> code(s) to fill the
                  school's remaining seat capacity.
                </>
              )}
            </div>
          </>
        )}

        {blockingReason && selectedOrg && !loadingOrgDetail && (
          <p className="text-sm text-amber-300">{blockingReason}</p>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {message && <p className="text-sm text-cx-accent2">{message}</p>}
        {warning && <p className="text-sm text-amber-300">{warning}</p>}

        <button
          onClick={createCodes}
          disabled={busy || !!blockingReason || quantity <= 0}
          className="px-5 py-2.5 rounded-lg bg-cx-accent text-cx-bg font-medium disabled:opacity-50"
        >
          {busy ? "Creating..." : "Create Codes"}
        </button>
      </div>

      {generated && (
        <div className="max-w-4xl">
          <p className="text-sm text-amber-300 mb-4">
            Download these activation codes now. Full codes cannot be viewed again after leaving this page.
          </p>
          <DataTable
            rows={generated}
            columns={[
              { header: "Code", render: (row) => <span className="font-mono">{row.plaintextCode}</span> },
              { header: "Student ID", render: (row) => row.studentIdentifier ?? "-" },
              { header: "License ID", render: (row) => <span className="text-xs">{row.licenseId}</span> },
            ]}
          />
          <button
            onClick={downloadCsv}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-cx-border text-sm hover:border-cx-accent/50"
          >
            <Download size={16} /> Download CSV
          </button>
        </div>
      )}
    </PortalLayout>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-cx-muted">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function formatIsoDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString();
}

function InfoField({ label, value, highlight = false }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div>
      <div className="text-xs text-cx-muted mb-1">{label}</div>
      <div className={highlight ? "text-lg font-semibold text-cx-accent2" : "font-medium"}>{value}</div>
    </div>
  );
}

function ModeButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 rounded-lg text-sm border ${
        active ? "border-cx-accent text-cx-accent" : "border-cx-border text-cx-muted"
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
