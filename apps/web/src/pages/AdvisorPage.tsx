import { Camera, Mic, MicOff, Send, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { RecurringFavoriteCard } from "@/components/RecurringFavoriteAdd";
import { advisorApi, type AdvisorAddedEntry, type AdvisorMessage, type RecurringFood } from "@/lib/api";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayISO() {
  return new Date().toLocaleDateString("sv-SE");
}

const SLOT_ES: Record<string, string> = {
  breakfast: "Desayuno", lunch: "Comida", dinner: "Cena",
  snack: "Snack", other: "Otro",
};

// ─── Burbuja de mensaje ───────────────────────────────────────────────────────

function MessageBubble({
  message,
  addedEntries,
  onMarkRecurring,
}: {
  message: AdvisorMessage;
  addedEntries?: AdvisorAddedEntry[];
  onMarkRecurring?: (entry: AdvisorAddedEntry) => void;
}) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex flex-col gap-1.5", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-card border border-border/60 text-foreground rounded-bl-sm",
        )}
      >
        {message.content}
      </div>

      {/* Tarjetas de entradas añadidas por el asesor */}
      {addedEntries && addedEntries.length > 0 && (
        <div className="w-full max-w-sm space-y-1.5 mt-1">
          {addedEntries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between bg-green-500/8 border border-green-500/20 rounded-xl px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-green-400 truncate">{entry.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {SLOT_ES[entry.mealSlot] ?? entry.mealSlot} · {entry.kcal} kcal ·{" "}
                  P:{entry.proteinG.toFixed(0)}g C:{entry.carbsG.toFixed(0)}g G:{entry.fatG.toFixed(0)}g
                </p>
              </div>
              {onMarkRecurring && (
                <button
                  onClick={() => onMarkRecurring(entry)}
                  title="Guardar como recurrente"
                  className="ml-2 shrink-0 text-muted-foreground hover:text-yellow-400 transition-colors p-1"
                >
                  <Star className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Indicador de typing ─────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-start">
      <div className="bg-card border border-border/60 rounded-2xl rounded-bl-sm px-4 py-3">
        <div className="flex gap-1 items-center h-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

type ChatEntry = {
  message: AdvisorMessage;
  addedEntries?: AdvisorAddedEntry[];
};

export function AdvisorPage() {
  const date = todayISO();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [recurring, setRecurring] = useState<RecurringFood[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [markedIds, setMarkedIds] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cargar historial y recurrentes al montar
  useEffect(() => {
    Promise.all([
      advisorApi.history(date),
      advisorApi.recurring(),
    ]).then(([historyRes, recurringRes]) => {
      setEntries(historyRes.messages.map((m) => ({ message: m })));
      setRecurring(recurringRes.items);
    }).catch((err) => {
      console.error("Error cargando historial/rotativo:", err);
    });
  }, [date]);

  // Auto-scroll al fondo
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries, sending]);

  // Scroll al fondo al montar con historial cargado
  useEffect(() => {
    if (entries.length > 0) {
      messagesContainerRef.current?.scrollTo({ top: messagesContainerRef.current.scrollHeight });
    }
  }, [entries.length > 0]);

  // ── Enviar mensaje ─────────────────────────────────────────────────────────
  async function sendMessage(opts: {
    text?: string;
    audioBase64?: string;
    imageBase64?: string;
    imageMimeType?: string;
    displayText?: string;
  }) {
    if (sending) return;
    setSending(true);

    const userContent = opts.displayText ?? opts.text ?? (opts.audioBase64 ? "🎤 Audio enviado" : "📷 Foto enviada");

    // Añadir mensaje del usuario optimistamente
    const tempUserMsg: AdvisorMessage = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: userContent,
      createdAt: new Date().toISOString(),
    };
    setEntries((prev) => [...prev, { message: tempUserMsg }]);
    setText("");

    try {
      const res = await advisorApi.message(date, {
        text: opts.text,
        audioBase64: opts.audioBase64,
        imageBase64: opts.imageBase64,
        imageMimeType: opts.imageMimeType,
      });

      // Si había transcripción, actualizar el mensaje del usuario con el texto real
      const finalUserContent = res.transcription ?? userContent;
      const finalUserMsg: AdvisorMessage = {
        ...tempUserMsg,
        content: finalUserContent,
      };

      const assistantMsg: AdvisorMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: res.reply,
        createdAt: new Date().toISOString(),
      };

      setEntries((prev) => [
        ...prev.slice(0, -1), // reemplaza el temp
        { message: finalUserMsg },
        { message: assistantMsg, addedEntries: res.addedEntries },
      ]);
    } catch {
      setEntries((prev) => [
        ...prev.slice(0, -1),
        {
          message: {
            id: `err-${Date.now()}`,
            role: "assistant",
            content: "Lo siento, ha ocurrido un error. ¿Lo intentamos de nuevo?",
            createdAt: new Date().toISOString(),
          },
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  // ── Enviar texto ───────────────────────────────────────────────────────────
  function handleSendText() {
    if (!text.trim()) return;
    sendMessage({ text: text.trim() });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  }

  // ── Grabación de audio ────────────────────────────────────────────────────
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(",")[1];
          sendMessage({ audioBase64: base64, displayText: "🎤 Mensaje de voz" });
        };
        reader.readAsDataURL(blob);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch {
      alert("No se pudo acceder al micrófono.");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  // ── Upload de imagen ──────────────────────────────────────────────────────
  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      sendMessage({ imageBase64: base64, imageMimeType: file.type, displayText: "📷 Foto enviada" });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  // ── Marcar recurrente ─────────────────────────────────────────────────────
  async function handleMarkRecurring(entry: AdvisorAddedEntry) {
    if (markedIds.has(entry.id)) return;
    await advisorApi.markRecurring(entry.id).catch(() => {});
    setMarkedIds((prev) => new Set([...prev, entry.id]));
    const updated = await advisorApi.recurring().catch(() => null);
    if (updated) setRecurring(updated.items);
  }

  // ── Recurrente añadido ────────────────────────────────────────────────────
  function handleRecurringAdded() {
    // Mensaje de confirmación sutil en el chat
    const msg: AdvisorMessage = {
      id: `recurring-${Date.now()}`,
      role: "assistant",
      content: "Añadido al día. ¡Lo he apuntado!",
      createdAt: new Date().toISOString(),
    };
    setEntries((prev) => [...prev, { message: msg }]);
  }

  const isEmpty = entries.length === 0;

  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)] md:h-full">
      {/* ── Cabecera ──────────────────────────────────────────────────────── */}
      <div className="px-4 pt-5 pb-3 border-b border-border/40 shrink-0">
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 shadow-lg shadow-violet-500/20">
            <span className="text-sm font-bold text-white">IA</span>
          </div>
          <div>
            <h1 className="text-base font-semibold">Asesor del día</h1>
            <p className="text-xs text-muted-foreground">
              {new Date(date + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}
            </p>
          </div>
        </div>

        {/* Recurrentes */}
        {recurring.length > 0 && (
          <div className="mt-3 max-w-lg mx-auto">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Añadir rápido</p>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {recurring.map((r) => (
                <RecurringFavoriteCard key={r.id} food={r} nutritionDate={date} onAdded={handleRecurringAdded} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Mensajes (scroll) ─────────────────────────────────────────────── */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
        <div className="max-w-lg mx-auto space-y-4">
          {isEmpty && !sending && (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Mic className="h-7 w-7" />
              </div>
              <div>
                <p className="font-medium">Cuéntame qué has comido</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                  Puedes escribir, enviar un audio o una foto de tu comida. Yo me encargo de registrarlo.
                </p>
              </div>
              <div className="mt-2 flex flex-col gap-2 text-xs text-muted-foreground">
                <p className="bg-card border border-border/60 rounded-xl px-4 py-2.5 italic">
                  "He desayunado tostadas con aguacate y un café con leche"
                </p>
                <p className="bg-card border border-border/60 rounded-xl px-4 py-2.5 italic">
                  "¿Qué puedo cenar con lo que me queda de proteína?"
                </p>
              </div>
            </div>
          )}

          {entries.map((entry) => (
            <MessageBubble
              key={entry.message.id}
              message={entry.message}
              addedEntries={entry.addedEntries}
              onMarkRecurring={(e) => {
                if (!markedIds.has(e.id)) handleMarkRecurring(e);
              }}
            />
          ))}

          {sending && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* ── Input area ────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-border/40 px-4 py-3 bg-background/80 backdrop-blur">
        <div className="max-w-lg mx-auto flex items-end gap-2">
          {/* Foto */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageChange}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || recording}
            className="shrink-0 flex h-10 w-10 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
          >
            <Camera className="h-5 w-5" />
          </button>

          {/* Texto */}
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={recording ? "Grabando…" : "Escribe o graba un mensaje…"}
              disabled={sending || recording}
              rows={1}
              className={cn(
                "w-full resize-none rounded-2xl border border-border/60 bg-card px-4 py-2.5",
                "text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/60",
                "max-h-72 min-h-[2.5rem] leading-relaxed disabled:opacity-50",
                recording && "border-red-500/50 bg-red-500/5",
              )}
              style={{ height: "auto" }}
              onInput={(e) => {
                const t = e.currentTarget;
                t.style.height = "auto";
                t.style.height = `${Math.min(t.scrollHeight, 288)}px`;
              }}
            />
          </div>

          {/* Audio */}
          <button
            onClick={recording ? stopRecording : startRecording}
            disabled={sending}
            className={cn(
              "shrink-0 flex h-10 w-10 items-center justify-center rounded-xl transition-colors disabled:opacity-40",
              recording
                ? "bg-red-500/15 text-red-400 hover:bg-red-500/25 animate-pulse"
                : "bg-muted/50 text-muted-foreground hover:text-primary hover:bg-primary/10",
            )}
          >
            {recording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>

          {/* Enviar */}
          <Button
            size="icon"
            className="shrink-0 h-10 w-10 rounded-xl"
            onClick={handleSendText}
            disabled={!text.trim() || sending || recording}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
