import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Download, FileUp, HelpCircle } from "lucide-react";
import PortalLayout from "../../layouts/PortalLayout";
import PageHeader from "../../components/PageHeader";
import Step from "../../components/Step";
import Select from "../../components/Select";
import DataTable from "../../components/DataTable";
import { MobileField, MobileFields } from "../../components/MobileCard";
import StatusBadge from "../../components/StatusBadge";
import { apiClient, type ApiResponse, type PagedResult } from "../../api/client";
import { adminNavItems } from "./navItems";
import { saveBlob } from "../../types/batches";

/** Reads a File as base64 (no "data:…;base64," prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** First column of a CSV / text file: one value per line, first cell only, quotes removed. */
function firstColumnOfText(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(/[,;\t]/)[0].trim().replace(/^"(.*)"$/, "$1").trim())
    .filter(Boolean);
}

/** Drops a header row ("Student ID", "Roll no" …) when the file has one row more than needed. */
function withoutHeader(values: string[], expected: number) {
  const looksLikeHeader = /student|roll|admission|^id$|^ids$|name|number|^no\.?$/i.test(values[0] ?? "");
  return values.length > expected && (values.length === expected + 1 || looksLikeHeader) ? values.slice(1) : values;
}

interface OrgOption {
  organizationId: string;
  name: string;
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
  status: string;
  seatUsage: SeatUsage;
}

