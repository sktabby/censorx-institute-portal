import PortalLayout from "../../layouts/PortalLayout";
import AccountPasswordForm from "../../components/AccountPasswordForm";
import { adminNavItems } from "./navItems";

export default function Account() {
  return (
    <PortalLayout items={adminNavItems}>
      <AccountPasswordForm />
    </PortalLayout>
  );
}
