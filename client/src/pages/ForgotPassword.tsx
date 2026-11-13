import { useState } from "react";
import { Link } from "react-router-dom";
import { sendPasswordResetEmail } from "firebase/auth";
import { firebaseAuth } from "../config/firebase";
import AuthBrandPanel, { MobileAuthImage } from "../components/AuthBrandPanel";
import AppFooter from "../components/AppFooter";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await sendPasswordResetEmail(firebaseAuth, email);
      setMessage("Password reset email sent. Check your inbox.");
    } catch (err: any) {
      setError(err?.message ?? "Failed to send password reset email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-white md:flex">
      <AuthBrandPanel />

      {/* Form panel */}
      <div className="flex min-w-0 flex-1 flex-col">
      <main className="flex flex-1 items-center justify-center px-6 py-10 md:px-10">
        <div className="w-full max-w-[400px]">
          <h1 className="text-3xl font-bold tracking-tight">Reset Password</h1>
          <p className="mt-2 text-sm text-cx-muted">Enter your school login email</p>

          <form onSubmit={submit} className="mt-8 space-y-5">
            <div>
              <label htmlFor="reset-email" className="block text-sm font-medium text-cx-text">
                Email
              </label>
              <input
                id="reset-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="cx-input mt-1.5 w-full"
              />
            </div>

            {error && (
              <div role="alert" className="cx-alert-error">
                {error}
              </div>
            )}
            {message && (
              <div role="status" className="cx-alert-success">
                {message}
              </div>
            )}

            <button type="submit" disabled={busy} className="cx-btn-primary w-full py-3">
              {busy ? "Sending..." : "Send Reset Email"}
            </button>

            <Link
              to="/login"
              className="mx-auto flex min-h-11 w-fit items-center rounded-lg px-2 text-sm font-medium text-cx-accent hover:text-cx-hover hover:underline"
            >
              Back to sign in
            </Link>
          </form>

          <MobileAuthImage />
        </div>
      </main>
      <AppFooter />
      </div>
    </div>
  );
}
