import { useState } from "react";
import { Link } from "react-router-dom";
import { sendPasswordResetEmail } from "firebase/auth";
import { ShieldCheck } from "lucide-react";
import { firebaseAuth } from "../config/firebase";

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
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <ShieldCheck className="text-cx-accent mb-2" size={32} />
          <h1 className="text-xl font-semibold">Reset Password</h1>
          <p className="text-sm text-cx-muted">Enter your portal email</p>
        </div>

        <form onSubmit={submit} className="glass-card p-6 space-y-4">
          <div>
            <label className="text-sm text-cx-muted">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border focus:border-cx-accent outline-none"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {message && <p className="text-sm text-cx-accent2">{message}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 rounded-lg bg-cx-accent text-cx-bg font-medium disabled:opacity-50"
          >
            {busy ? "Sending..." : "Send Reset Email"}
          </button>

          <Link to="/login" className="block text-center text-sm text-cx-muted hover:text-cx-accent">
            Back to sign in
          </Link>
        </form>
      </div>
    </div>
  );
}
