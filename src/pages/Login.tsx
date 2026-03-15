import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { AlertCircle, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

const inputCls =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function Login() {
  const { currentUser, authLoading, isAdmin, login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (authLoading) return null;
  if (currentUser && isAdmin) return <Navigate to="/dashboard" replace />;
  if (currentUser && !isAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 gap-4">
        <p className="text-sm text-destructive">Access denied. Admin account required.</p>
        <Button variant="outline" onClick={() => login("", "")}>Sign in with a different account</Button>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const result = await login(email, password);
    setSubmitting(false);
    if (result === "ok") {
      navigate("/dashboard");
    } else {
      setError("Invalid email or password.");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 pb-8">
      <div className="flex flex-col items-center gap-3 mb-8">
        <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Database className="h-7 w-7 text-primary" />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-display font-bold text-foreground">Playoff Data</h1>
          <p className="text-xs text-muted-foreground mt-1">Admin data sync dashboard</p>
        </div>
      </div>

      <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="px-1 pt-1 pb-0">
          <div className="bg-muted/40 rounded-t-lg px-5 py-3 border-b border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Admin Sign In</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Email
            </label>
            <input
              type="email"
              autoComplete="email"
              required
              className={inputCls}
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              required
              className={inputCls}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
            />
          </div>
          {error && (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
              {error}
            </div>
          )}
          <Button type="submit" className="w-full mt-1" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign In"}
          </Button>
        </form>
      </div>
    </div>
  );
}
