import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth, type PortalRole } from "../contexts/AuthContext";

export function ProtectedRoute({ allowedRoles }: { allowedRoles: PortalRole[] }) {
  const { profile, loading, firebaseUser } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-cx-muted">
        Loading your portal session...
      </div>
    );
  }

  if (!firebaseUser || !profile) {
    return <Navigate to="/login" replace />;
  }

  if (!allowedRoles.includes(profile.role)) {
    return <Navigate to="/login" replace />;
  }

  if (profile.mustChangePassword && !location.pathname.endsWith("/account")) {
    return <Navigate to={profile.role === "SUPER_ADMIN" ? "/admin/account" : "/school/account"} replace />;
  }

  return <Outlet />;
}
