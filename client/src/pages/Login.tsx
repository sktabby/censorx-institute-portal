import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { Eye, EyeOff, Rocket } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import AuthBrandPanel, { MobileAuthImage } from "../components/AuthBrandPanel";
import GetStartedDialog from "../components/GetStartedDialog";
import AppFooter from "../components/AppFooter";

export default function Login() {
  const { login, profile, firebaseUser, error } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Display only: toggles the password field between hidden and visible text.
  const [showPassword, setShowPassword] = useState(false);
  // Display only: opens the "Get started" steps popup.
  const [guideOpen, setGuideOpen] = useState(false);

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
    <div className="min-h-screen bg-white md:flex">
      <AuthBrandPanel />

      {/* Form panel */}
      <div className="flex min-w-0 flex-1 flex-col">
      <main className="flex flex-1 items-center justify-center px-6 py-10 md:px-10">
        <div className="w-full max-w-[400px]">
          <a
            href="https://censorx.in/schools"
            className="mb-8 inline-flex min-h-11 items-center rounded-lg text-sm font-medium text-cx-accent hover:text-cx-hover hover:underline"
          >
            &larr; Back to censorx.in
          </a>

          <h1 className="text-3xl font-bold tracking-tight">School login</h1>
          <p className="mt-2 text-sm text-cx-muted">Sign in with the credentials issued to your school.</p>

          <form onSubmit={onSubmit} className="mt-8 space-y-5">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-cx-text">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="cx-input mt-1.5 w-full"
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-cx-text">
                Password
              </label>
              <div className="relative mt-1.5">
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="cx-input w-full pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-xl text-cx-muted hover:text-cx-text"
                >
                  {showPassword ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
                </button>
              </div>
            </div>

            {(localError || error) && (
              <div role="alert" className="cx-alert-error">
                {localError ?? error}
              </div>
            )}

            <button type="submit" disabled={submitting} className="cx-btn-primary w-full py-3">
              {submitting ? "Signing in..." : "Sign In"}
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => navigate("/forgot-password")}
                className="rounded-lg px-2 text-sm font-medium text-cx-accent hover:text-cx-hover hover:underline"
              >
                Forgot Password?
              </button>
            </div>
          </form>

          <button type="button" onClick={() => setGuideOpen(true)} className="cx-btn-secondary mt-8 w-full">
            <Rocket size={16} aria-hidden="true" className="text-cx-accent" />
            How to get started
          </button>

          <p className="mt-6 text-center text-xs text-cx-muted">
            Need help?{" "}
            <a href="mailto:team@censorx.in" className="font-medium text-cx-accent hover:text-cx-hover hover:underline">
              team@censorx.in
            </a>
          </p>

          <MobileAuthImage />
        </div>
      </main>
      <AppFooter />
      </div>

      <GetStartedDialog open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
