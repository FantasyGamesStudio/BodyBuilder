import { Bot, Camera, ChevronLeft, Image, Mic, MicOff, Send, Star, Trash2, X } from "lucide-react";
import { compressImage } from "@/lib/image";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { RecurringFavoriteRow } from "@/components/RecurringFavoriteAdd";
import { advisorApi, mealsApi, type MealEntry, type RecurringFood } from "@/lib/api";
import { cn } from "@/lib/utils";

const SLOT_LABELS: Record<string, string> = {
  breakfast: "Desayuno",
  lunch: "Comida",
  dinner: "Cena",
  snack: "Snack",
  other: "Otro",
};

function todayISO() {
  return new Date().toLocaleDateString("sv-SE");
}

export function LogMealPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const date = params.get("date") ?? todayISO();
  const slot = params.get("slot") ?? "lunch";
  const slotLabel = SLOT_LABELS[slot] ?? slot;

  // ── Entradas actuales del slot ────────────────────────────────────────────
  const [entries, setEntries] = useState<MealEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);

  // ── Favoritos de este slot ────────────────────────────────────────────────
  const [recurring, setRecurring] = useState<RecurringFood[]>([]);

  // ── Asesor ────────────────────────────────────────────────────────────────
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [lastReply, setLastReply] = useState<string | null>(null);
  const [pendingImages, setPendingImages] = useState<Array<{ base64: string; mimeType: string; preview: string }>>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const cancelRecordingRef = useRef(false);

  // ── Carga inicial ─────────────────────────────────────────────────────────
  useEffect(() => {
    setLoadingEntries(true);
    Promise.all([
      mealsApi.day(date),
      advisorApi.recurring(),
    ]).then(([day, rec]) => {
      setEntries(day.bySlot[slot] ?? []);
      setRecurring(rec.items.filter((r) => r.mealSlot === slot));
    }).catch(() => {}).finally(() => setLoadingEntries(false));
  }, [date, slot]);

  function refreshEntries() {
    mealsApi.day(date).then((day) => setEntries(day.bySlot[slot] ?? [])).catch(() => {});
  }

  // ── Favoritos ─────────────────────────────────────────────────────────────
  async function handleDeleteRecurring(id: string) {
    setRecurring((prev) => prev.filter((r) => r.id !== id));
    await advisorApi.deleteRecurring(id).catch(() => {
      advisorApi.recurring().then((r) => setRecurring(r.items.filter((i) => i.mealSlot === slot))).catch(() => {});
    });
  }

  // ── Toggle de favorito (con borrado diferido al salir) ───────────────────
  const [manuallyMarked, setManuallyMarked] = useState<Set<string>>(new Set());
  const [manuallyUnmarked, setManuallyUnmarked] = useState<Set<string>>(new Set());
  // IDs de recurring a borrar cuando el usuario abandone la vista
  const pendingDeletionsRef = useRef<Set<string>>(new Set());

  // Ejecutar borrados pendientes al desmontar
  useEffect(() => {
    return () => {
      for (const id of pendingDeletionsRef.current) {
        advisorApi.deleteRecurring(id).catch(() => {});
      }
    };
  }, []);

  function isStarred(entry: MealEntry): boolean {
    if (manuallyUnmarked.has(entry.id)) return false;
    if (manuallyMarked.has(entry.id)) return true;
    const name = (entry.food?.name ?? "").toLowerCase();
    return recurring.some((r) => r.name.toLowerCase() === name);
  }

  async function handleToggleStar(entry: MealEntry) {
    if (isStarred(entry)) {
      // Desmarcar: diferir el borrado hasta salir de la vista
      setManuallyUnmarked((p) => new Set([...p, entry.id]));
      setManuallyMarked((p) => { const n = new Set(p); n.delete(entry.id); return n; });
      const rec = recurring.find((r) => r.name.toLowerCase() === (entry.food?.name ?? "").toLowerCase());
      if (rec) pendingDeletionsRef.current.add(rec.id);
    } else {
      // Marcar: cancelar borrado pendiente si lo había, y guardar como favorito
      setManuallyMarked((p) => new Set([...p, entry.id]));
      setManuallyUnmarked((p) => { const n = new Set(p); n.delete(entry.id); return n; });
      const rec = recurring.find((r) => r.name.toLowerCase() === (entry.food?.name ?? "").toLowerCase());
      if (rec) {
        // Ya existía pero estaba pendiente de borrar — cancelamos el borrado
        pendingDeletionsRef.current.delete(rec.id);
      } else {
        await advisorApi.markRecurring(entry.id).catch(() => {});
        advisorApi.recurring()
          .then((r) => setRecurring(r.items.filter((i) => i.mealSlot === slot)))
          .catch(() => {});
      }
    }
  }

  async function handleDeleteEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    await mealsApi.delete(id).catch(() => refreshEntries());
  }

  // ── Asesor ────────────────────────────────────────────────────────────────
  async function send(opts: { text?: string; images?: Array<{ base64: string; mimeType: string }> }) {
    if (sending) return;
    setSending(true);
    setLastReply(null);
    try {
      const apiImages = (opts.images ?? []).map((img) => ({ imageBase64: img.base64, mimeType: img.mimeType }));
      const res = await advisorApi.message(date, {
        text: opts.text ? `[${slotLabel}] ${opts.text}` : undefined,
        images: apiImages.length > 0 ? apiImages : undefined,
      });
      setLastReply(res.reply);
      setText("");
      setPendingImages([]);
      // Siempre refrescamos: puede haber entradas pre-existentes o recién añadidas
      setTimeout(() => refreshEntries(), 300);
    } catch {
      setLastReply("Ha ocurrido un error. Inténtalo de nuevo.");
    } finally {
      setSending(false);
    }
  }

  function handleSend() {
    if (recording) { stopAndTranscribe(); return; }
    const hasContent = text.trim() || pendingImages.length > 0;
    if (!hasContent || sending || transcribing) return;
    send({ text: text.trim() || undefined, images: pendingImages });
  }

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
          } catch { setText(""); }
          finally { setTranscribing(false); }
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

  const total = entries.reduce((s, e) => s + e.kcal, 0);

  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)] md:h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-6 pb-4 border-b border-border shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold">{slotLabel}</h1>
          <p className="text-xs text-muted-foreground">{date}</p>
        </div>
        {total > 0 && (
          <span className="text-sm font-semibold tabular-nums text-muted-foreground">{total} kcal</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto max-w-lg mx-auto w-full">

        {/* ── Entradas actuales del slot ──────────────────────────────────── */}
        <div className="px-4 pt-5 space-y-1">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
            Lo que hay registrado
          </p>
          {loadingEntries ? (
            <div className="flex justify-center py-6">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              Aún no has añadido nada al {slotLabel.toLowerCase()} — usa los favoritos o el asesor.
            </p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between py-2.5 border-b border-border/40 last:border-b-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{entry.food?.name ?? "Alimento"}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.quantityG}g · P:{entry.proteinG}g C:{entry.carbsG}g G:{entry.fatG}g
                  </p>
                </div>
                <div className="flex items-center gap-1 ml-3 shrink-0">
                  <span className="text-sm font-medium tabular-nums mr-1">{entry.kcal} kcal</span>
                  <button
                    onClick={() => handleToggleStar(entry)}
                    title={isStarred(entry) ? "Quitar de favoritos" : "Guardar como favorito"}
                    className={cn("p-1 transition-colors", isStarred(entry) ? "text-yellow-400" : "text-muted-foreground hover:text-yellow-400")}
                  >
                    <Star className={cn("h-4 w-4", isStarred(entry) && "fill-yellow-400")} />
                  </button>
                  <button
                    onClick={() => handleDeleteEntry(entry.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors p-1"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="px-4 pb-6 pt-4 space-y-5">
          {/* ── Favoritos del slot ──────────────────────────────────────────── */}
          {recurring.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                Añadir de nuevo
              </p>
              <div className="space-y-1.5">
                {recurring.map((food) => (
                  <div
                    key={food.id}
                    className="flex items-stretch rounded-xl border border-border/60 bg-card overflow-hidden"
                  >
                    <RecurringFavoriteRow
                      embedded
                      food={food}
                      nutritionDate={date}
                      mealSlot={slot}
                      onAdded={refreshEntries}
                    />
                    <button
                      type="button"
                      onClick={() => handleDeleteRecurring(food.id)}
                      className="shrink-0 px-3 flex items-center justify-center text-yellow-400 hover:bg-muted/30 transition-colors border-l border-border/50"
                      title="Quitar de favoritos"
                    >
                      <Star className="h-4 w-4 fill-current" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Asesor ──────────────────────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-violet-700">
                <Bot className="h-3.5 w-3.5 text-white" />
              </div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                Añadir con el asesor
              </p>
            </div>

            {lastReply && (
              <div className="rounded-2xl rounded-tl-sm bg-card border border-border/60 px-4 py-3 text-sm leading-relaxed">
                {lastReply}
              </div>
            )}

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
                  : `¿Qué más has comido en el ${slotLabel.toLowerCase()}?`
                }
                disabled={sending || transcribing || recording}
                rows={2}
                className="w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm placeholder:text-muted-foreground focus:outline-none leading-relaxed disabled:opacity-50 min-h-[3.5rem] max-h-44"
                onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = `${Math.min(t.scrollHeight, 176)}px`; }}
              />
              <div className="flex items-center gap-1 px-2 pb-2 pt-1">
                {/* Galería (múltiple) */}
                <button
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={sending || transcribing || recording}
                  title="Elegir de la galería"
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
                >
                  <Image className="h-4 w-4" />
                </button>
                {/* Cámara */}
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={sending || transcribing || recording}
                  title="Hacer foto"
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
                >
                  <Camera className="h-4 w-4" />
                </button>
                {/* Micrófono */}
                <button
                  onClick={recording ? cancelRecording : startRecording}
                  disabled={sending || transcribing}
                  title={recording ? "Cancelar grabación" : "Grabar audio"}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-xl transition-colors disabled:opacity-40",
                    recording ? "text-red-400 bg-red-500/10 animate-pulse" : "text-muted-foreground hover:text-primary hover:bg-primary/10",
                  )}
                >
                  {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
                <div className="flex-1" />
                <button
                  onClick={handleSend}
                  disabled={!recording && (!text.trim() && pendingImages.length === 0) || (sending || transcribing)}
                  className="flex items-center gap-2 h-9 px-4 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
                >
                  {(sending || transcribing)
                    ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                    : <Send className="h-3.5 w-3.5" />}
                  {!(sending || transcribing) && <span>{recording ? "Transcribir" : "Enviar"}</span>}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
