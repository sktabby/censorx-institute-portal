import PortalLayout from "../../layouts/PortalLayout";
import PageHeader from "../../components/PageHeader";
import AccountPasswordForm from "../../components/AccountPasswordForm";
import { adminNavItems } from "./navItems";

export default function Account() {
  return (
    <PortalLayout items={adminNavItems}>
      <PageHeader title="Account" />
      <div className="mx-auto w-full max-w-2xl">
        <AccountPasswordForm />
      </div>
    </PortalLayout>
  );
}
