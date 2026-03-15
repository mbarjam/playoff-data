import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import type { ReactNode } from "react";

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { currentUser, isAdmin, authLoading } = useAuth();
  if (authLoading) return null;
  if (!currentUser) return <Navigate to="/" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}
