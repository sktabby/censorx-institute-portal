import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { firebaseAuth } from "../config/firebase";
import { apiClient, type ApiResponse } from "../api/client";

export type PortalRole = "SUPER_ADMIN" | "SCHOOL_ADMIN";

export interface PortalProfile {
  uid: string;
  email: string;
  displayName: string;
  role: PortalRole;
  organizationId: string | null;
  status: "ACTIVE" | "DISABLED";
  mustChangePassword: boolean;
}

interface AuthContextValue {
  firebaseUser: User | null;
  profile: PortalProfile | null;
  loading: boolean;
  error: string | null;
  /** Signed in, but the server could not be reached to load the account. Retrying. */
  connectionProblem: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Try loading the account again now (from the "can't reach the server" screen). */
  retryConnection: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Waits between attempts when the server cannot be reached. */
const RETRY_DELAYS_MS = [1000, 2500, 5000];
/** While unreachable, keep trying in the background this often. */
const BACKGROUND_RETRY_MS = 15000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type LoadResult =
  | { kind: "ok"; profile: PortalProfile }
  /** The server clearly said this login has no portal access: sign out. */
  | { kind: "rejected"; message: string }
  /** Network down, server restarting, rate limited, or a server-side error: stay signed in. */
  | { kind: "unreachable" };

/**
 * Loads the portal account for the signed-in Firebase user.
 *
 * Only a definite "no access" from the server (unknown portal user, disabled account) signs the
 * user out. Everything temporary is retried with a fresh token, so a server restart or a brief
 * network problem no longer logs anyone out.
 */
async function loadProfile(user: User): Promise<LoadResult> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await apiClient.get<ApiResponse<PortalProfile>>("/auth/me");
      if (res.data.success) return { kind: "ok", profile: res.data.data };
      return { kind: "rejected", message: res.data.error.message };
    } catch (err: any) {
      const status: number | undefined = err?.response?.status;
      const message: string | undefined = err?.response?.data?.error?.message;

      // Definite answers about the account itself.
      if (status === 403) {
        return { kind: "rejected", message: message ?? "You do not have access to CensorX for Schools." };
      }

      // A rejected token: get a brand-new one before trying again. If Firebase itself refuses
      // (the session was really revoked), that is a definite sign-out.
      if (status === 401) {
        try {
          await user.getIdToken(true);
        } catch (tokenErr: any) {
          const code = String(tokenErr?.code ?? "");
          if (code.includes("user-token-expired") || code.includes("user-disabled") || code.includes("user-not-found")) {
            return { kind: "rejected", message: "Your session has ended. Please sign in again." };
          }
        }
      }

      if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  return { kind: "unreachable" };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<PortalProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionProblem, setConnectionProblem] = useState(false);
  const userRef = useRef<User | null>(null);

  const applyResult = useCallback(async (user: User, result: LoadResult) => {
    if (userRef.current?.uid !== user.uid) return; // signed out or switched meanwhile
    if (result.kind === "ok") {
      setProfile(result.profile);
      setConnectionProblem(false);
      setError(null);
    } else if (result.kind === "rejected") {
      setError(result.message);
      setConnectionProblem(false);
      setProfile(null);
      await signOut(firebaseAuth);
    } else {
      // Keep the session; the portal shows a "can't reach the server" screen and retries.
      setConnectionProblem(true);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
      userRef.current = user;
      setFirebaseUser(user);

      if (!user) {
        setProfile(null);
        setConnectionProblem(false);
        setLoading(false);
        return;
      }

      setError(null);
      try {
        await applyResult(user, await loadProfile(user));
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, [applyResult]);

  // While the server is unreachable, keep trying quietly in the background.
  useEffect(() => {
    if (!connectionProblem || !firebaseUser) return;
    const timer = window.setInterval(async () => {
      const user = userRef.current;
      if (user) await applyResult(user, await loadProfile(user));
    }, BACKGROUND_RETRY_MS);
    return () => window.clearInterval(timer);
  }, [connectionProblem, firebaseUser, applyResult]);

  async function login(email: string, password: string) {
    setError(null);
    await signInWithEmailAndPassword(firebaseAuth, email, password);
  }

  async function logout() {
    await signOut(firebaseAuth);
    setProfile(null);
    setConnectionProblem(false);
  }

  /** Re-reads the account (e.g. after a password change). Same rules: only a definite "no" signs out. */
  async function refreshProfile() {
    const user = firebaseAuth.currentUser;
    if (!user) return;
    await applyResult(user, await loadProfile(user));
  }

  async function retryConnection() {
    const user = userRef.current;
    if (user) await applyResult(user, await loadProfile(user));
  }

  return (
    <AuthContext.Provider
      value={{ firebaseUser, profile, loading, error, connectionProblem, login, logout, refreshProfile, retryConnection }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
