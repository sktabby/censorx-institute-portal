import { useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { RefreshCw, WifiOff } from "lucide-react";
import { useAuth, type PortalRole } from "../contexts/AuthContext";

export function ProtectedRoute({ allowedRoles }: { allowedRoles: PortalRole[] }) {
  const { profile, loading, firebaseUser, connectionProblem, retryConnection, logout } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-cx-muted">
        Loading your portal session...
      </div>
    );
  }

  // Still signed in, but the server could not be reached: wait here instead of logging out.
  if (firebaseUser && !profile && connectionProblem) {
    return <ReconnectScreen onRetry={retryConnection} onSignOut={logout} />;
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

function ReconnectScreen({ onRetry, onSignOut }: { onRetry: () => Promise<void>; onSignOut: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-6">
      <div role="alert" className="glass-card w-full max-w-md p-6 text-center">
        <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
          <WifiOff size={22} aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-cx-heading">Can't reach the CensorX server</h1>
        <p className="mt-2 text-sm text-cx-muted">
          You are still signed in. We'll keep trying every few seconds — this usually fixes itself. Check your internet connection
          if it takes long.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onRetry();
              } finally {
                setBusy(false);
              }
            }}
            className="cx-btn-primary"
          >
            <RefreshCw size={16} aria-hidden="true" className={busy ? "animate-spin" : ""} />
            {busy ? "Trying..." : "Try again now"}
          </button>
          <button type="button" onClick={() => void onSignOut()} className="cx-btn-secondary">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
