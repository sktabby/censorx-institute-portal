import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, Fingerprint, LifeBuoy, LogOut, Mail, MessageCircle, ShieldCheck, UserRound } from "lucide-react";
import PortalLayout from "../../layouts/PortalLayout";
import PageHeader from "../../components/PageHeader";
import AccountPasswordForm from "../../components/AccountPasswordForm";
import StatusBadge from "../../components/StatusBadge";
import { apiClient, type ApiResponse } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { schoolNavItems } from "./navItems";

interface SchoolAccountInfo {
  schoolName: string;
  schoolIdentifier: string;
  organizationStatus?: string;
  liveBatchCount?: number;
  batchCount?: number;
}

const SUPPORT_EMAIL = "team@censorx.in";
const WHATSAPP = ["+91 98203 76923", "+91 84548 00911"];

export default function Account() {
  const { profile, logout } = useAuth();
  const [schoolInfo, setSchoolInfo] = useState<SchoolAccountInfo | null>(null);

  useEffect(() => {
    apiClient.get<ApiResponse<SchoolAccountInfo>>("/school/dashboard").then((res) => {
      if (res.data.success) setSchoolInfo(res.data.data);
    });
  }, []);

  const schoolName = schoolInfo?.schoolName ?? "";
  const initial = (schoolName || profile?.email || "").trim().charAt(0).toUpperCase() || "?";

  return (
    <PortalLayout items={schoolNavItems}>
      <PageHeader title="Account" />

      <div className="mx-auto w-full max-w-3xl space-y-4 sm:space-y-5">
        {/* Profile */}
        <section className="overflow-hidden rounded-2xl border border-cx-border bg-white shadow-card animate-fade-up motion-reduce:animate-none">
          <div className="relative bg-gradient-to-br from-cx-mid via-cx-dark to-cx-night px-4 py-5 text-white sm:px-6 sm:py-6">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:radial-gradient(circle_at_1px_1px,#fff_1px,transparent_0)] [background-size:22px_22px]"
            />
            <div className="relative flex flex-wrap items-center gap-3.5 sm:flex-nowrap sm:gap-4">
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-xl font-bold ring-1 ring-white/20 sm:h-14 sm:w-14 sm:text-2xl">
                {initial}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="break-words text-base font-semibold leading-tight !text-white sm:text-xl">{schoolName || "Your school"}</h2>
                {profile?.displayName && <p className="mt-1 break-words text-xs text-white/80 sm:text-sm">{profile.displayName}</p>}
                <p className="mt-0.5 [overflow-wrap:anywhere] text-xs text-white/80 sm:text-sm">{profile?.email ?? "-"}</p>
              </div>
              {schoolInfo?.organizationStatus && <StatusBadge status={schoolInfo.organizationStatus} tone="dark" />}
            </div>
          </div>

          <dl className="grid divide-y divide-cx-line sm:grid-cols-2 sm:divide-y-0">
            <Detail icon={<Fingerprint size={16} />} label="School ID" value={schoolInfo?.schoolIdentifier ?? "-"} copy={schoolInfo?.schoolIdentifier} />
            <Detail icon={<Mail size={16} />} label="Login email" value={profile?.email ?? "-"} copy={profile?.email} />
            <Detail icon={<UserRound size={16} />} label="Role" value="School admin" />
            <Detail
              icon={<ShieldCheck size={16} />}
              label="Batches"
              value={schoolInfo?.batchCount !== undefined ? `${schoolInfo.liveBatchCount ?? 0} live of ${schoolInfo.batchCount}` : "-"}
            />
          </dl>
        </section>

        <AccountPasswordForm />

        {/* Help + sign out */}
        <section className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center rounded-2xl border border-cx-border bg-white p-4 shadow-card sm:p-5">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cx-tint text-cx-accent">
              <LifeBuoy size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-cx-heading">Need help with your account?</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-cx-muted">
                <a href={`mailto:${SUPPORT_EMAIL}`} className="cx-link inline-flex items-center gap-1">
                  <Mail size={14} aria-hidden="true" /> {SUPPORT_EMAIL}
                </a>
                <span className="inline-flex items-center gap-1">
                  <MessageCircle size={14} aria-hidden="true" className="text-cx-accent" /> {WHATSAPP.join(" | ")}
                </span>
              </p>
            </div>
          </div>
          <button type="button" onClick={() => void logout()} className="cx-btn-secondary w-full sm:w-auto">
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </section>
      </div>
    </PortalLayout>
  );
}

function Detail({ icon, label, value, copy }: { icon: ReactNode; label: string; value: ReactNode; copy?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-3 px-4 py-3 sm:px-6 sm:py-4 sm:[&:nth-child(n+3)]:border-t sm:[&:nth-child(n+3)]:border-cx-line">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cx-tint text-cx-accent">{icon}</span>
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] font-medium uppercase tracking-wider text-cx-muted">{label}</dt>
        <dd className="[overflow-wrap:anywhere] text-sm font-medium text-cx-heading">{value}</dd>
      </div>
      {copy && (
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(copy);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // Clipboard not available: nothing to do.
            }
          }}
          aria-label={`Copy ${label.toLowerCase()}`}
          title="Copy"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-cx-muted transition-colors hover:bg-cx-tint hover:text-cx-accent"
        >
          {copied ? <Check size={16} aria-hidden="true" className="text-cx-accent" /> : <Copy size={16} aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}
