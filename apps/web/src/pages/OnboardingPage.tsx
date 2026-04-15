import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { onboardingApi, type ActiveTarget, type OnboardingSuggestion } from "@/lib/api";
import { cn } from "@/lib/utils";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface FormData {
  weightKg: string;
  heightCm: string;
  ageYears: string;
  sex: "m" | "f" | "other" | "";
  activityLevel: string;
  goalMode: string;
}

const ACTIVITIES = [
  { id: "sedentary", label: "Sedentario", desc: "Sin ejercicio / trabajo de escritorio" },
  { id: "lightly_active", label: "Ligero", desc: "Ejercicio 1-3 días/semana" },
  { id: "moderately_active", label: "Moderado", desc: "Ejercicio 3-5 días/semana" },
  { id: "very_active", label: "Muy activo", desc: "Ejercicio 6-7 días/semana" },
  { id: "extra_active", label: "Extremo", desc: "Atleta o trabajo físico intenso" },
];

const GOALS = [
  { id: "volumen_limpio", label: "Volumen limpio", desc: "+300 kcal · ganar masa muscular", color: "text-blue-400" },
  { id: "mantenimiento", label: "Mantenimiento", desc: "Mantener peso y composición", color: "text-green-400" },
  { id: "recomposicion", label: "Recomposición", desc: "Perder grasa y ganar músculo", color: "text-violet-400" },
  { id: "definicion", label: "Definición", desc: "−400 kcal · reducir grasa", color: "text-orange-400" },
  { id: "perdida_peso", label: "Pérdida de peso", desc: "−600 kcal · bajar peso", color: "text-red-400" },
];

// ─── Componentes de selección ─────────────────────────────────────────────────

function OptionCard({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-xl border p-4 text-left transition-all duration-150",
        selected
          ? "border-primary bg-primary/10 ring-1 ring-primary"
          : "border-border bg-card hover:border-primary/40 hover:bg-white/5",
        className,
      )}
    >
      {children}
    </button>
  );
}

// ─── Anillo de preview ────────────────────────────────────────────────────────

