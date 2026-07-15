import { useState } from "react";
import { Link, useNavigate, Navigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

export default function Login() {
  const { login, profile, firebaseUser, error } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already authenticated with a resolved role — redirect immediately.
  if (firebaseUser && profile) {
    return <Navigate to={profile.role === "SUPER_ADMIN" ? "/admin" : "/school"} replace />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      // AuthContext resolves the profile asynchronously; navigation happens
      // via the Navigate check above once profile is set.
    } catch {
      setLocalError("Invalid email or password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-6 inline-flex text-sm text-cx-muted hover:text-cx-accent transition-colors">
          &larr; Back to Home
        </Link>
        <div className="flex flex-col items-center mb-8">
          <ShieldCheck className="text-cx-accent mb-2" size={32} />
          <h1 className="text-xl font-semibold">CensorX Institute Portal</h1>
          <p className="text-sm text-cx-muted">Sign in to continue</p>
        </div>

        <form onSubmit={onSubmit} className="glass-card p-6 space-y-4">
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
          <div>
            <label className="text-sm text-cx-muted">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border focus:border-cx-accent outline-none"
            />
          </div>

          {(localError || error) && <p className="text-sm text-red-400">{localError ?? error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-lg bg-cx-accent text-cx-bg font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitting ? "Signing in..." : "Sign In"}
          </button>

          <button
            type="button"
            onClick={() => navigate("/forgot-password")}
            className="w-full text-sm text-cx-muted hover:text-cx-accent transition-colors"
          >
            Forgot Password?
          </button>
        </form>
      </div>
    </div>
  );
}
