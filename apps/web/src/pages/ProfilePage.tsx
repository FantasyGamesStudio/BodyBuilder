import { LogOut, RefreshCw, Target, User } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authApi, meApi, onboardingApi, tokens, type ActiveTarget, type MeResponse } from "@/lib/api";

const GOAL_LABELS: Record<string, string> = {
  volumen_limpio: "Volumen limpio",
  mantenimiento: "Mantenimiento",
  recomposicion: "Recomposición",
  definicion: "Definición",
  perdida_peso: "Pérdida de peso",
};

const ACTIVITY_LABELS: Record<string, string> = {
  sedentary: "Sedentario",
  lightly_active: "Ligeramente activo",
  moderately_active: "Moderadamente activo",
  very_active: "Muy activo",
  extra_active: "Extremadamente activo",
};

export function ProfilePage() {
  const navigate = useNavigate();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [target, setTarget] = useState<ActiveTarget | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([meApi.get(), onboardingApi.activeTarget().catch(() => null)])
      .then(([meData, targetData]) => {
        setMe(meData);
        setTarget(targetData);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleLogout() {
    const rt = tokens.refresh;
    if (rt) {
      try { await authApi.logout(rt); } catch { /* ignore */ }
    }
    tokens.clear();
    navigate("/auth/login");
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="px-4 pt-6 pb-4 max-w-lg mx-auto space-y-5">
      {/* Avatar y nombre */}
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 text-2xl font-bold text-white shadow-lg shadow-violet-500/20">
          {me?.profile.nickname.slice(0, 1).toUpperCase() ?? "?"}
        </div>
        <div>
          <h2 className="text-xl font-bold">{me?.profile.nickname}</h2>
          <p className="text-sm text-muted-foreground">{me?.email}</p>
        </div>
      </div>

      {/* Objetivo activo */}
      {target ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              <CardTitle>Objetivo activo</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Objetivo</span>
              <span className="text-sm font-medium">{GOAL_LABELS[target.goalMode] ?? target.goalMode}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Actividad</span>
              <span className="text-sm font-medium">{ACTIVITY_LABELS[target.activityLevel] ?? target.activityLevel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Calorías diana</span>
              <span className="text-sm font-bold text-primary">{target.kcalTarget} kcal</span>
            </div>
            <div className="h-px bg-border" />
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <p className="font-semibold text-blue-400">{target.proteinMinG}g</p>
                <p className="text-muted-foreground">Proteína</p>
              </div>
              <div>
                <p className="font-semibold text-violet-400">{target.carbsG}g</p>
                <p className="text-muted-foreground">Carbos</p>
              </div>
              <div>
                <p className="font-semibold text-orange-400">{target.fatMinG}–{target.fatMaxG}g</p>
                <p className="text-muted-foreground">Grasas</p>
              </div>
            </div>
            {target.weightKg && (
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                <span>Peso registrado</span>
                <span>{target.weightKg} kg</span>
              </div>
            )}
            <div className="pt-1">
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs gap-1.5"
                onClick={() => navigate("/onboarding")}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Recalcular objetivos
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="pt-5 flex flex-col items-center gap-3 text-center py-8">
            <User className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Sin objetivo configurado</p>
            <Button size="sm" onClick={() => navigate("/onboarding")}>
              Configurar objetivos
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Info del perfil */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Cuenta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Visibilidad</span>
            <span className="text-sm font-medium capitalize">
              {me?.profile.accountVisibility === "private" ? "Privada" : "Pública"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Zona horaria</span>
            <span className="text-sm font-medium">{me?.profile.ianaTimezone}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Miembro desde</span>
            <span className="text-sm font-medium">
              {me ? new Date(me.createdAt).toLocaleDateString("es-ES", { month: "long", year: "numeric" }) : "—"}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Logout */}
      <Button variant="outline" className="w-full text-destructive border-destructive/30 hover:bg-destructive/10" onClick={handleLogout}>
        <LogOut className="h-4 w-4 mr-2" />
        Cerrar sesión
      </Button>
    </div>
  );
}
