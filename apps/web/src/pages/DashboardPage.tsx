import { Bot, Camera, ChevronLeft, ChevronRight, Dumbbell, Image, Mic, MicOff, Plus, Send, Star, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { advisorApi, mealsApi, onboardingApi, workoutsApi, type ActiveTarget, type AdvisorAddedEntry, type AdvisorMessage, type DayResponse, type MealEntry, type RecurringFood, type WeekDaySummary, type WeekResponse, type WorkoutLog } from "@/lib/api";
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
  status,
}: {
  consumed: number;
  target: number;
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
        <circle cx="96" cy="96" r={r} fill="none" stroke="currentColor" strokeWidth="10" className="text-muted/20" />
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
        <span className="text-xs text-muted-foreground">de {target} kcal</span>
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
            {status === "green" ? "En objetivo" : status === "yellow" ? "Fuera de rango" : "Muy lejos"}
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
            className="text-muted/20" />
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

function MealSlotCard({
  slot,
  entries,
  date,
  recurringItems,
  onAddRecurring,
  onMarkRecurring,
  onDeleteRecurring,
  onDelete,
}: {
  slot: string;
  entries: MealEntry[];
  date: string;
  recurringItems: RecurringFood[];
  onAddRecurring: (food: RecurringFood) => void;
  onMarkRecurring: (entryId: string) => void;
  onDeleteRecurring: (recurringId: string) => void;
  onDelete: (id: string) => void;
}) {
  // Entradas marcadas/desmarcadas manualmente en esta sesión
  const [manuallyMarked, setManuallyMarked] = useState<Set<string>>(new Set());
  const [manuallyUnmarked, setManuallyUnmarked] = useState<Set<string>>(new Set());
  const total = entries.reduce((s, e) => s + e.kcal, 0);

  function isStarred(entry: MealEntry): boolean {
    if (manuallyUnmarked.has(entry.id)) return false;
    if (manuallyMarked.has(entry.id)) return true;
    const name = (entry.food?.name ?? "").toLowerCase();
    return recurringItems.some((r) => r.name.toLowerCase() === name);
  }

  function handleToggleStar(entry: MealEntry) {
    if (isStarred(entry)) {
      setManuallyUnmarked((p) => new Set([...p, entry.id]));
      setManuallyMarked((p) => { const n = new Set(p); n.delete(entry.id); return n; });
      const rec = recurringItems.find((r) => r.name.toLowerCase() === (entry.food?.name ?? "").toLowerCase());
      if (rec) onDeleteRecurring(rec.id);
    } else {
      setManuallyMarked((p) => new Set([...p, entry.id]));
      setManuallyUnmarked((p) => { const n = new Set(p); n.delete(entry.id); return n; });
      onMarkRecurring(entry.id);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{SLOT_LABELS[slot] ?? slot}</CardTitle>
          <div className="flex items-center gap-2">
            {total > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">{total} kcal</span>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
              <Link to={`/log?date=${date}&slot=${slot}`}>
                <Plus className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </CardHeader>

      {/* Chips de acceso rápido (recurrentes de este slot) */}
      {recurringItems.length > 0 && (
        <CardContent className="pt-0 pb-2">
          <div className="flex flex-col gap-1.5">
            {recurringItems.slice(0, 3).map((r) => (
              <button
                key={r.id}
                onClick={() => onAddRecurring(r)}
                className="flex items-center gap-1 rounded-full border border-border/50 bg-muted/30 px-2.5 py-1 text-[11px] hover:border-primary/50 hover:bg-primary/5 transition-all w-fit"
              >
                <Star className="h-2.5 w-2.5 text-yellow-400 fill-yellow-400" />
                <span>{r.name}</span>
                <span className="text-muted-foreground">{r.kcalPerServing} kcal</span>
              </button>
            ))}
          </div>
        </CardContent>
      )}

      {entries.length > 0 && (
        <CardContent className={cn("pt-0 space-y-2", recurringItems.length > 0 && "border-t border-border/30")}>
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between text-sm py-1.5 border-t border-border/50 first:border-t-0">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{entry.food?.name ?? "Alimento"}</p>
                <p className="text-xs text-muted-foreground">
                  {entry.quantityG}g · P: {entry.proteinG}g · C: {entry.carbsG}g · G: {entry.fatG}g
                </p>
              </div>
              <div className="flex items-center gap-1 ml-3 shrink-0">
                <span className="text-xs font-medium tabular-nums mr-1">{entry.kcal} kcal</span>
                <button
                  onClick={() => handleToggleStar(entry)}
                  title={isStarred(entry) ? "Quitar de favoritos" : "Guardar como favorito"}
                  className={cn("p-1 transition-colors", isStarred(entry) ? "text-yellow-400" : "text-muted-foreground hover:text-yellow-400")}
                >
                  <Star className={cn("h-3.5 w-3.5", isStarred(entry) && "fill-yellow-400")} />
                </button>
                <button
                  onClick={() => onDelete(entry.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors p-1"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </CardContent>
      )}
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
  const [activityId, setActivityId] = useState<string>("");
  const [minutes, setMinutes] = useState("45");
  const [kcalOverride, setKcalOverride] = useState("");
  const [saving, setSaving] = useState(false);

  const activity = ACTIVITIES.find((a) => a.id === activityId);
  const estimatedKcal = activity && activity.kcalPerMin > 0
    ? Math.round(activity.kcalPerMin * Number(minutes || 0))
    : 0;
  const kcalFinal = kcalOverride ? Number(kcalOverride) : estimatedKcal;

  function handleSelectActivity(id: string) {
    setActivityId(id);
    setKcalOverride("");
  }

  async function handleSave() {
    if (!kcalFinal || kcalFinal < 1) return;
    setSaving(true);
    try {
      const notes = activity ? `${activity.label}${minutes ? ` · ${minutes} min` : ""}` : undefined;
      const w = await workoutsApi.log({ workoutDate: date, kcalBurned: kcalFinal, notes });
      onSave(w);
      setActivityId(""); setMinutes("45"); setKcalOverride(""); setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
      >
        <Dumbbell className="h-3.5 w-3.5" />
        Añadir entreno
      </button>
    );
  }

  return (
    <Card className="border-border/60">
      <CardContent className="pt-4 pb-4 space-y-4">
        {/* Selector de actividad */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">¿Qué has hecho?</p>
          <div className="grid grid-cols-5 gap-1.5">
            {ACTIVITIES.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => handleSelectActivity(a.id)}
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
                {/* Preview kcal estimadas */}
                <div className="text-center pt-5">
                  <p className="text-2xl font-bold text-green-400 tabular-nums">{estimatedKcal}</p>
                  <p className="text-[10px] text-muted-foreground">kcal est.</p>
                </div>
              </div>
            )}

            {/* Override manual */}
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

            {/* Acciones */}
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                onClick={handleSave}
                disabled={saving || !kcalFinal}
              >
                {saving ? "Guardando…" : `Guardar · ${kcalFinal} kcal`}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setOpen(false); setActivityId(""); }}
              >
                Cancelar
              </Button>
            </div>
          </>
        )}

        {!activityId && (
          <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Asesor integrado ─────────────────────────────────────────────────────────

const SLOT_ES_ADVISOR: Record<string, string> = {
  breakfast: "Desayuno", lunch: "Comida", dinner: "Cena", snack: "Snack", other: "Otro",
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
  const [lastReply, setLastReply] = useState<{ message: AdvisorMessage; entries: AdvisorAddedEntry[] } | null>(null);
  const [markedIds, setMarkedIds] = useState<Set<string>>(new Set());
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const cancelRecordingRef = useRef(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function send(opts: { text?: string; imageBase64?: string; imageMimeType?: string }) {
    if (sending) return;
    setSending(true);
    setLastReply(null); // limpiar respuesta anterior antes de enviar
    try {
      const res = await advisorApi.message(date, opts);
      setLastReply({ message: { id: Date.now().toString(), role: "assistant", content: res.reply, createdAt: new Date().toISOString() }, entries: res.addedEntries });
      if (res.addedEntries.length > 0) setTimeout(() => onEntriesAdded(), 300);
      setText("");
    } catch {
      setLastReply({ message: { id: Date.now().toString(), role: "assistant", content: "Ha ocurrido un error. Inténtalo de nuevo.", createdAt: "" }, entries: [] });
    } finally {
      setSending(false);
    }
  }

  function handleSendText() {
    if (!text.trim()) return;
    send({ text: text.trim() });
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
        if (cancelRecordingRef.current) return; // descartado por el usuario
        // Transcribir y poner en el textarea
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
            setText(""); // si falla, dejar el campo vacío
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

  // ── Imagen ────────────────────────────────────────────────────────────────

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => send({ imageBase64: (reader.result as string).split(",")[1], imageMimeType: file.type });
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  // ── Estrella ──────────────────────────────────────────────────────────────

  async function handleMarkRecurring(entry: AdvisorAddedEntry) {
    if (markedIds.has(entry.id)) return;
    await advisorApi.markRecurring(entry.id).catch(() => {});
    setMarkedIds((p) => new Set([...p, entry.id]));
    onRecurringChange();
  }

  const busy = sending || transcribing;

  return (
    <div className="space-y-3">

      {/* Respuesta del asesor */}
      {lastReply && (
        <div className="space-y-2">
          <div className="rounded-2xl rounded-tl-sm bg-card border border-border/60 px-4 py-3 text-sm leading-relaxed">
            {lastReply.message.content}
          </div>
          {lastReply.entries.length > 0 && (
            <div className="space-y-1.5">
              {lastReply.entries.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between bg-green-500/8 border border-green-500/20 rounded-xl px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-green-400 truncate">{entry.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {SLOT_ES_ADVISOR[entry.mealSlot] ?? entry.mealSlot} · {entry.kcal} kcal · P:{entry.proteinG.toFixed(0)}g C:{entry.carbsG.toFixed(0)}g G:{entry.fatG.toFixed(0)}g
                    </p>
                  </div>
                  <button
                    onClick={() => handleMarkRecurring(entry)}
                    title="Guardar como recurrente"
                    className={cn("ml-2 shrink-0 p-1 transition-colors", markedIds.has(entry.id) ? "text-yellow-400" : "text-muted-foreground hover:text-yellow-400")}
                  >
                    <Star className={cn("h-3.5 w-3.5", markedIds.has(entry.id) && "fill-yellow-400")} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Input */}
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageChange} />
      <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
      <div className={cn(
        "flex flex-col rounded-2xl border bg-card transition-colors",
        recording ? "border-red-500/50 bg-red-500/5" : "border-border/60 focus-within:border-primary/60",
      )}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendText(); } }}
          placeholder={
            recording ? "Grabando… pulsa Enviar para transcribir o el micrófono para cancelar"
            : transcribing ? "Transcribiendo audio…"
            : "¿Qué has comido? Escribe o graba un audio…"
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
          {/* Galería */}
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
          {/* Micrófono: rojo mientras graba (tap = cancelar) */}
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
          {/* Enviar: mientras graba = transcribir (sin enviar aún) */}
          <button
            onClick={recording ? stopAndTranscribe : handleSendText}
            disabled={!recording && (!text.trim() || busy)}
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
                  {daysYellow} fuera de rango
                </span>
              )}
              {daysRed > 0 && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">
                  {daysRed} muy lejos
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

export function DashboardPage() {
  const [view, setView] = useState<"day" | "week">("day");
  const [date, setDate] = useState(todayISO);
  const [weekStart, setWeekStart] = useState(() => getMondayISO(todayISO()));
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

  // El target efectivo del día = base + EAT (kcal quemadas en entrenamiento)
  const effectiveKcalTarget = (target?.kcalTarget ?? 0) + eatKcal;
  const consumed = p?.totals ?? { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 };
  const kcalStatus = p?.kcalStatus ?? "yellow";

  return (
    <div className="pb-24 md:pb-6">
      {/* ── Toggle Diario / Semana ──────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border/40 px-4 pt-3 pb-2">
        <div className="max-w-lg mx-auto flex flex-col gap-2">
          {/* Selector de vista */}
          <div className="flex items-center gap-1 bg-muted/30 rounded-xl p-1 self-center">
            <button
              onClick={() => setView("day")}
              className={cn(
                "px-5 py-1.5 rounded-lg text-xs font-semibold transition-all",
                view === "day"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Diario
            </button>
            <button
              onClick={() => setView("week")}
              className={cn(
                "px-5 py-1.5 rounded-lg text-xs font-semibold transition-all",
                view === "week"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Semana
            </button>
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

            {/* Anillo */}
            <div className="flex flex-col items-center py-2">
              <CalorieRing consumed={consumed.kcal} target={effectiveKcalTarget} status={kcalStatus} />
              {eatKcal > 0 && (
                <p className="mt-1.5 text-xs text-green-400 font-medium">+{eatKcal} kcal de entrenamiento</p>
              )}
            </div>

            {/* Macros */}
            {target ? (
              <Card>
                <CardContent className="pt-5 pb-4">
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
              {(data?.workouts ?? []).map((w) => (
                <Card key={w.id} className="border-green-500/20 bg-green-500/5">
                  <CardContent className="py-3 px-4 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Dumbbell className="h-4 w-4 text-green-400 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-green-400">+{w.kcalBurned} kcal</p>
                        {w.notes && <p className="text-xs text-muted-foreground">{w.notes}</p>}
                      </div>
                    </div>
                    <button onClick={() => handleDeleteWorkout(w.id)} className="text-muted-foreground hover:text-destructive transition-colors p-1">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </CardContent>
                </Card>
              ))}
              <WorkoutForm date={date} onSave={handleAddWorkout} />
            </div>
          </section>

          {/* ── SECCIÓN 2: Asesor ─────────────────────────────────────────── */}
          <section>
            {/* Cabecera del asesor */}
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 shadow-md shadow-violet-500/25">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div>
                <h2 className="text-sm font-semibold leading-none">Asesor del día</h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">Cuéntame qué has comido o pídeme consejo</p>
              </div>
              <div className="ml-auto flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-[10px] text-green-400 font-medium">Online</span>
              </div>
            </div>

            {/* Componente del asesor */}
            <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
              <AdvisorInline date={date} onEntriesAdded={refreshDay} onRecurringChange={refreshRecurring} />
            </div>
          </section>

          {/* ── SECCIÓN 3: Registros de comida ───────────────────────────── */}
          <section className="space-y-3">
            <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Registros del día</h2>
            {slots.map((slot) => (
              <MealSlotCard
                key={slot}
                slot={slot}
                entries={data?.bySlot[slot] ?? []}
                date={date}
                recurringItems={recurring.filter((r) => r.mealSlot === slot)}
                onAddRecurring={handleAddRecurring}
                onMarkRecurring={handleMarkRecurring}
                onDeleteRecurring={handleDeleteRecurring}
                onDelete={handleDeleteMeal}
              />
            ))}
          </section>

        </div>
      ) : null}
    </div>
  );
}