/** Mirrors OrganizationBatchSummary in server/src/services/batchService.ts. */
interface BatchSummary {
  batchName: string;
  subscriptionId: string;
  batchLabel: string | null;
  subscriptionStatus: string;
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

interface GeneratedCode {
  plaintextCode: string;
  codeLast4: string;
  licenseId: string;
  studentIdentifier?: string | null;
}

interface GenerateCodesResponse {
  batchName: string;
  codes: GeneratedCode[];
  emailDelivery?: { sent: boolean; queued?: boolean; to: string; warning?: string };
}

/** The outcome for one class in a run. */
interface ClassResult {
  batchName: string;
  status: "created" | "failed";
  codes: GeneratedCode[];
  emailSent?: boolean;
  emailQueued?: boolean;
  emailTo?: string;
  emailWarning?: string;
  error?: string;
}

export default function CreateCodes() {
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [orgDetail, setOrgDetail] = useState<OrgDetail | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [loadingOrgDetail, setLoadingOrgDetail] = useState(false);

  // The waiting classes (sheets) the codes are for. Empty until one is chosen.
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [mode, setMode] = useState<"RANDOM" | "STUDENT_IDS">("RANDOM");
  const [studentIdsText, setStudentIdsText] = useState("");
  const [idFileNote, setIdFileNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [idFileBusy, setIdFileBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const [results, setResults] = useState<ClassResult[] | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number; name: string } | null>(null);
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
    setSelectedClasses([]);
    setMode("RANDOM");
    setStudentIdsText("");
    setResults(null);
    setProgress(null);
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

  /**
   * Classes set up on the Subscription page that are still waiting for codes, in a batch that
   * is live. A waiting class in an ended batch is listed apart: renew that batch first.
   */
  const pendingBatches = batches.filter((batch) => batch.isPending && batch.subscriptionStatus === "ACTIVE");
  const blockedBatches = batches.filter((batch) => batch.isPending && batch.subscriptionStatus !== "ACTIVE");
  const waitingTotal = pendingBatches.reduce((sum, batch) => sum + batch.pendingSeats, 0);
  const selectedBatchList = pendingBatches.filter((batch) => selectedClasses.includes(batch.batchName));
  const singleSelection = selectedBatchList.length === 1 ? selectedBatchList[0] : null;

  // Keep the choice valid: pick the only waiting class automatically, and drop classes that
  // have just been given their codes.
  useEffect(() => {
    const stillWaiting = selectedClasses.filter((name) => pendingBatches.some((batch) => batch.batchName === name));
    if (stillWaiting.length === 0 && pendingBatches.length === 1) {
      setSelectedClasses([pendingBatches[0].batchName]);
    } else if (stillWaiting.length !== selectedClasses.length) {
      setSelectedClasses(stillWaiting);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches]);

  /**
   * Quantity is derived, never typed: each waiting class gets exactly the seats
   * New Sheet reserved for it, so the total is the sum over the chosen classes.
   */
  const quantity = selectedBatchList.reduce((sum, batch) => sum + batch.pendingSeats, 0);

  const blockingReason = !selectedOrg
    ? "Select a school."
    : !orgDetail
      ? null
      : pendingBatches.length === 0
        ? "No class is waiting for codes. Add a batch with its classes on the Subscription page first."
        : selectedBatchList.length === 0
              ? "Choose at least one class."
              : mode === "STUDENT_IDS" && !singleSelection
                ? "Student IDs work for one class at a time. Choose just one class."
                : mode === "STUDENT_IDS" && singleSelection && studentIdentifiers.length !== singleSelection.pendingSeats
                  ? `"${singleSelection.batchName}" has ${singleSelection.pendingSeats} seat(s) waiting. Paste exactly ${singleSelection.pendingSeats} student IDs.`
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

  function toggleClass(name: string) {
    const next = selectedClasses.includes(name)
      ? selectedClasses.filter((item) => item !== name)
      : [...selectedClasses, name];
    setSelectedClasses(next);
    // Student IDs belong to one class, so more than one class means random codes.
    if (next.length !== 1) setMode("RANDOM");
  }

  function selectAllClasses() {
    const all = pendingBatches.map((batch) => batch.batchName);
    setSelectedClasses(all);
    if (all.length !== 1) setMode("RANDOM");
  }

  function clearClasses() {
    setSelectedClasses([]);
    setMode("RANDOM");
  }

  async function createCodes() {
    setError(null);
    setMessage(null);
    setWarning(null);
    setResults(null);

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
      // A student ID is never used twice in a school: check against every code it already has.
      const used = await findUsedIds(studentIdentifiers);
      if (used === null) return setError("Could not check the student IDs. Please try again.");
      if (used.length > 0) return setError(usedMessage(used));
    }

    // One class after another, never at the same time, so the seat checks cannot overlap.
    const targets = [...selectedBatchList];
    const runId = Date.now();
    const outcome: ClassResult[] = [];

    setBusy(true);
    try {
      for (let index = 0; index < targets.length; index++) {
        const target = targets[index];
        setProgress({ current: index + 1, total: targets.length, name: target.batchName });
        try {
          const res = await apiClient.post<ApiResponse<GenerateCodesResponse>>(
            `/admin/organizations/${selectedOrg}/licenses/generate`,
            {
              numberOfCodes: target.pendingSeats,
              // Each class belongs to its own batch; its codes take that batch's dates.
              subscriptionId: target.subscriptionId,
              // Always the waiting class being made.
              batchName: target.batchName,
              codeGenerationMode: mode,
              studentIdentifiers: mode === "STUDENT_IDS" ? studentIdentifiers : undefined,
              idempotencyKey: `${selectedOrg}-${index}-${runId}`,
            }
          );

          if (res.data.success) {
            const delivery = res.data.data.emailDelivery;
            outcome.push({
              batchName: res.data.data.batchName,
              status: "created",
              codes: res.data.data.codes,
              // Queued: the server emails the codes right after replying.
              emailSent: !!delivery?.sent || !!delivery?.queued,
              emailQueued: !!delivery?.queued,
              emailTo: delivery?.to,
              emailWarning: delivery?.sent || delivery?.queued ? undefined : delivery?.warning,
            });
          } else {
            outcome.push({ batchName: target.batchName, status: "failed", codes: [], error: res.data.error.message });
          }
        } catch (err: any) {
          outcome.push({
            batchName: target.batchName,
            status: "failed",
            codes: [],
            error: err?.response?.data?.error?.message ?? "Failed to create codes.",
          });
        }
        setResults([...outcome]);
      }
    } finally {
      setProgress(null);
      setBusy(false);
    }

    const created = outcome.filter((item) => item.status === "created");
    const failed = outcome.filter((item) => item.status === "failed");
    const emailed = created.filter((item) => item.emailSent);
    const notEmailed = created.filter((item) => !item.emailSent);

    if (emailed.length > 0) {
      setMessage(
        created.length === 1
          ? `Codes created. ${emailed[0].emailQueued ? "They are being emailed" : "Emailed"} to ${emailed[0].emailTo}.`
          : `Codes created for ${created.length} class(es). ${emailed.length} email(s) ${emailed.some((item) => item.emailQueued) ? "on the way" : "sent"} to ${emailed[0].emailTo}.`
      );
    }
    if (notEmailed.length > 0) {
      setWarning(
        `The email could not be sent for ${notEmailed.map((item) => item.batchName).join(", ")}. ` +
          `Download the codes and share them with the school.`
      );
    }
    if (failed.length > 0) {
      setError(
        `Codes could not be made for: ${failed.map((item) => `${item.batchName} (${item.error})`).join("; ")}. ` +
          `Those classes are still in the list, so you can try again.`
      );
    }

    await refreshSelectedSchool();
  }

  /** The codes just made, as an Excel file (one sheet per class), built by the server. */
  async function downloadExcel(items: ClassResult[], filename: string, key: string) {
    setDownloading(key);
    setError(null);
    try {
      const res = await apiClient.post(
        "/admin/codes/workbook",
        {
          schoolName: orgDetail?.name,
          classes: items.map((item) => ({
            batchName: item.batchName,
            codes: item.codes.map((code) => ({
              plaintextCode: code.plaintextCode,
              studentIdentifier: code.studentIdentifier ?? null,
              codeLast4: code.codeLast4,
              licenseId: code.licenseId,
            })),
          })),
        },
        { responseType: "blob" }
      );
      saveBlob(res.data as Blob, filename);
    } catch {
      setError("The Excel file could not be made. Please try again.");
    } finally {
      setDownloading(null);
    }
  }

  /** Student IDs (from the list) this school has already used; null when the check failed. */
  async function findUsedIds(ids: string[]): Promise<string[] | null> {
    if (!selectedOrg || ids.length === 0) return [];
    try {
      const res = await apiClient.post<ApiResponse<{ used: string[] }>>(`/admin/organizations/${selectedOrg}/student-ids/check`, { ids });
      return res.data.success ? res.data.data.used : null;
    } catch {
      return null;
    }
  }

  function usedMessage(used: string[]) {
    const shown = used.slice(0, 10).join(", ") + (used.length > 10 ? ` and ${used.length - 10} more` : "");
    return `${used.length === 1 ? "This student ID is" : `${used.length} student IDs are`} already used in this school: ${shown}. Each student ID can be used only once, so remove ${used.length === 1 ? "it" : "them"} from the list.`;
  }

  /** Fills the student ID box from a file: .xlsx (read by the server) or .csv / .txt. First column only. */
  async function loadStudentIdFile(file: File) {
    const expected = singleSelection?.pendingSeats ?? 0;
    setIdFileNote(null);
    setIdFileBusy(true);
    try {
      let values: string[];
      if (/\.xlsx$/i.test(file.name)) {
        const res = await apiClient.post<ApiResponse<{ values: string[] }>>("/admin/student-ids/parse", {
          fileBase64: await fileToBase64(file),
        });
        if (!res.data.success) throw new Error(res.data.error.message);
        values = res.data.data.values;
      } else if (/\.(csv|txt)$/i.test(file.name)) {
        values = firstColumnOfText(await file.text());
      } else {
        setIdFileNote({ tone: "error", text: "Choose an Excel (.xlsx), CSV (.csv) or text (.txt) file." });
        return;
      }
      const ids = withoutHeader(values, expected);
      setStudentIdsText(ids.join("\n"));
      // Duplicates inside the file, then IDs this school has already used.
      const seen = new Set<string>();
      const repeated = Array.from(
        new Set(
          ids.filter((id) => {
            const key = id.toUpperCase();
            const duplicate = seen.has(key);
            seen.add(key);
            return duplicate;
          })
        )
      );
      if (repeated.length > 0) {
        setIdFileNote({
          tone: "error",
          text: `The file repeats ${repeated.length === 1 ? "a student ID" : `${repeated.length} student IDs`}: ${repeated.slice(0, 10).join(", ")}. Each ID must appear only once.`,
        });
        return;
      }
      const used = await findUsedIds(ids);
      if (used && used.length > 0) {
        setIdFileNote({ tone: "error", text: usedMessage(used) });
        return;
      }
      setIdFileNote(
        ids.length === expected
          ? { tone: "ok", text: `Loaded ${ids.length} student ID${ids.length === 1 ? "" : "s"} from ${file.name}. Check them below.` }
          : {
              tone: "error",
              text: `${file.name} has ${ids.length} ID${ids.length === 1 ? "" : "s"}, but ${expected} code${expected === 1 ? " is" : "s are"} waiting for this class. Fix the file, or edit the list below.`,
            }
      );
    } catch (err: any) {
      setIdFileNote({ tone: "error", text: err?.response?.data?.error?.message ?? err?.message ?? "The file could not be read." });
    } finally {
      setIdFileBusy(false);
    }
  }

  const needsSeats = !!orgDetail && pendingBatches.length === 0;
  const createdResults = (results ?? []).filter((item) => item.status === "created");
  const fileBase = (orgDetail?.name ?? "codes").replace(/[^\w.-]+/g, "-");
  const safe = (name: string) => name.replace(/[^\w.-]+/g, "-");

  return (
    <PortalLayout items={adminNavItems}>
      <PageHeader
        title="Create Codes"
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
              {loadingOrgDetail && !orgDetail ? (
                <p role="status" className="text-sm text-cx-muted">Loading school details...</p>
              ) : !orgDetail ? (
                <p role="alert" className="text-sm font-medium text-red-700">
                  Could not load this school's details.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-words font-semibold text-cx-heading">{orgDetail.name}</span>
                    <StatusBadge status={orgDetail.status} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <InfoField label="Seats in live batches" value={seatUsage?.seatLimit ?? 0} />
                    <InfoField label="Students joined" value={seatUsage?.activatedSeats ?? 0} />
                    <InfoField label="Unused codes" value={seatUsage?.unusedCodes ?? 0} />
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 ring-1 ring-cx-border">
                    <span className="text-sm text-cx-muted">Codes waiting to be made</span>
                    <span className="text-xl font-bold text-cx-accent">{waitingTotal}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </Step>

        {/* Step 2: the classes that are waiting for their first codes */}
        {selectedOrg && orgDetail && (
          <Step
            number={2}
            title="Choose the classes"
            hint="These classes have seats but no codes yet. Tick one or more."
          >
            {pendingBatches.length === 0 ? (
              <div className="rounded-xl border border-cx-accent/20 bg-cx-tint px-4 py-4 text-sm">
                <p className="font-medium text-cx-heading">No class is waiting for codes.</p>
                <p className="mt-1 text-cx-muted">
                  Add a batch with its classes on the Subscription page first, then come back here.
                </p>
                <Link to={`/admin/subscriptions?school=${selectedOrg}`} className="cx-btn-primary mt-3 w-full sm:w-auto">
                  Open Subscription
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
                  <span className="text-cx-muted">
                    {selectedBatchList.length} of {pendingBatches.length} selected · {quantity} code(s)
                  </span>
                  <span className="flex gap-3">
                    <button type="button" onClick={selectAllClasses} className="cx-link rounded-lg px-1">
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={clearClasses}
                      className="rounded-lg px-1 text-cx-muted hover:text-cx-text hover:underline"
                    >
                      Clear
                    </button>
                  </span>
                </div>

                <div className="cx-scroll grid gap-2.5 pr-1">
                  {pendingBatches.map((batch) => {
                    const checked = selectedClasses.includes(batch.batchName);
                    return (
                      <label
                        key={batch.batchName}
                        className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors ${
                          checked
                            ? "border-cx-accent bg-cx-tint"
                            : "border-cx-border bg-white hover:border-cx-accent/40"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleClass(batch.batchName)}
                          className="mt-1"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block break-words font-semibold text-cx-heading">
                            {batch.batchName}
                            {batch.batchLabel && (
                              <span className="ml-2 align-middle text-xs font-medium text-cx-accent">{batch.batchLabel}</span>
                            )}
                          </span>
                          <span className="mt-0.5 block text-xs text-cx-muted">
                            {batch.pendingSeats} code(s) to make · Ends {formatIsoDate(batch.expiresAt)}
                          </span>
                          {batch.windowUpdatedAt && (
                            <span className="mt-1 block text-xs text-amber-700">
                              The batch was renewed on {formatIsoDate(batch.windowUpdatedAt)}, so these codes use the new dates.
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {blockedBatches.length > 0 && (
              <p className="cx-alert-warn mt-3">
                Waiting in an ended batch: {blockedBatches.map((batch) => `${batch.batchName} (${batch.batchLabel ?? "batch"})`).join(", ")}.
                Renew that batch on the Subscription page to make these codes.
              </p>
            )}
          </Step>
        )}

        {/* Step 3: how */}
        {selectedOrg && orgDetail && selectedBatchList.length > 0 && (
          <Step number={3} title="Choose how to make the codes" hint="Most schools use random codes.">
            <div className="flex flex-wrap gap-2">
              <ModeButton active={mode === "RANDOM"} onClick={() => setMode("RANDOM")} label="Random codes" />
              <ModeButton
                active={mode === "STUDENT_IDS"}
                onClick={() => setMode("STUDENT_IDS")}
                label="From student IDs"
                disabled={!singleSelection}
              />
            </div>

            {mode === "RANDOM" ? (
              <p className="mt-3 text-sm text-cx-muted">
                Each code is made at random, so nobody can guess it.
                {!singleSelection && " Student IDs can only be used when one class is chosen."}
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="cx-alert-warn flex gap-2">
                  <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
                  <span>
                    These codes are made from the student IDs, so they are easier to guess. Make sure the ID list is not
                    public.
                  </span>
                </div>
                <div className="rounded-xl border border-dashed border-cx-accent/40 bg-cx-tint/40 p-3">
                  <label className="flex cursor-pointer flex-wrap items-center gap-3">
                    <span className="cx-btn-secondary pointer-events-none">
                      <FileUp size={16} aria-hidden="true" /> {idFileBusy ? "Reading..." : "Choose file"}
                    </span>
                    <span className="min-w-0 flex-1 text-sm text-cx-muted">
                      Excel (.xlsx), CSV or text file with the IDs in the <span className="font-medium text-cx-text">first column</span>, one per
                      row{singleSelection ? ` — ${singleSelection.pendingSeats} rows for "${singleSelection.batchName}"` : ""}. A header row is
                      skipped.
                    </span>
                    <input
                      type="file"
                      accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
                      className="sr-only"
                      disabled={idFileBusy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void loadStudentIdFile(file);
                      }}
                    />
                  </label>
                  {idFileNote && (
                    <p role={idFileNote.tone === "error" ? "alert" : "status"} className={`mt-2 ${idFileNote.tone === "error" ? "cx-alert-error" : "cx-alert-success"}`}>
                      {idFileNote.text}
                    </p>
                  )}
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
                    placeholder="Choose a file above, or type one ID per line (or separate them with commas)"
                    className="cx-input mt-1 w-full"
                  />
                </div>
              </div>
            )}

            <p className="mt-4 rounded-xl border border-cx-border bg-cx-surface px-3.5 py-2.5 text-sm text-cx-text">
              {selectedBatchList.length === 1 ? (
                <>
                  This will make <span className="font-semibold text-cx-accent">{quantity}</span> code(s) for “
                  {selectedBatchList[0].batchName}”.
                </>
              ) : (
                <>
                  This will make <span className="font-semibold text-cx-accent">{quantity}</span> code(s) in total for{" "}
                  <span className="font-semibold text-cx-accent">{selectedBatchList.length}</span> classes. The school
                  gets one email for each class.
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
                <Link to={`/admin/subscriptions?school=${selectedOrg}`} className="cx-btn-secondary px-3 py-1.5">
                  Open Subscription
                </Link>
              )}
            </div>
          )}
          {error && <p role="alert" className="cx-alert-error">{error}</p>}
          {message && <p role="status" className="cx-alert-success">{message}</p>}
          {warning && <p role="status" className="cx-alert-warn">{warning}</p>}

          {progress && progress.total > 1 && (
            <p role="status" className="text-sm text-cx-muted">
              Making codes for class {progress.current} of {progress.total}: <span className="font-medium">{progress.name}</span>.
              Please keep this page open.
            </p>
          )}

          <button
            onClick={createCodes}
            disabled={busy || !!blockingReason || quantity <= 0}
            className="cx-btn-primary w-full py-3 sm:w-auto"
          >
            {busy
              ? progress && progress.total > 1
                ? `Creating ${progress.current} of ${progress.total}...`
                : "Creating..."
              : selectedBatchList.length > 1
                ? "Create Codes for all selected"
                : "Create Codes"}
          </button>
        </div>

        {/* Results, one block per class */}
        {results && results.length > 0 && (
          <section aria-labelledby="your-codes" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="your-codes" className="text-lg font-semibold">
                Your codes
              </h2>
              {createdResults.length > 1 && (
                <button
                  onClick={() => downloadExcel(createdResults, `${fileBase}-all-codes.xlsx`, "all")}
                  disabled={downloading !== null}
                  className="cx-btn-primary w-full sm:w-auto"
                >
                  <Download size={16} aria-hidden="true" /> {downloading === "all" ? "Preparing..." : "Download all (Excel)"}
                </button>
              )}
            </div>

            {createdResults.length > 0 && (
              <p className="cx-alert-warn">
                Download these codes now. After you leave this page the school can still download them from Download Codes in
                its portal, and you can from Manage Codes.
              </p>
            )}

            {results.map((item) => (
              <div key={item.batchName} className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="break-words font-semibold text-cx-heading">{item.batchName}</h3>
                  {item.status === "created" ? (
                    <span className="badge whitespace-nowrap border-cx-accent/30 bg-cx-tint text-cx-accent">
                      {item.codes.length} code(s) created
                    </span>
                  ) : (
                    <span className="badge whitespace-nowrap border-red-200 bg-red-50 text-red-700">Failed</span>
                  )}
                </div>

                {item.status === "failed" ? (
                  <p role="alert" className="cx-alert-error">{item.error}</p>
                ) : (
                  <>
                    {/* A fixed-height box that scrolls (taller on desktop), so hundreds of codes do not make the page endless. */}
                    <div className="max-h-[26rem] overflow-y-auto overscroll-contain rounded-2xl border border-cx-border bg-cx-tint/40 p-2 md:max-h-[32rem]">
                    <DataTable
                      rows={item.codes}
                      columns={[
                        { header: "Code", render: (row) => <span className="font-mono">{row.plaintextCode}</span> },
                        { header: "Student ID", render: (row) => row.studentIdentifier ?? "-" },
                        { header: "License ID", render: (row) => <span className="text-xs">{row.licenseId}</span> },
                      ]}
                      mobileCard={(row) => (
                        <>
                          <p className="[overflow-wrap:anywhere] font-mono text-base font-semibold tracking-wide text-cx-heading">
                            {row.plaintextCode}
                          </p>
                          <MobileFields>
                            <MobileField label="Student ID">{row.studentIdentifier ?? "-"}</MobileField>
                            <MobileField label="License ID">
                              <span className="[overflow-wrap:anywhere] text-xs">{row.licenseId}</span>
                            </MobileField>
                          </MobileFields>
                        </>
                      )}
                    />
                    </div>
                    {item.codes.length > 5 && (
                      <p className="text-xs text-cx-muted">Scroll inside the box to see all {item.codes.length} codes.</p>
                    )}
                    <button
                      onClick={() => downloadExcel([item], `${safe(item.batchName)}.xlsx`, item.batchName)}
                      disabled={downloading !== null}
                      className="cx-btn-secondary w-full sm:w-auto"
                    >
                      <Download size={16} aria-hidden="true" /> {downloading === item.batchName ? "Preparing..." : "Download Excel"}
                    </button>
                  </>
                )}
              </div>
            ))}
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

function ModeButton({
  active,
  onClick,
  label,
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
      className={`min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "border-cx-accent bg-cx-tint text-cx-accent"
          : "border-cx-border bg-white text-cx-text hover:bg-cx-surface disabled:hover:bg-white"
      }`}
    >
      {label}
    </button>
  );
}

