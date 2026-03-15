import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

interface AuthContextValue {
  currentUser: SessionUser | null;
  authLoading: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<"ok" | "invalid_credentials">;
  logout: () => Promise<void>;
}

const ADMIN_EMAIL = "mbarjam@yahoo.com";

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        loadProfile(session.user.id, session.user.email ?? "");
      } else {
        setAuthLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user) {
          loadProfile(session.user.id, session.user.email ?? "");
        } else {
          setCurrentUser(null);
          setAuthLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(userId: string, email: string) {
    const { data } = await supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", userId)
      .single();
    setCurrentUser({
      id: userId,
      email,
      firstName: data?.first_name ?? "",
      lastName: data?.last_name ?? "",
    });
    setAuthLoading(false);
  }

  const login = async (
    email: string,
    password: string
  ): Promise<"ok" | "invalid_credentials"> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return "invalid_credentials";
    return "ok";
  };

  const logout = async () => {
    await supabase.auth.signOut();
  };

  const isAdmin = currentUser?.email.toLowerCase() === ADMIN_EMAIL;

  return (
    <AuthContext.Provider value={{ currentUser, authLoading, isAdmin, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
