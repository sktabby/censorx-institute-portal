import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<PortalProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
      setFirebaseUser(user);
      setError(null);

      if (!user) {
        setProfile(null);
        setLoading(false);
        return;
      }

      try {
        await refreshProfile();
      } catch (err: any) {
        const message =
          err?.response?.data?.error?.message ?? "You do not have access to CensorX for Schools.";
        setError(message);
        await signOut(firebaseAuth);
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  async function login(email: string, password: string) {
    setError(null);
    await signInWithEmailAndPassword(firebaseAuth, email, password);
  }

  async function logout() {
    await signOut(firebaseAuth);
    setProfile(null);
  }

  async function refreshProfile() {
    const res = await apiClient.get<ApiResponse<PortalProfile>>("/auth/me");
    if (res.data.success) {
      setProfile(res.data.data);
      return;
    }
    setError(res.data.error.message);
    await signOut(firebaseAuth);
  }

  return (
    <AuthContext.Provider value={{ firebaseUser, profile, loading, error, login, logout, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
