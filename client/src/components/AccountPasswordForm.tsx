import { useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { KeyRound } from "lucide-react";
import { firebaseAuth } from "../config/firebase";
import { apiClient } from "../api/client";
import { useAuth } from "../contexts/AuthContext";

export default function AccountPasswordForm() {
  const { profile, refreshProfile } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const user = firebaseAuth.currentUser;
    if (!user?.email) {
      setError("Your Firebase session is not ready. Please sign in again.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      if (profile?.mustChangePassword) {
        await apiClient.post("/auth/clear-must-change-password");
        await refreshProfile();
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("Password updated successfully.");
    } catch (err: any) {
      setError(err?.message ?? "Failed to update password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="glass-card space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <KeyRound size={18} className="text-cx-accent" aria-hidden="true" />
        <h2 className="text-lg font-semibold">Change Password</h2>
      </div>

      {profile?.mustChangePassword && (
        <p className="cx-alert-warn">
          Your account was created with a temporary password. Set a new password to continue.
        </p>
      )}

      <PasswordField label="Current password" value={currentPassword} onChange={setCurrentPassword} />
      <PasswordField label="New password" value={newPassword} onChange={setNewPassword} />
      <PasswordField label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword} />

      {error && <p role="alert" className="cx-alert-error">{error}</p>}
      {message && <p role="status" className="cx-alert-success">{message}</p>}

      <button type="submit" disabled={busy} className="cx-btn-primary w-full sm:w-auto">
        {busy ? "Updating..." : "Update Password"}
      </button>
    </form>
  );
}

function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="cx-label">{label}</span>
      <input
        type="password"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cx-input mt-1 w-full"
      />
    </label>
  );
}
