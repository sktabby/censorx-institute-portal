import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download } from "lucide-react";
import PortalLayout from "../../layouts/PortalLayout";
import DataTable from "../../components/DataTable";
import { apiClient, type ApiResponse, type PagedResult } from "../../api/client";
import { adminNavItems } from "./navItems";
import { isPlanDuration, planOptions, type PlanDuration } from "../../utils/planDuration";

interface OrgOption {
  organizationId: string;
  name: string;
}

interface Subscription {
  subscriptionId: string;
  planDuration: string;
  status: string;
  seatLimit: number;
}

interface OrgDetail extends OrgOption {
  contactEmail: string;
  purchasedSeats: number;
  activatedSeats: number;
  currentSubscription: Subscription | null;
}

interface GeneratedCode {
  plaintextCode: string;
  codeLast4: string;
  licenseId: string;
  studentIdentifier?: string | null;
}

interface GenerateCodesResponse {
  batchName: string;
  codes: GeneratedCode[];
  emailDelivery?: {
    sent: boolean;
    to: string;
    warning?: string;
  };
}

export default function CreateCodes() {
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [quantity, setQuantity] = useState(10);
  const [batchName, setBatchName] = useState("");
  const [planDuration, setPlanDuration] = useState<PlanDuration>("YEARLY");
  const [startAt, setStartAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [mode, setMode] = useState<"RANDOM" | "STUDENT_IDS">("RANDOM");
  const [studentIdsText, setStudentIdsText] = useState("");
  const [orgDetail, setOrgDetail] = useState<OrgDetail | null>(null);
  const [existingUnusedCodes, setExistingUnusedCodes] = useState(0);
  const [loadingOrgDetail, setLoadingOrgDetail] = useState(false);
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
    if (!selectedOrg) {
      setOrgDetail(null);
      setExistingUnusedCodes(0);
      setPlanDuration("YEARLY");
      setQuantity(10);
      return;
    }
    refreshSelectedSchool(selectedOrg);
  }, [selectedOrg]);

  const remainingCapacity = orgDetail
    ? Math.max(0, orgDetail.purchasedSeats - orgDetail.activatedSeats - existingUnusedCodes)
    : null;
  const currentSubscription = orgDetail?.currentSubscription ?? null;
  const hasActiveSubscription = currentSubscription?.status === "ACTIVE";

  const studentIdentifiers = useMemo(
    () =>
      studentIdsText
        .split(/[\n,]+/)
        .map((id) => id.trim())
        .filter(Boolean),
    [studentIdsText]
  );

  async function refreshSelectedSchool(organizationId = selectedOrg) {
    setLoadingOrgDetail(true);
    setOrgDetail(null);
    setExistingUnusedCodes(0);
    try {
      const [detailRes, unusedCodesRes] = await Promise.all([
        apiClient.get<ApiResponse<OrgDetail>>(`/admin/organizations/${organizationId}`),
        apiClient.get<ApiResponse<PagedResult<unknown>>>(
          `/admin/licenses?${new URLSearchParams({ organizationId, status: "UNUSED", page: "1", pageSize: "1" }).toString()}`
        ),
      ]);

      const nextDetail = detailRes.data.success ? detailRes.data.data : null;
      const nextUnusedCodes = unusedCodesRes.data.success ? unusedCodesRes.data.data.total : 0;

      setOrgDetail(nextDetail);
      setExistingUnusedCodes(nextUnusedCodes);

      if (nextDetail?.currentSubscription && isPlanDuration(nextDetail.currentSubscription.planDuration)) {
        setPlanDuration(nextDetail.currentSubscription.planDuration);
      } else {
        setPlanDuration("YEARLY");
      }

      const nextRemainingCapacity = nextDetail
        ? Math.max(0, nextDetail.purchasedSeats - nextDetail.activatedSeats - nextUnusedCodes)
        : 10;
      setQuantity(nextRemainingCapacity > 0 ? nextRemainingCapacity : 0);
    } catch {
      setOrgDetail(null);
      setExistingUnusedCodes(0);
    } finally {
      setLoadingOrgDetail(false);
    }
  }

  async function createCodes() {
    setError(null);
    setMessage(null);
    setWarning(null);
    setGenerated(null);

    if (!selectedOrg) {
      setError("Select a school.");
      return;
    }
    if (quantity <= 0) {
      setError("Enter a positive number of students.");
      return;
    }
    if (mode === "STUDENT_IDS") {
      const normalized = studentIdentifiers.map((id) => id.toUpperCase());
      if (normalized.length !== quantity) {
        setError("Student ID count must match the total number of students.");
        return;
      }
      if (new Set(normalized).size !== normalized.length) {
        setError("Remove duplicate student IDs before creating codes.");
        return;
      }
    }
    if (!hasActiveSubscription && planDuration === "CUSTOM" && (!startAt || !expiresAt)) {
      setError("Custom plans require start and expiry dates.");
      return;
    }

    setBusy(true);
    try {
      const payload = {
        numberOfCodes: quantity,
        subscriptionId: hasActiveSubscription ? currentSubscription.subscriptionId : undefined,
        planDuration: hasActiveSubscription ? undefined : planDuration,
        startAt: !hasActiveSubscription && planDuration === "CUSTOM" ? new Date(startAt).toISOString() : undefined,
        expiresAt: !hasActiveSubscription && planDuration === "CUSTOM" ? new Date(expiresAt).toISOString() : undefined,
        batchName: batchName || undefined,
        codeGenerationMode: mode,
        studentIdentifiers: mode === "STUDENT_IDS" ? studentIdentifiers : undefined,
        idempotencyKey: `${selectedOrg}-${Date.now()}`,
      };
      const res = await apiClient.post<ApiResponse<GenerateCodesResponse>>(
        `/admin/organizations/${selectedOrg}/licenses/generate`,
        payload
      );
      if (res.data.success) {
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
      } else {
        setError(res.data.error.message);
      }
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
      ...generated.map((c, i) => [
        String(i + 1),
        c.plaintextCode,
        c.studentIdentifier ?? "",
        c.codeLast4,
        c.licenseId,
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${generatedBatch || batchName || "codes"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <PortalLayout items={adminNavItems}>
      <h1 className="text-2xl font-semibold mb-6">Create Codes</h1>

      <div className="glass-card p-6 max-w-3xl space-y-4 mb-8">
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

        {selectedOrg && (
          <div className="rounded-lg border border-cx-border bg-white/5 p-4">
            {loadingOrgDetail ? (
              <p className="text-sm text-cx-muted">Loading subscription details...</p>
            ) : orgDetail ? (
              <div className="grid sm:grid-cols-5 gap-3 text-sm">
                <InfoField label="Current plan" value={orgDetail.currentSubscription?.planDuration ?? "NONE"} />
                <InfoField label="Total seats" value={orgDetail.purchasedSeats} />
                <InfoField label="Activated" value={orgDetail.activatedSeats} />
                <InfoField label="Unused codes" value={existingUnusedCodes} />
                <InfoField label="Remaining" value={remainingCapacity ?? 0} highlight />
              </div>
            ) : (
              <p className="text-sm text-red-400">Could not load subscription details for this school.</p>
            )}
          </div>
        )}

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <NumberField label="Total students / codes" value={quantity} onChange={setQuantity} />
            {remainingCapacity !== null && (
              <p className={`mt-1 text-xs ${quantity > remainingCapacity ? "text-amber-300" : "text-cx-muted"}`}>
                Remaining capacity: {remainingCapacity} of {orgDetail?.purchasedSeats ?? 0} seats available
              </p>
            )}
          </div>
          <TextField label="Batch / sheet name" value={batchName} onChange={setBatchName} />
          <div>
            <label className="text-sm text-cx-muted">
              {hasActiveSubscription ? "Current plan (set via Renew School)" : "Plan duration"}
            </label>
            <select
              value={planDuration}
              onChange={(e) => setPlanDuration(e.target.value as PlanDuration)}
              disabled={hasActiveSubscription}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm disabled:opacity-70"
            >
              {planOptions.map((plan) => (
                <option key={plan} value={plan} className="bg-cx-panel">{plan}</option>
              ))}
            </select>
            {hasActiveSubscription && (
              <p className="mt-1 text-xs text-cx-muted">
                To change the plan type or dates, use Renew School.
              </p>
            )}
          </div>
        </div>

        {!hasActiveSubscription && planDuration === "CUSTOM" && (
          <div className="grid sm:grid-cols-2 gap-4">
            <TextField label="Start date" type="date" value={startAt} onChange={setStartAt} />
            <TextField label="Expiry date" type="date" value={expiresAt} onChange={setExpiresAt} />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <ModeButton active={mode === "RANDOM"} onClick={() => setMode("RANDOM")} label="Random unique codes" />
          <ModeButton active={mode === "STUDENT_IDS"} onClick={() => setMode("STUDENT_IDS")} label="From student IDs" />
        </div>

        {mode === "STUDENT_IDS" && (
          <div className="space-y-3">
            <div className="flex gap-2 text-sm text-amber-300">
              <AlertTriangle size={18} className="shrink-0" />
              <span>
                Note: these codes are derived from student IDs and are less random than auto-generated codes. Ensure student ID lists are not publicly guessable.
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

        {error && <p className="text-sm text-red-400">{error}</p>}
        {message && <p className="text-sm text-cx-accent2">{message}</p>}
        {warning && <p className="text-sm text-amber-300">{warning}</p>}

        <button
          onClick={createCodes}
          disabled={busy}
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

function InfoField({ label, value, highlight = false }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div>
      <div className="text-xs text-cx-muted mb-1">{label}</div>
      <div className={highlight ? "text-lg font-semibold text-cx-accent2" : "font-medium"}>{value}</div>
    </div>
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
