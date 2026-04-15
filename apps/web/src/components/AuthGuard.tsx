import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { meApi, tokens } from "@/lib/api";
import type { MeResponse } from "@/lib/api";

export function AuthGuard() {
  const [state, setState] = useState<"loading" | "auth" | "unauth">("loading");
  const [me, setMe] = useState<MeResponse | null>(null);
  const location = useLocation();

  useEffect(() => {
    if (!tokens.access) { setState("unauth"); return; }
    meApi.get()
      .then((data) => { setMe(data); setState("auth"); })
      .catch(() => { tokens.clear(); setState("unauth"); });
  }, []);

  if (state === "loading") {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (state === "unauth") {
    return <Navigate to="/auth/login" state={{ from: location }} replace />;
  }

  // Redirigir a onboarding si aún no se completó
  if (me && !me.profile.onboardingCompleted && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet context={{ me, setMe }} />;
}
