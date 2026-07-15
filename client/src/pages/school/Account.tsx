import { useEffect, useState, type ReactNode } from "react";
import PortalLayout from "../../layouts/PortalLayout";
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

  return (
    <PortalLayout items={schoolNavItems}>
      <div className="glass-card p-6 mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold mb-2">Account</h1>
        <p className="text-sm text-cx-muted mb-6">
          This is your CensorX Institute Portal login. Contact CensorX support if you need to update your registered email or transfer admin access.
        </p>

        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <InfoField label="School name" value={schoolInfo?.schoolName ?? "-"} />
          <InfoField label="School identifier" value={schoolInfo?.schoolIdentifier ?? "-"} />
          <InfoField label="Admin email" value={profile?.email ?? "-"} />
          <InfoField label="Role" value={profile?.role ?? "-"} />
          <InfoField label="Account status" value={profile?.status ? <StatusBadge status={profile.status} /> : "-"} />
        </div>
      </div>

      <AccountPasswordForm />
    </PortalLayout>
  );
}

function InfoField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-cx-muted mb-1">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
