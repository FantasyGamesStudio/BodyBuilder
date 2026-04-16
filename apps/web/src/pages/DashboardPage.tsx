import { Bot, Camera, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Dumbbell, Image, Mic, MicOff, Plus, Send, Star, Trash2, X } from "lucide-react";
import { compressImage } from "@/lib/image";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MarkdownText } from "@/components/ui/markdown-text";
import { advisorApi, mealsApi, onboardingApi, workoutsApi, type ActiveTarget, type AdvisorAddedEntry, type AdvisorMessage, type DayResponse, type MealEntry, type MonthDaySummary, type MonthResponse, type RecurringFood, type WeekDaySummary, type WeekResponse, type WorkoutLog } from "@/lib/api";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayISO() {
  return new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD en local
}

function offsetDate(base: string, days: number): string {
  const d = new Date(base + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("sv-SE");
}

function formatDate(iso: string) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
}

function getMondayISO(dateISO: string): string {
  const d = new Date(dateISO + "T12:00:00");
  const day = d.getDay(); // 0 = domingo
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toLocaleDateString("sv-SE");
}

function offsetWeek(mondayISO: string, weeks: number): string {
  const d = new Date(mondayISO + "T12:00:00");
  d.setDate(d.getDate() + weeks * 7);
  return d.toLocaleDateString("sv-SE");
}

function formatWeekRange(weekStart: string, weekEnd: string): string {
  const s = new Date(weekStart + "T12:00:00");
  const e = new Date(weekEnd + "T12:00:00");
  const sDay = s.getDate();
  const eDay = e.getDate();
  const eMonth = e.toLocaleDateString("es-ES", { month: "short" });
  const eYear = e.getFullYear();
  const sMonth = s.getMonth() === e.getMonth() ? "" : ` ${s.toLocaleDateString("es-ES", { month: "short" })}`;
  return `${sDay}${sMonth} – ${eDay} ${eMonth} ${eYear}`;
}

const WEEK_DAY_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

// ─── Anillo de calorías ───────────────────────────────────────────────────────