function MacroRing({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const pct = Math.min((value / max) * 100, 100);
  const r = 20;
  const circ = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="52" height="52" viewBox="0 0 52 52">
        <circle cx="26" cy="26" r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-muted/40" />
        <circle
          cx="26" cy="26" r={r} fill="none" stroke="currentColor" strokeWidth="5"
          strokeDasharray={circ} strokeDashoffset={circ - (circ * pct) / 100}
          strokeLinecap="round" className={color}
          transform="rotate(-90 26 26)"
          style={{ transition: "stroke-dashoffset 0.6s ease-out" }}
        />
      </svg>
      <span className="text-xs font-semibold">{value}g</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

function targetToForm(t: ActiveTarget): FormData {
  return {
    weightKg: t.weightKg ? String(t.weightKg) : "",
    heightCm: t.heightCm ? String(t.heightCm) : "",
    ageYears: t.ageYears ? String(t.ageYears) : "",
    sex: (t.sex as FormData["sex"]) || "",
    activityLevel: t.activityLevel || "",
    goalMode: t.goalMode || "",
  };
}

export function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>({
    weightKg: "", heightCm: "", ageYears: "", sex: "",
    activityLevel: "", goalMode: "",
  });
  const [suggestion, setSuggestion] = useState<OnboardingSuggestion | null>(null);
  const [loadingSugg, setLoadingSugg] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Pre-rellenar con el target activo si ya se hizo onboarding antes
  useEffect(() => {
    onboardingApi.activeTarget()
      .then((t) => setForm(targetToForm(t)))
      .catch(() => { /* sin target previo, formulario vacío */ });
  }, []);

  function set(key: keyof FormData, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Precalcular sugerencia en el paso 3
  useEffect(() => {
    if (step !== 3) return;
    setLoadingSugg(true);
    onboardingApi.suggestion({
      weightKg: Number(form.weightKg),
      heightCm: Number(form.heightCm),
      ageYears: Number(form.ageYears),
      sex: form.sex,
      activityLevel: form.activityLevel,
      goalMode: form.goalMode,
    })
      .then(setSuggestion)
      .catch(() => setError("Error calculando los objetivos."))
      .finally(() => setLoadingSugg(false));
  }, [step]);  // eslint-disable-line react-hooks/exhaustive-deps

  async function handleConfirm() {
    setSaving(true);
    try {
      await onboardingApi.complete({
        weightKg: Number(form.weightKg),
        heightCm: Number(form.heightCm),
        ageYears: Number(form.ageYears),
        sex: form.sex,
        activityLevel: form.activityLevel,
        goalMode: form.goalMode,
      });
      // Recarga completa para que AuthGuard obtenga el perfil actualizado
      // (onboardingCompleted: true) desde la API
      window.location.replace("/");
    } catch {
      setError("Error guardando el onboarding. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  const goal = GOALS.find((g) => g.id === form.goalMode);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-5 pt-8 pb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-violet-700">
            <span className="text-xs font-bold text-white">BB</span>
          </div>
          <span className="font-semibold">BodyBuilder</span>
        </div>
        {/* Indicador de pasos */}
        <div className="flex gap-1.5">
          {[1, 2, 3].map((s) => (
            <div key={s} className={cn("h-1.5 w-6 rounded-full transition-colors", s <= step ? "bg-primary" : "bg-muted")} />
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pb-10 animate-fade-up">
        {/* ── Paso 1: Datos físicos ── */}
        {step === 1 && (
          <div className="space-y-6 max-w-md mx-auto pt-4">
            <div>
              <h2 className="text-2xl font-bold">Cuéntanos sobre ti</h2>
              <p className="mt-1 text-muted-foreground text-sm">Usamos estos datos para calcular tu gasto calórico exacto.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Peso (kg)</Label>
                <Input type="number" placeholder="75" value={form.weightKg} onChange={(e) => set("weightKg", e.target.value)} min={30} max={300} />
              </div>
              <div className="space-y-1.5">
                <Label>Altura (cm)</Label>
                <Input type="number" placeholder="175" value={form.heightCm} onChange={(e) => set("heightCm", e.target.value)} min={100} max={250} />
              </div>
              <div className="space-y-1.5">
                <Label>Edad</Label>
                <Input type="number" placeholder="28" value={form.ageYears} onChange={(e) => set("ageYears", e.target.value)} min={14} max={100} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Sexo biológico</Label>
              <div className="grid grid-cols-3 gap-2">
                {(["m", "f", "other"] as const).map((s) => (
                  <OptionCard key={s} selected={form.sex === s} onClick={() => set("sex", s)}>
                    <span className="text-sm font-medium block text-center">
                      {s === "m" ? "Hombre" : s === "f" ? "Mujer" : "Otro"}
                    </span>
                  </OptionCard>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              className="w-full"
              onClick={() => { setError(""); setStep(2); }}
              disabled={!form.weightKg || !form.heightCm || !form.ageYears || !form.sex}
            >
              Siguiente
            </Button>
          </div>
        )}

        {/* ── Paso 2: Actividad y objetivo ── */}
        {step === 2 && (
          <div className="space-y-6 max-w-md mx-auto pt-4">
            <div>
              <h2 className="text-2xl font-bold">Tu estilo de vida</h2>
              <p className="mt-1 text-muted-foreground text-sm">Sé honesto: usamos esto para calcular tu TDEE.</p>
            </div>

            <div className="space-y-2">
              <Label>Nivel de actividad</Label>
              <div className="space-y-2">
                {ACTIVITIES.map((a) => (
                  <OptionCard key={a.id} selected={form.activityLevel === a.id} onClick={() => set("activityLevel", a.id)}>
                    <span className="text-sm font-semibold">{a.label}</span>
                    <span className="text-xs text-muted-foreground block mt-0.5">{a.desc}</span>
                  </OptionCard>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Objetivo principal</Label>
              <div className="space-y-2">
                {GOALS.map((g) => (
                  <OptionCard key={g.id} selected={form.goalMode === g.id} onClick={() => set("goalMode", g.id)}>
                    <span className={cn("text-sm font-semibold", g.color)}>{g.label}</span>
                    <span className="text-xs text-muted-foreground block mt-0.5">{g.desc}</span>
                  </OptionCard>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>Atrás</Button>
              <Button
                className="flex-1"
                onClick={() => setStep(3)}
                disabled={!form.activityLevel || !form.goalMode}
              >
                Ver mis objetivos
              </Button>
            </div>
          </div>
        )}

        {/* ── Paso 3: Preview y confirmación ── */}
        {step === 3 && (
          <div className="space-y-6 max-w-md mx-auto pt-4">
            <div>
              <h2 className="text-2xl font-bold">Tus objetivos diarios</h2>
              <p className="mt-1 text-muted-foreground text-sm">
                Calculados con Mifflin-St Jeor.{" "}
                {goal && <span className={cn("font-medium", goal.color)}>{goal.label}</span>}
              </p>
            </div>

            {loadingSugg ? (
              <div className="flex justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : suggestion ? (
              <>
                {/* Kcal hero */}
                <div className="rounded-2xl border border-border bg-card p-6 text-center">
                  <p className="text-sm text-muted-foreground mb-1">Calorías diarias</p>
                  <p className="text-5xl font-bold bg-gradient-to-r from-violet-400 to-violet-600 bg-clip-text text-transparent">
                    {suggestion.kcalTarget}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    TDEE: {suggestion.tdee} kcal · BMR: {suggestion.bmr} kcal
                  </p>
                  <div className="mt-3 flex items-center justify-center gap-1 text-xs text-muted-foreground">
                    <span className="rounded-full bg-green-500/10 text-green-400 px-2 py-0.5">
                      Zona verde: {suggestion.kcalRangeMin}–{suggestion.kcalRangeMax} kcal
                    </span>
                  </div>
                </div>

                {/* Macros */}
                <div className="rounded-2xl border border-border bg-card p-5">
                  <p className="text-sm text-muted-foreground mb-4">Distribución de macros</p>
                  <div className="flex justify-around">
                    <MacroRing value={suggestion.proteinMinG} max={suggestion.proteinMinG} color="text-blue-400" label="Proteína" />
                    <MacroRing value={suggestion.carbsG} max={suggestion.carbsG} color="text-violet-400" label="Carbos" />
                    <MacroRing value={Math.round((suggestion.fatMinG + suggestion.fatMaxG) / 2)} max={suggestion.fatMaxG} color="text-orange-400" label="Grasas" />
                  </div>
                  <div className="mt-4 space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-blue-400">Proteína mín.</span>
                      <span className="font-medium">{suggestion.proteinMinG} g</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-violet-400">Carbohidratos</span>
                      <span className="font-medium">{suggestion.carbsG} g</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-orange-400">Grasas</span>
                      <span className="font-medium">{suggestion.fatMinG}–{suggestion.fatMaxG} g</span>
                    </div>
                  </div>
                </div>

                {/* NEAT */}
                <div className="rounded-xl border border-border bg-card/50 px-4 py-3 flex items-center gap-3 text-sm">
                  <span className="text-2xl">🚶</span>
                  <div>
                    <span className="font-medium">Objetivo NEAT sugerido: </span>
                    <span className="text-primary font-semibold">{suggestion.neatSuggestedSteps.toLocaleString()} pasos/día</span>
                    <p className="text-xs text-muted-foreground mt-0.5">Actividad no programada para tu metabolismo</p>
                  </div>
                </div>
              </>
            ) : null}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(2)}>Cambiar</Button>
              <Button className="flex-1" onClick={handleConfirm} disabled={saving || loadingSugg}>
                {saving ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                    Guardando…
                  </span>
                ) : "¡Empezar!"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
