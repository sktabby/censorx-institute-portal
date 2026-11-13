import { useEffect, useState, type ReactNode } from "react";
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
}

export default function Account() {
  const { profile } = useAuth();
  const [schoolInfo, setSchoolInfo] = useState<SchoolAccountInfo | null>(null);

  useEffect(() => {
    apiClient.get<ApiResponse<SchoolAccountInfo>>("/school/dashboard").then((res) => {
      if (res.data.success) setSchoolInfo(res.data.data);
    });
  }, []);

  const initial = (profile?.email ?? "").trim().charAt(0).toUpperCase() || "?";

  return (
    <PortalLayout items={schoolNavItems}>
      <PageHeader title="Account" />

      <div className="mx-auto w-full max-w-2xl space-y-5">
        {/* Profile */}
        <section className="glass-card overflow-hidden">
          <div className="flex items-center gap-4 p-5 sm:p-6">
            <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-cx-dark text-2xl font-bold text-white">
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="break-words text-lg font-semibold leading-tight text-cx-heading">
                {schoolInfo?.schoolName ?? "-"}
              </h2>
              <p className="mt-0.5 truncate text-sm text-cx-muted" title={profile?.email}>
                {profile?.email ?? "-"}
              </p>
            </div>
            {profile?.status && <StatusBadge status={profile.status} />}
          </div>

          <dl className="divide-y divide-cx-line border-t border-cx-line">
            <Row label="School identifier" value={schoolInfo?.schoolIdentifier ?? "-"} />
            <Row label="Admin email" value={profile?.email ?? "-"} />
            <Row label="Role" value={profile?.role ? profile.role.replace(/_/g, " ") : "-"} />
          </dl>
        </section>

        <AccountPasswordForm />
      </div>
    </PortalLayout>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
      <dt className="text-sm text-cx-muted">{label}</dt>
      <dd className="break-all text-sm font-medium text-cx-heading sm:text-right">{value}</dd>
    </div>
  );
}