function CalorieRing({
  consumed,
  target,
  rangeMin,
  rangeMax,
  status,
}: {
  consumed: number;
  target: number;
  rangeMin?: number;
  rangeMax?: number;
  status: "green" | "yellow" | "red";
}) {
  const noData = consumed === 0;
  const pct = target > 0 ? Math.min((consumed / target) * 100, 110) : 0;
  const r = 68;
  const circ = 2 * Math.PI * r;
  const arcColor =
    status === "green" ? "#22c55e" : status === "yellow" ? "#eab308" : "#ef4444";

  return (
    <div className="relative flex h-48 w-48 items-center justify-center">
      <svg width="192" height="192" viewBox="0 0 192 192" className="-rotate-90">
        <circle cx="96" cy="96" r={r} fill="none" stroke="currentColor" strokeWidth="10" className="text-muted/55" />
        {!noData && (
          <circle
            cx="96" cy="96" r={r} fill="none"
            stroke={arcColor} strokeWidth="10"
            strokeDasharray={circ}
            strokeDashoffset={circ - (circ * pct) / 100}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.7s cubic-bezier(0.4,0,0.2,1), stroke 0.3s" }}
          />
        )}
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-4xl font-bold tabular-nums">{consumed}</span>
        {rangeMin && rangeMax ? (
          <span className="text-xs text-muted-foreground tabular-nums">{rangeMin}–{rangeMax} kcal</span>
        ) : (
          <span className="text-xs text-muted-foreground">de {target} kcal</span>
        )}
        {noData ? (
          <span className="mt-1 text-xs font-medium px-2 py-0.5 rounded-full bg-muted/30 text-muted-foreground">
            Sin registros
          </span>
        ) : (
          <span className={cn(
            "mt-1 text-xs font-medium px-2 py-0.5 rounded-full",
            status === "green" ? "bg-green-500/15 text-green-400" :
            status === "yellow" ? "bg-yellow-500/15 text-yellow-400" :
            "bg-red-500/15 text-red-400",
          )}>
            {status === "green" ? "En objetivo" : status === "yellow" ? "Cerca del rango" : "Fuera de rango"}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Anillo de macro ──────────────────────────────────────────────────────────

function MacroRing({
  label,
  value,
  target,
  targetLabel,
  color,
}: {
  label: string;
  value: number;
  target: number;
  targetLabel?: string;
  color: string; // hex color
}) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const pct = target > 0 ? Math.min((value / target) * 100, 100) : 0;
  const offset = circ - (circ * pct) / 100;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative flex items-center justify-center" style={{ width: 72, height: 72 }}>
        <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
          <circle cx="36" cy="36" r={r} fill="none" stroke="currentColor" strokeWidth="6"
            className="text-muted/55" />
          <circle
            cx="36" cy="36" r={r} fill="none"
            stroke={color} strokeWidth="6"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.7s cubic-bezier(0.4,0,0.2,1)" }}
          />
        </svg>
        <div className="absolute flex flex-col items-center leading-none">
          <span className="text-sm font-bold tabular-nums">{value}</span>
          <span className="text-[9px] text-muted-foreground">g</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-[11px] font-medium" style={{ color }}>{label}</p>
        <p className="text-[10px] text-muted-foreground tabular-nums">{targetLabel ?? `${target}g`}</p>
      </div>
    </div>
  );
}

// ─── Slot de comida ───────────────────────────────────────────────────────────

const SLOT_LABELS: Record<string, string> = {
  breakfast: "Desayuno",
  lunch: "Comida",
  dinner: "Cena",
  snack: "Snack",
  other: "Otro",
};

// Distribución calórica estimada por slot (% del total diario)
const SLOT_KCAL_PCT: Record<string, number> = {
  breakfast: 0.25,
  lunch: 0.35,
  dinner: 0.30,
  snack: 0.10,
  other: 0.10,
};

// Icono SVG por slot como arco de progreso circular
function SlotArc({ consumed, target, color }: { consumed: number; target: number; color: string }) {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const pct = target > 0 ? Math.min(consumed / target, 1) : 0;
  return (
    <div className="relative flex h-11 w-11 shrink-0 items-center justify-center">
      <svg width="44" height="44" viewBox="0 0 44 44" className="-rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeWidth="3.5" className="text-muted/25" />
        {consumed > 0 && (
          <circle
            cx="22" cy="22" r={r} fill="none"
            stroke={color} strokeWidth="3.5"
            strokeDasharray={circ}
            strokeDashoffset={circ - circ * pct}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.4,0,0.2,1)" }}
          />
        )}
      </svg>
    </div>
  );
}

// Bloque único de slots estilo Yazio
function MealSlotsBlock({
  slots,
  bySlot,
  date,
  kcalTarget,
}: {
  slots: string[];
  bySlot: Record<string, MealEntry[]>;
  date: string;
  kcalTarget: number;
}) {
  const SLOT_COLORS: Record<string, string> = {
    breakfast: "#f59e0b",
    lunch:     "#3b82f6",
    dinner:    "#8b5cf6",
    snack:     "#10b981",
    other:     "#6b7280",
  };

  return (
    <Card className="overflow-hidden divide-y divide-border/50">
      {slots.map((slot) => {
        const entries = bySlot[slot] ?? [];
        const consumed = entries.reduce((s, e) => s + e.kcal, 0);
        const slotTarget = kcalTarget > 0 ? Math.round(kcalTarget * (SLOT_KCAL_PCT[slot] ?? 0.1)) : 0;
        const color = SLOT_COLORS[slot] ?? "#6b7280";
        const label = SLOT_LABELS[slot] ?? slot;

        return (
          <Link
            key={slot}
            to={`/log?date=${date}&slot=${slot}`}
            className="flex items-center gap-3 px-4 py-3 hover:bg-white/3 transition-colors"
          >
            <SlotArc consumed={consumed} target={slotTarget} color={color} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-none">{label}</p>
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {consumed > 0 ? (
                  <><span style={{ color }}>{consumed}</span>{slotTarget > 0 ? ` / ${slotTarget}` : ""} kcal</>
                ) : (
                  <span>{slotTarget > 0 ? `0 / ${slotTarget} kcal` : "Sin registros"}</span>
                )}
              </p>
            </div>
            <div className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm shadow-primary/30 hover:bg-primary/90 transition-colors">
              <Plus className="h-4 w-4" />
            </div>
          </Link>
        );
      })}
    </Card>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

// ─── Actividades predefinidas para estimar kcal ───────────────────────────────

const ACTIVITIES = [
  { id: "weights",  label: "Pesas",        icon: "🏋️", kcalPerMin: 6 },
  { id: "running",  label: "Running",      icon: "🏃", kcalPerMin: 10 },
  { id: "hiit",     label: "HIIT",         icon: "⚡", kcalPerMin: 12 },
  { id: "cycling",  label: "Ciclismo",     icon: "🚴", kcalPerMin: 8 },
  { id: "swimming", label: "Natación",     icon: "🏊", kcalPerMin: 9 },
  { id: "walking",  label: "Caminar",      icon: "🚶", kcalPerMin: 4 },
  { id: "sport",    label: "Deporte",      icon: "⚽", kcalPerMin: 9 },
  { id: "yoga",     label: "Yoga",         icon: "🧘", kcalPerMin: 3 },
  { id: "cardio",   label: "Cardio",       icon: "❤️", kcalPerMin: 8 },
  { id: "custom",   label: "Otro",         icon: "✏️", kcalPerMin: 0 },
] as const;

// ─── Formulario de entreno ────────────────────────────────────────────────────

function WorkoutForm({ date, onSave }: { date: string; onSave: (w: WorkoutLog) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"plan" | "done">("plan");
  const [activityId, setActivityId] = useState<string>("");
  const [minutes, setMinutes] = useState("45");
  const [kcalOverride, setKcalOverride] = useState("");
  const [plannedTime, setPlannedTime] = useState("18:00");
  const [saving, setSaving] = useState(false);

  const activity = ACTIVITIES.find((a) => a.id === activityId);
  const estimatedKcal = activity && activity.kcalPerMin > 0
    ? Math.round(activity.kcalPerMin * Number(minutes || 0))
    : 0;
  const kcalFinal = kcalOverride ? Number(kcalOverride) : estimatedKcal;

  function reset() {
    setActivityId(""); setMinutes("45"); setKcalOverride(""); setOpen(false);
  }

  async function handleSave() {
    if (mode === "done" && (!kcalFinal || kcalFinal < 1)) return;
    if (mode === "plan" && !activityId) return;
    setSaving(true);
    try {
      const notes = activity ? `${activity.label}${minutes ? ` · ${minutes} min` : ""}` : undefined;
      if (mode === "plan") {
        const w = await workoutsApi.log({
          workoutDate: date,
          kcalBurned: 0,
          notes,
          status: "planned",
          plannedAt: plannedTime,
        });
        onSave(w);
      } else {
        const w = await workoutsApi.log({
          workoutDate: date,
          kcalBurned: kcalFinal,
          notes,
          status: "done",
        });
        onSave(w);
      }
      reset();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setMode("plan"); setOpen(true); }}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <Dumbbell className="h-3.5 w-3.5" />
          Planificar entreno
        </button>
        <span className="text-muted-foreground/30 text-xs">·</span>
        <button
          onClick={() => { setMode("done"); setOpen(true); }}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Registrar ya hecho
        </button>
      </div>
    );
  }

  return (
    <Card className="border-border/60">
      <CardContent className="pt-4 pb-4 space-y-4">
        {/* Toggle plan/done */}
        <div className="flex items-center gap-1 bg-muted/30 rounded-xl p-1 self-start">
          {(["plan", "done"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-semibold transition-all",
                mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "plan" ? "Planificar" : "Ya lo hice"}
            </button>
          ))}
        </div>

        {/* Hora planificada (solo en modo plan) */}
        {mode === "plan" && (
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1.5">Hora aproximada</p>
              <Input
                type="time"
                value={plannedTime}
                onChange={(e) => setPlannedTime(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="pt-5 flex items-center gap-1.5 text-[11px] text-primary/80 bg-primary/10 rounded-xl px-3 py-2">
              <Dumbbell className="h-3 w-3 shrink-0" />
              <span>El asesor usará<br/>esta info hoy</span>
            </div>
          </div>
        )}

        {/* Selector de actividad */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">
            {mode === "plan" ? "¿Qué vas a hacer?" : "¿Qué has hecho?"}
          </p>
          <div className="grid grid-cols-5 gap-1.5">
            {ACTIVITIES.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => { setActivityId(a.id); setKcalOverride(""); }}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl p-2 text-center transition-all",
                  activityId === a.id
                    ? "bg-primary/15 ring-1 ring-primary"
                    : "bg-muted/30 hover:bg-muted/60",
                )}
              >
                <span className="text-lg leading-none">{a.icon}</span>
                <span className="text-[10px] leading-tight text-muted-foreground">{a.label}</span>
              </button>
            ))}
          </div>
        </div>

        {activityId && (
          <>
            {/* Duración */}
            {activity?.kcalPerMin !== undefined && activity.kcalPerMin > 0 && (
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground mb-1.5">Duración (minutos)</p>
                  <Input
                    type="number"
                    value={minutes}
                    onChange={(e) => { setMinutes(e.target.value); setKcalOverride(""); }}
                    className="h-9"
                    min={1} max={480}
                  />
                </div>
                {mode === "done" && (
                  <div className="text-center pt-5">
                    <p className="text-2xl font-bold text-green-400 tabular-nums">{estimatedKcal}</p>
                    <p className="text-[10px] text-muted-foreground">kcal est.</p>
                  </div>
                )}
              </div>
            )}

            {/* Override kcal solo en modo done */}
            {mode === "done" && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">
                  {activity?.kcalPerMin ? "¿Sabes las kcal exactas? (opcional)" : "kcal quemadas"}
                </p>
                <Input
                  type="number"
                  placeholder={activity?.kcalPerMin ? String(estimatedKcal) : "ej. 350"}
                  value={kcalOverride}
                  onChange={(e) => setKcalOverride(e.target.value)}
                  className="h-9"
                  min={1} max={5000}
                />
              </div>
            )}

            {/* Acciones */}
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                onClick={handleSave}
                disabled={saving || (mode === "done" && !kcalFinal)}
              >
                {saving ? "Guardando…"
                  : mode === "plan" ? "Planificar entreno"
                  : `Guardar · ${kcalFinal} kcal`}
              </Button>
              <Button variant="outline" size="sm" onClick={reset}>Cancelar</Button>
            </div>
          </>
        )}

        {/* CTA si solo eligió hora pero no actividad en modo plan */}
        {mode === "plan" && !activityId && (
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={handleSave} disabled={saving}>
              {saving ? "Guardando…" : "Solo marcar que entreno"}
            </Button>
            <Button variant="outline" size="sm" onClick={reset}>Cancelar</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Asesor integrado ─────────────────────────────────────────────────────────

const SLOT_ES_ADVISOR: Record<string, string> = {
  breakfast: "Desayuno", lunch: "Comida", dinner: "Cena", snack: "Snack", other: "Otro",
};

type PendingImage = { base64: string; mimeType: string; preview: string };

type ChatEntry = {
  message: AdvisorMessage;
  addedEntries?: AdvisorAddedEntry[];
};

function AdvisorInline({
  date,
  onEntriesAdded,
  onRecurringChange,
}: {
  date: string;
  onEntriesAdded: () => void;
  onRecurringChange: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);
  const [markedIds, setMarkedIds] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const cancelRecordingRef = useRef(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Cargar historial al montar o cambiar de día
  useEffect(() => {
    advisorApi.history(date)
      .then((res) => setChatEntries(res.messages.map((m) => ({ message: m }))))
      .catch((err) => console.error("Error cargando historial del asesor:", err));
  }, [date]);

  // Auto-scroll al fondo dentro del contenedor del chat (sin arrastrar la página)
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }, [chatEntries, sending]);

  async function send(opts: { text?: string; images?: PendingImage[] }) {
    if (sending) return;
    setSending(true);

    const displayText = opts.text || (opts.images && opts.images.length > 0 ? "📷 Foto enviada" : "");
    const tempUserMsg: AdvisorMessage = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: displayText,
      createdAt: new Date().toISOString(),
    };
    setChatEntries((prev) => [...prev, { message: tempUserMsg }]);
    setText("");
    setPendingImages([]);

    try {
      const apiImages = (opts.images ?? []).map((img) => ({ imageBase64: img.base64, mimeType: img.mimeType }));
      const res = await advisorApi.message(date, {
        text: opts.text,
        images: apiImages.length > 0 ? apiImages : undefined,
      });

      const assistantMsg: AdvisorMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: res.reply,
        createdAt: new Date().toISOString(),
      };

      setChatEntries((prev) => [
        ...prev.slice(0, -1),
        { message: { ...tempUserMsg, content: res.transcription ?? displayText } },
        { message: assistantMsg, addedEntries: res.addedEntries },
      ]);

      setTimeout(() => onEntriesAdded(), 300);
    } catch {
      setChatEntries((prev) => [
        ...prev.slice(0, -1),
        { message: tempUserMsg },
        { message: { id: `err-${Date.now()}`, role: "assistant", content: "Ha ocurrido un error. Inténtalo de nuevo.", createdAt: "" } },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleSend() {
    if (recording) { stopAndTranscribe(); return; }
    const hasContent = text.trim() || pendingImages.length > 0;
    if (!hasContent || busy) return;
    send({ text: text.trim() || undefined, images: pendingImages });
  }

  // ── Micrófono ─────────────────────────────────────────────────────────────

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const mr = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      cancelRecordingRef.current = false;
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (cancelRecordingRef.current) return;
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const reader = new FileReader();
        reader.onloadend = async () => {
          setTranscribing(true);
          try {
            const base64 = (reader.result as string).split(",")[1];
            const { text: transcribed } = await advisorApi.transcribe(base64, mimeType);
            setText(transcribed);
            setTimeout(() => textareaRef.current?.focus(), 50);
          } catch {
            setText("");
          } finally {
            setTranscribing(false);
          }
        };
        reader.readAsDataURL(blob);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch { alert("No se pudo acceder al micrófono."); }
  }

  function cancelRecording() {
    cancelRecordingRef.current = true;
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  function stopAndTranscribe() {
    cancelRecordingRef.current = false;
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  // ── Imágenes ──────────────────────────────────────────────────────────────

  function addFilesToQueue(files: FileList | null) {
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      compressImage(file).then((img) => {
        setPendingImages((prev) => [...prev, img]);
      }).catch(() => {/* imagen inválida, ignorar */});
    });
  }

  function handleCameraChange(e: React.ChangeEvent<HTMLInputElement>) {
    addFilesToQueue(e.target.files);
    e.target.value = "";
  }

  function handleGalleryChange(e: React.ChangeEvent<HTMLInputElement>) {
    addFilesToQueue(e.target.files);
    e.target.value = "";
  }

  function removeImage(idx: number) {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── Estrella ──────────────────────────────────────────────────────────────

  async function handleMarkRecurring(entry: AdvisorAddedEntry) {
    if (markedIds.has(entry.id)) return;
    await advisorApi.markRecurring(entry.id).catch(() => {});
    setMarkedIds((p) => new Set([...p, entry.id]));
    onRecurringChange();
  }

  const busy = sending || transcribing;
  const canSend = recording || text.trim().length > 0 || pendingImages.length > 0;

  return (
    <div className="space-y-3">

      {/* Historial de conversación */}
      {chatEntries.length > 0 && (
        <div ref={messagesContainerRef} className="space-y-3 max-h-96 overflow-y-auto pr-1">
          {chatEntries.map((entry) => {
            const isUser = entry.message.role === "user";
            return (
              <div key={entry.message.id} className={cn("flex flex-col gap-1.5", isUser ? "items-end" : "items-start")}>
                <div className={cn(
                  "max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                  isUser
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-card border border-border/60 text-foreground rounded-bl-sm",
                )}>
                  {isUser ? entry.message.content : <MarkdownText text={entry.message.content} />}
                </div>
                {entry.addedEntries && entry.addedEntries.length > 0 && (
                  <div className="w-full max-w-sm space-y-1.5">
                    {entry.addedEntries.map((e) => (
                      <div key={e.id} className="flex items-center justify-between bg-green-500/8 border border-green-500/20 rounded-xl px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-green-400 truncate">{e.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {SLOT_ES_ADVISOR[e.mealSlot] ?? e.mealSlot} · {e.kcal} kcal · P:{e.proteinG.toFixed(0)}g C:{e.carbsG.toFixed(0)}g G:{e.fatG.toFixed(0)}g
                          </p>
                        </div>
                        <button
                          onClick={() => handleMarkRecurring(e)}
                          title="Guardar como recurrente"
                          className={cn("ml-2 shrink-0 p-1 transition-colors", markedIds.has(e.id) ? "text-yellow-400" : "text-muted-foreground hover:text-yellow-400")}
                        >
                          <Star className={cn("h-3.5 w-3.5", markedIds.has(e.id) && "fill-yellow-400")} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {sending && (
            <div className="flex items-start">
              <div className="bg-card border border-border/60 rounded-2xl rounded-bl-sm px-4 py-3">
                <div className="flex gap-1 items-center h-4">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}
      {chatEntries.length === 0 && !sending && (
        <p className="text-xs text-muted-foreground text-center py-2">Cuéntame qué has comido o pídeme consejo</p>
      )}

      {/* Input */}
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleCameraChange} />
      <input ref={galleryInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleGalleryChange} />
      <div className={cn(
        "flex flex-col rounded-2xl border bg-card transition-colors",
        recording ? "border-red-500/50 bg-red-500/5" : "border-border/60 focus-within:border-primary/60",
      )}>
        {/* Miniaturas de imágenes pendientes */}
        {pendingImages.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative shrink-0">
                <img src={img.preview} alt="" className="h-16 w-16 rounded-lg object-cover border border-border/40" />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-background border border-border/60 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder={
            recording ? "Grabando… pulsa Enviar para transcribir o el micrófono para cancelar"
            : transcribing ? "Transcribiendo audio…"
            : "¿Qué has comido? Escribe, graba o añade fotos…"
          }
          disabled={busy || recording}
          rows={2}
          className={cn(
            "w-full resize-none bg-transparent px-4 pt-3 pb-1",
            "text-sm placeholder:text-muted-foreground focus:outline-none leading-relaxed",
            "disabled:opacity-50 min-h-[3.5rem] max-h-32",
          )}
          onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = `${Math.min(t.scrollHeight, 128)}px`; }}
        />
        <div className="flex items-center gap-1 px-2 pb-2 pt-1">
          {/* Galería (múltiple) */}
          <button
            onClick={() => galleryInputRef.current?.click()}
            disabled={busy || recording}
            title="Elegir de la galería"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
          >
            <Image className="h-4 w-4" />
          </button>
          {/* Cámara */}
          <button
            onClick={() => cameraInputRef.current?.click()}
            disabled={busy || recording}
            title="Hacer foto"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
          >
            <Camera className="h-4 w-4" />
          </button>
          {/* Micrófono */}
          <button
            onClick={recording ? cancelRecording : startRecording}
            disabled={busy}
            title={recording ? "Cancelar grabación" : "Grabar audio"}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-xl transition-colors disabled:opacity-40",
              recording ? "text-red-400 bg-red-500/10 animate-pulse" : "text-muted-foreground hover:text-primary hover:bg-primary/10",
            )}
          >
            {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
          <div className="flex-1" />
          {/* Enviar */}
          <button
            onClick={handleSend}
            disabled={!canSend || busy}
            className="flex items-center gap-2 h-9 px-4 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            {busy
              ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
              : <Send className="h-3.5 w-3.5" />}
            {!busy && <span>{recording ? "Transcribir" : "Enviar"}</span>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Vista mensual ────────────────────────────────────────────────────────────

const MONTH_NAMES_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DAY_HEADERS = ["L","M","X","J","V","S","D"];

function MonthlyView({
  yearMonth,
  onSelectDay,
}: {
  yearMonth: string;
  onSelectDay: (date: string) => void;
}) {
  const [data, setData] = useState<MonthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const today = todayISO();

  useEffect(() => {
    setLoading(true);
    mealsApi.month(yearMonth)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [yearMonth]);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const [year, month] = yearMonth.split("-").map(Number);
  // Día de la semana del primer día (0=dom…6=sáb → convertimos a lun=0)
  const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();

  const byDate = new Map<string, MonthDaySummary>();
  for (const d of data?.days ?? []) byDate.set(d.date, d);

  // Contar estadísticas del mes
  const recorded = data?.days.filter((d) => d.hasData).length ?? 0;
  const green = data?.days.filter((d) => d.status === "green").length ?? 0;
  const yellow = data?.days.filter((d) => d.status === "yellow").length ?? 0;
  const red = data?.days.filter((d) => d.status === "red").length ?? 0;
  const past = data?.days.filter((d) => d.date <= today).length ?? 0;

  // Construir grid: celdas vacías + días del mes
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Rellenar hasta múltiplo de 7
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="max-w-lg mx-auto px-4 pt-5 space-y-5">

      {/* Resumen del mes */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground">{recorded} de {past} días registrados</p>
            <div className="flex items-center gap-2">
              {green > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium">{green} objetivo</span>}
              {yellow > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 font-medium">{yellow} cerca</span>}
              {red > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-medium">{red} fuera</span>}
            </div>
          </div>

          {/* Cabeceras de días */}
          <div className="grid grid-cols-7 mb-1">
            {DAY_HEADERS.map((h) => (
              <div key={h} className="text-center text-[10px] font-semibold text-muted-foreground/60 py-1">{h}</div>
            ))}
          </div>

          {/* Celdas del calendario */}
          <div className="grid grid-cols-7 gap-y-1">
            {cells.map((day, i) => {
              if (day === null) return <div key={`empty-${i}`} />;

              const dateStr = `${yearMonth}-${String(day).padStart(2, "0")}`;
              const summary = byDate.get(dateStr);
              const isToday = dateStr === today;
              const isFuture = dateStr > today;

              const dotColor = isFuture ? null
                : !summary?.hasData ? "bg-muted-foreground/20"
                : summary.status === "green" ? "bg-green-500"
                : summary.status === "yellow" ? "bg-yellow-500"
                : "bg-red-500";

              return (
                <button
                  key={dateStr}
                  onClick={() => !isFuture && onSelectDay(dateStr)}
                  disabled={isFuture}
                  className={cn(
                    "flex flex-col items-center justify-center py-1.5 rounded-xl transition-colors",
                    !isFuture && "hover:bg-white/5 active:bg-white/10",
                    isToday && "bg-primary/10 ring-1 ring-primary/40",
                    isFuture && "opacity-30 cursor-default",
                  )}
                >
                  <span className={cn(
                    "text-[13px] font-medium tabular-nums leading-none",
                    isToday ? "text-primary" : "text-foreground",
                  )}>
                    {day}
                  </span>
                  <div className={cn(
                    "mt-1 h-1.5 w-1.5 rounded-full transition-colors",
                    dotColor ?? "opacity-0",
                  )} />
                </button>
              );
            })}
          </div>

          {/* Leyenda */}
          <div className="flex items-center justify-center gap-4 mt-3 pt-3 border-t border-border/30">
            {[
              { color: "bg-green-500", label: "En objetivo" },
              { color: "bg-yellow-500", label: "Cerca del rango" },
              { color: "bg-red-500", label: "Fuera de rango" },
              { color: "bg-muted-foreground/20", label: "Sin registros" },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className={cn("h-2 w-2 rounded-full shrink-0", color)} />
                <span className="text-[10px] text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Vista semanal ────────────────────────────────────────────────────────────

function WeeklyView({
  weekStart,
  onSelectDay,
}: {
  weekStart: string;
  onSelectDay: (date: string) => void;
}) {
  const [data, setData] = useState<WeekResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const today = todayISO();

  useEffect(() => {
    setLoading(true);
    mealsApi.week(weekStart)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [weekStart]);

  const daysWithData = data?.days.filter((d) => d.hasData).length ?? 0;
  const daysGreen = data?.days.filter((d) => d.hasData && d.progress?.kcalStatus === "green").length ?? 0;
  const daysYellow = data?.days.filter((d) => d.hasData && d.progress?.kcalStatus === "yellow").length ?? 0;
  const daysRed = data?.days.filter((d) => d.hasData && d.progress?.kcalStatus === "red").length ?? 0;
  const weekKcalTarget = (data?.target?.kcalTarget ?? 0) * 7;

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 space-y-5 pt-5">

      {/* ── Resumen de la semana ────────────────────────────────────────── */}
      <section>
        <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Resumen semanal
        </h2>
        <Card>
          <CardContent className="pt-5 pb-4 space-y-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-3xl font-bold tabular-nums">
                  {(data?.weekTotals.kcal ?? 0).toLocaleString("es-ES")}
                </p>
                <p className="text-xs text-muted-foreground">
                  kcal consumidas · objetivo {weekKcalTarget > 0 ? weekKcalTarget.toLocaleString("es-ES") : "—"}
                </p>
              </div>
              {weekKcalTarget > 0 && data && (
                <div className="text-right">
                  <p className="text-lg font-semibold tabular-nums">
                    {Math.round((data.weekTotals.kcal / weekKcalTarget) * 100)}%
                  </p>
                  <p className="text-xs text-muted-foreground">del objetivo</p>
                </div>
              )}
            </div>

            {weekKcalTarget > 0 && data && (
              <div className="w-full h-2 rounded-full bg-muted/30 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-700"
                  style={{ width: `${Math.min((data.weekTotals.kcal / weekKcalTarget) * 100, 100)}%` }}
                />
              </div>
            )}

            {data?.target && (
              <div className="grid grid-cols-3 gap-3 pt-1">
                {[
                  { label: "Proteína", value: Math.round(data.weekTotals.proteinG), weekTarget: data.target.proteinMinG * 7, color: "#60a5fa" },
                  { label: "Carbos", value: Math.round(data.weekTotals.carbsG), weekTarget: data.target.carbsG * 7, color: "#a78bfa" },
                  { label: "Grasas", value: Math.round(data.weekTotals.fatG), weekTarget: data.target.fatMaxG * 7, color: "#fb923c" },
                ].map(({ label, value, weekTarget, color }) => (
                  <div key={label} className="text-center space-y-1">
                    <p className="text-sm font-bold tabular-nums" style={{ color }}>{value}g</p>
                    <div className="w-full h-1.5 rounded-full bg-muted/30 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${Math.min((value / weekTarget) * 100, 100)}%`, backgroundColor: color }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <span className="text-xs text-muted-foreground">{daysWithData} de 7 días registrados</span>
              {daysGreen > 0 && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">
                  {daysGreen} en objetivo
                </span>
              )}
              {daysYellow > 0 && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400">
                  {daysYellow} cerca del rango
                </span>
              )}
              {daysRed > 0 && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">
                  {daysRed} fuera de rango
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── Días de la semana ──────────────────────────────────────────── */}
      <section className="pb-6">
        <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Días de la semana
        </h2>
        <Card>
          <CardContent className="pt-2 pb-2 divide-y divide-border/40">
            {(data?.days ?? []).map((day, idx) => (
              <WeekDayRow
                key={day.date}
                day={day}
                dayLabel={WEEK_DAY_SHORT[idx]}
                isToday={day.date === today}
                kcalDailyTarget={data?.target?.kcalTarget ?? 0}
                onSelect={() => onSelectDay(day.date)}
              />
            ))}
          </CardContent>
        </Card>
      </section>

    </div>
  );
}

function WeekDayRow({
  day,
  dayLabel,
  isToday,
  kcalDailyTarget,
  onSelect,
}: {
  day: WeekDaySummary;
  dayLabel: string;
  isToday: boolean;
  kcalDailyTarget: number;
  onSelect: () => void;
}) {
  const consumed = day.progress?.totals.kcal ?? 0;
  const target = day.kcalTarget || kcalDailyTarget;
  const pct = target > 0 ? Math.min((consumed / target) * 100, 100) : 0;
  const status = day.progress?.kcalStatus;
  const dateObj = new Date(day.date + "T12:00:00");
  const dayNum = dateObj.getDate();
  const monthShort = dateObj.toLocaleDateString("es-ES", { month: "short" });

  const dotColor =
    !day.hasData ? "bg-muted/40"
    : status === "green" ? "bg-green-400"
    : status === "yellow" ? "bg-yellow-400"
    : "bg-red-400";

  const barColor =
    status === "green" ? "#22c55e"
    : status === "yellow" ? "#eab308"
    : "#ef4444";

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full flex items-center gap-3 py-3 px-1 text-left transition-colors hover:bg-white/3 rounded-lg",
        isToday && "bg-primary/5",
      )}
    >
      {/* Día */}
      <div className="w-12 shrink-0">
        <p className={cn("text-xs font-semibold", isToday ? "text-primary" : "text-muted-foreground")}>
          {dayLabel}
        </p>
        <p className={cn("text-sm font-bold tabular-nums", isToday ? "text-primary" : "")}>
          {dayNum} <span className="text-xs font-normal text-muted-foreground">{monthShort}</span>
        </p>
        {isToday && <span className="text-[9px] text-primary font-medium leading-none">Hoy</span>}
      </div>

      {/* Barra + kcal */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="w-full h-2 rounded-full bg-muted/20 overflow-hidden">
          {day.hasData && (
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, backgroundColor: barColor }}
            />
          )}
        </div>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {day.hasData
            ? `${consumed} / ${target} kcal`
            : "Sin registros"}
        </p>
      </div>

      {/* Indicador estado */}
      <div className={cn("h-2.5 w-2.5 rounded-full shrink-0", dotColor)} />
    </button>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

function getCurrentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function offsetMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function DashboardPage() {
  const [view, setView] = useState<"day" | "week" | "month">("day");
  const [date, setDate] = useState(todayISO);
  const [weekStart, setWeekStart] = useState(() => getMondayISO(todayISO()));
  const [monthYear, setMonthYear] = useState(getCurrentYearMonth);
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [data, setData] = useState<DayResponse | null>(null);
  const [target, setTarget] = useState<ActiveTarget | null>(null);
  const [recurring, setRecurring] = useState<RecurringFood[]>([]);
  const [loading, setLoading] = useState(true);
  const today = todayISO();
  const isToday = date === today;
  const isCurrentWeek = weekStart === getMondayISO(today);

  useEffect(() => {
    onboardingApi.activeTarget()
      .then(setTarget)
      .catch(() => setTarget(null));
  }, []);

  useEffect(() => {
    advisorApi.recurring().then((r) => setRecurring(r.items)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    mealsApi.day(date)
      .then(setData)
      .finally(() => setLoading(false));
  }, [date]);

  function refreshDay() {
    mealsApi.day(date).then(setData).catch(() => {});
  }

  function refreshRecurring() {
    advisorApi.recurring().then((r) => setRecurring(r.items)).catch(() => {});
  }

  async function handleAddRecurring(food: RecurringFood) {
    await advisorApi.logRecurring(food.id, date).catch(() => {});
    refreshDay();
  }

  async function handleMarkRecurring(entryId: string) {
    await advisorApi.markRecurring(entryId).catch(() => {});
    refreshRecurring();
  }

  async function handleDeleteRecurring(id: string) {
    setRecurring((prev) => prev.filter((r) => r.id !== id));
    await advisorApi.deleteRecurring(id).catch(() => refreshRecurring());
  }

  async function handleDeleteMeal(id: string) {
    // Optimistic: quitar de UI inmediatamente
    setData((prev) => {
      if (!prev) return prev;
      const entries = prev.entries.filter((e) => e.id !== id);
      const bySlot = Object.fromEntries(
        Object.entries(prev.bySlot).map(([k, v]) => [k, v.filter((e) => e.id !== id)]),
      );
      return { ...prev, entries, bySlot };
    });
    try {
      await mealsApi.delete(id);
      // Refresco para que los totales del servidor estén en sincronía
      refreshDay();
    } catch {
      // Si falla, revertimos refrescando desde servidor
      refreshDay();
    }
  }

  async function handleDeleteWorkout(id: string) {
    await workoutsApi.delete(id);
    setData((prev) => {
      if (!prev) return prev;
      const workouts = prev.workouts.filter((w) => w.id !== id);
      const eatKcal = workouts.reduce((s, w) => s + w.kcalBurned, 0);
      return { ...prev, workouts, eatKcal };
    });
  }

  function handleAddWorkout(w: WorkoutLog) {
    setData((prev) => {
      if (!prev) return prev;
      const workouts = [...prev.workouts, w];
      const eatKcal = workouts.reduce((s, wl) => s + wl.kcalBurned, 0);
      return { ...prev, workouts, eatKcal };
    });
  }

  const p = data?.progress;
  const eatKcal = data?.eatKcal ?? 0;
  const slots = ["breakfast", "lunch", "dinner", "snack", "other"];

  // En volumen limpio el EAT no amplía el objetivo calórico (ya tiene un superávit planificado).
  // En el resto de objetivos (mantenimiento, definición, recomposición, pérdida de peso) sí.
  const goalMode = data?.goalMode ?? target?.goalMode ?? null;
  const eatCountsTowardTarget = goalMode !== "volumen_limpio";
  const effectiveKcalTarget = (target?.kcalTarget ?? 0) + (eatCountsTowardTarget ? eatKcal : 0);
  const consumed = p?.totals ?? { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 };
  const kcalStatus = p?.kcalStatus ?? "yellow";

  // Etiqueta de balance calórico para mostrar bajo el anillo
  const kcalBalance = consumed.kcal - effectiveKcalTarget;
  const balanceInfo: { label: string; detail: string; color: string } | null = (() => {
    if (!target || consumed.kcal === 0) return null;
    const abs = Math.abs(kcalBalance);
    if (goalMode === "volumen_limpio") {
      // Mostrar siempre el superávit/déficit respecto al target (EAT no modifica el target)
      if (kcalBalance >= 0) return { label: "Superávit", detail: `+${abs} kcal`, color: "text-blue-400" };
      return { label: "Déficit", detail: `-${abs} kcal`, color: "text-amber-400" };
    }
    if (goalMode === "mantenimiento") {
      if (kcalBalance > 50) return { label: "Superávit", detail: `+${abs} kcal`, color: "text-amber-400" };
      if (kcalBalance < -50) return { label: "Déficit", detail: `-${abs} kcal`, color: "text-amber-400" };
      return { label: "En balance", detail: `${kcalBalance > 0 ? "+" : ""}${kcalBalance} kcal`, color: "text-green-400" };
    }
    if (goalMode === "definicion" || goalMode === "perdida_peso") {
      if (kcalBalance < 0) return { label: "Déficit real", detail: `-${abs} kcal`, color: "text-green-400" };
      return { label: "Superávit", detail: `+${abs} kcal`, color: "text-red-400" };
    }
    if (goalMode === "recomposicion") {
      if (kcalBalance >= -50 && kcalBalance <= 50) return { label: "Balance neutro", detail: `${kcalBalance > 0 ? "+" : ""}${kcalBalance} kcal`, color: "text-green-400" };
      if (kcalBalance > 50) return { label: "Superávit", detail: `+${abs} kcal`, color: "text-amber-400" };
      return { label: "Déficit", detail: `-${abs} kcal`, color: "text-blue-400" };
    }
    return null;
  })();

  return (
    <div className="pb-24 md:pb-6">
      {/* ── Toggle Diario / Semana ──────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border/40 px-4 pt-3 pb-2">
        <div className="max-w-lg mx-auto flex flex-col gap-2">
          {/* Selector de vista */}
          <div className="flex items-center gap-1 bg-muted/30 rounded-xl p-1 self-center">
            {(["day", "week", "month"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "px-4 py-1.5 rounded-lg text-xs font-semibold transition-all",
                  view === v
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "day" ? "Diario" : v === "week" ? "Semana" : "Mes"}
              </button>
            ))}
          </div>

          {/* Cabecera de día (solo en vista diaria) */}
          {view === "day" && (
            <div className="flex items-center justify-between">
              <button onClick={() => setDate((d) => offsetDate(d, -1))} className="p-1.5 rounded-lg hover:bg-white/5 text-muted-foreground">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="text-center">
                <p className="text-sm font-semibold capitalize">{formatDate(date)}</p>
                {isToday && <span className="text-xs text-primary font-medium">Hoy</span>}
              </div>
              <button onClick={() => setDate((d) => offsetDate(d, 1))} disabled={isToday} className="p-1.5 rounded-lg hover:bg-white/5 text-muted-foreground disabled:opacity-30">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          )}

          {/* Cabecera de mes (solo en vista mensual) */}
          {view === "month" && (
            <div className="flex items-center justify-between">
              <button onClick={() => setMonthYear((m) => offsetMonth(m, -1))} className="p-1.5 rounded-lg hover:bg-white/5 text-muted-foreground">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="text-center">
                <p className="text-sm font-semibold capitalize">
                  {MONTH_NAMES_ES[parseInt(monthYear.split("-")[1]) - 1]} {monthYear.split("-")[0]}
                </p>
                {monthYear === getCurrentYearMonth() && <span className="text-xs text-primary font-medium">Este mes</span>}
              </div>
              <button
                onClick={() => setMonthYear((m) => offsetMonth(m, 1))}
                disabled={monthYear >= getCurrentYearMonth()}
                className="p-1.5 rounded-lg hover:bg-white/5 text-muted-foreground disabled:opacity-30"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          )}

          {/* Cabecera de semana (solo en vista semanal) */}
          {view === "week" && (
            <div className="flex items-center justify-between">
              <button onClick={() => setWeekStart((w) => offsetWeek(w, -1))} className="p-1.5 rounded-lg hover:bg-white/5 text-muted-foreground">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="text-center">
                <p className="text-sm font-semibold">
                  {formatWeekRange(weekStart, offsetDate(weekStart, 6))}
                </p>
                {isCurrentWeek && <span className="text-xs text-primary font-medium">Esta semana</span>}
              </div>
              <button onClick={() => setWeekStart((w) => offsetWeek(w, 1))} disabled={isCurrentWeek} className="p-1.5 rounded-lg hover:bg-white/5 text-muted-foreground disabled:opacity-30">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Vista mensual ──────────────────────────────────────────────────── */}
      {view === "month" && (
        <MonthlyView
          yearMonth={monthYear}
          onSelectDay={(d) => { setDate(d); setView("day"); }}
        />
      )}

      {/* ── Vista semanal ──────────────────────────────────────────────────── */}
      {view === "week" && (
        <WeeklyView
          weekStart={weekStart}
          onSelectDay={(d) => { setDate(d); setView("day"); }}
        />
      )}

      {/* ── Vista diaria ───────────────────────────────────────────────────── */}
      {view === "day" && loading ? (
        <div className="flex justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : view === "day" ? (
        <div className="max-w-lg mx-auto px-4 space-y-6 pt-5">

          {/* ── SECCIÓN 1: Resumen del día ────────────────────────────────── */}
          <section className="space-y-4">
            <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Resumen del día</h2>

            {/* Anillo + Macros — una sola card unificada */}
            {target ? (
              <Card>
                <CardContent className="pt-5 pb-4 space-y-4">
                  {/* Anillo de calorías */}
                  <div className="flex flex-col items-center">
                    <CalorieRing
                      consumed={consumed.kcal}
                      target={effectiveKcalTarget}
                      rangeMin={target ? Math.round(effectiveKcalTarget * (1 - target.kcalGreenPct / 100)) : undefined}
                      rangeMax={target ? Math.round(effectiveKcalTarget * (1 + target.kcalGreenPct / 100)) : undefined}
                      status={kcalStatus}
                    />
                    {eatKcal > 0 && (
                      <p className={cn(
                        "mt-1.5 text-xs font-medium",
                        eatCountsTowardTarget ? "text-green-400" : "text-muted-foreground",
                      )}>
                        {eatCountsTowardTarget
                          ? `+${eatKcal} kcal quemadas · objetivo ampliado`
                          : `${eatKcal} kcal quemadas · no modifica el objetivo`}
                      </p>
                    )}
                    {balanceInfo && (
                      <div className={cn("mt-1.5 flex items-center gap-1.5 text-xs font-semibold", balanceInfo.color)}>
                        <span>{balanceInfo.label}</span>
                        <span className="font-normal opacity-80">{balanceInfo.detail}</span>
                      </div>
                    )}
                  </div>

                  {/* Separador */}
                  <div className="border-t border-border/40" />

                  {/* Macros */}
                  <div className="flex items-start justify-around">
                    <MacroRing label="Proteína" value={Math.round(consumed.proteinG)} target={target.proteinMinG} color="#60a5fa" />
                    <MacroRing label="Carbos" value={Math.round(consumed.carbsG)} target={target.carbsG} color="#a78bfa" />
                    <MacroRing label="Grasas" value={Math.round(consumed.fatG)} target={target.fatMaxG} targetLabel={`${target.fatMinG}-${target.fatMaxG}g`} color="#fb923c" />
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="pt-5 text-center space-y-3">
                  <p className="text-sm">Configura tus objetivos para ver tu progreso</p>
                  <Button asChild size="sm"><Link to="/onboarding">Configurar objetivos</Link></Button>
                </CardContent>
              </Card>
            )}

            {/* Entrenamientos */}
            <div className="space-y-2">
              {(data?.workouts ?? []).map((w) => {
                const isPlanned = w.status === "planned";
                return (
                  <Card key={w.id} className={isPlanned ? "border-violet-500/25 bg-violet-500/5" : "border-green-500/20 bg-green-500/5"}>
                    <CardContent className="py-3 px-4 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <Dumbbell className={cn("h-4 w-4 shrink-0", isPlanned ? "text-violet-400" : "text-green-400")} />
                        <div>
                          {isPlanned ? (
                            <>
                              <p className="text-sm font-medium text-violet-400">
                                Entreno planificado{w.plannedAt ? ` · ${w.plannedAt}` : ""}
                              </p>
                              {w.notes && <p className="text-xs text-muted-foreground">{w.notes}</p>}
                              <p className="text-[10px] text-muted-foreground/70">El asesor lo tiene en cuenta</p>
                            </>
                          ) : (
                            <>
                              <p className="text-sm font-medium text-green-400">
                                {eatCountsTowardTarget ? `+${w.kcalBurned} kcal` : `${w.kcalBurned} kcal quemadas`}
                              </p>
                              {w.notes && <p className="text-xs text-muted-foreground">{w.notes}</p>}
                              {!eatCountsTowardTarget && (
                                <p className="text-[10px] text-muted-foreground/70">No amplía el objetivo en volumen</p>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <button onClick={() => handleDeleteWorkout(w.id)} className="text-muted-foreground hover:text-destructive transition-colors p-1">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </CardContent>
                  </Card>
                );
              })}
              <WorkoutForm date={date} onSave={handleAddWorkout} />
            </div>
          </section>

          {/* ── SECCIÓN 2: Asesor ─────────────────────────────────────────── */}
          <section>
            {/* Cabecera con toggle */}
            <button
              onClick={() => setAdvisorOpen((o) => !o)}
              className="w-full flex items-center gap-3 mb-3 group"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 shadow-md shadow-violet-500/25">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold leading-none">Asesor del día</h2>
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {advisorOpen ? "Toca para cerrar" : "Cuéntame qué has comido o pídeme consejo"}
                </p>
              </div>
              <div className={cn(
                "shrink-0 flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-all",
                "group-hover:bg-white/5 group-hover:text-foreground",
              )}>
                {advisorOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </button>

            {/* Panel colapsable */}
            {advisorOpen && (
              <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-3">
                <AdvisorInline date={date} onEntriesAdded={refreshDay} onRecurringChange={refreshRecurring} />
                {/* Botón de cierre inferior */}
                <button
                  onClick={() => setAdvisorOpen(false)}
                  className="w-full flex items-center justify-center gap-1.5 pt-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                  Cerrar asesor
                </button>
              </div>
            )}
          </section>

          {/* ── SECCIÓN 3: Registros de comida ───────────────────────────── */}
          <section className="space-y-3">
            <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Registros del día</h2>
            <MealSlotsBlock
              slots={slots}
              bySlot={data?.bySlot ?? {}}
              date={date}
              kcalTarget={effectiveKcalTarget}
            />
          </section>

        </div>
      ) : null}
    </div>
  );
}
