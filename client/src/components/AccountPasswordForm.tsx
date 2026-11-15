import { useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { Check, Circle, Eye, EyeOff, KeyRound } from "lucide-react";
import { firebaseAuth } from "../config/firebase";
import { apiClient } from "../api/client";
import { useAuth } from "../contexts/AuthContext";

const MIN_LENGTH = 8;

/** Turns Firebase error codes into a sentence a school admin can act on. */
function friendlyError(err: unknown) {
  const code = (err as { code?: string })?.code ?? "";
  if (code === "auth/wrong-password" || code === "auth/invalid-credential") return "Your current password is not correct.";
  if (code === "auth/too-many-requests") return "Too many attempts. Please wait a few minutes and try again.";
  if (code === "auth/weak-password") return "Choose a stronger new password.";
  if (code === "auth/requires-recent-login") return "For your security, sign out and sign in again, then change your password.";
  if (code === "auth/network-request-failed") return "No internet connection. Check your connection and try again.";
  return "Your password could not be updated. Please try again.";
}

export default function AccountPasswordForm() {
  const { profile, refreshProfile } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const checks = [
    { ok: newPassword.length >= MIN_LENGTH, text: `At least ${MIN_LENGTH} characters` },
    { ok: newPassword.length > 0 && newPassword !== currentPassword, text: "Different from the current password" },
    { ok: confirmPassword.length > 0 && newPassword === confirmPassword, text: "Both new passwords match" },
  ];
  const ready = currentPassword.length > 0 && checks.every((item) => item.ok);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const user = firebaseAuth.currentUser;
    if (!user?.email) {
      setError("Your session is not ready. Please sign in again.");
      return;
    }
    if (newPassword.length < MIN_LENGTH) {
      setError(`New password must be at least ${MIN_LENGTH} characters.`);
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
      setMessage("Password updated. Use your new password next time you sign in.");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-cx-border bg-white p-4 shadow-card sm:p-6">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cx-tint text-cx-accent">
          <KeyRound size={18} aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-cx-heading sm:text-lg">Change password</h2>
          <p className="text-xs text-cx-muted sm:text-sm">Confirm your current password, then choose a new one.</p>
        </div>
      </div>

      {profile?.mustChangePassword && (
        <p className="cx-alert-warn mt-4">Your account was created with a temporary password. Set a new password to continue.</p>
      )}

      <div className="mt-5 space-y-4">
        <PasswordField label="Current password" autoComplete="current-password" value={currentPassword} onChange={setCurrentPassword} />
        <div className="grid gap-4 sm:grid-cols-2">
          <PasswordField label="New password" autoComplete="new-password" value={newPassword} onChange={setNewPassword} />
          <PasswordField label="Confirm new password" autoComplete="new-password" value={confirmPassword} onChange={setConfirmPassword} />
        </div>

        <ul className="grid gap-1.5 text-xs sm:grid-cols-3" aria-label="Password requirements">
          {checks.map((item) => (
            <li key={item.text} className={`flex items-center gap-1.5 transition-colors ${item.ok ? "text-cx-accent" : "text-cx-muted"}`}>
              {item.ok ? <Check size={14} aria-hidden="true" /> : <Circle size={12} aria-hidden="true" />}
              {item.text}
            </li>
          ))}
        </ul>

        {error && <p role="alert" className="cx-alert-error">{error}</p>}
        {message && <p role="status" className="cx-alert-success">{message}</p>}

        <button type="submit" disabled={busy || !ready} className="cx-btn-primary w-full sm:w-auto">
          {busy ? "Updating..." : "Update password"}
        </button>
      </div>
    </form>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="block">
      <span className="cx-label">{label}</span>
      <span className="relative mt-1 block">
        <input
          type={visible ? "text" : "password"}
          required
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="cx-input w-full pr-12"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-xl text-cx-muted hover:text-cx-text"
        >
          {visible ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
        </button>
      </span>
    </label>
  );
}
