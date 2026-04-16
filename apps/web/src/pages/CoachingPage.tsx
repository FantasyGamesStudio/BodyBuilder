/**
 * CoachingPage — hilo conversacional con el coach de IA (H2)
 *
 * Usa coachingApi: thread con ventana deslizante de 7 días,
 * soporta texto, audio (base64) e imágenes.
 */

import { Camera, Image, Mic, MicOff, RefreshCw, Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MarkdownText } from "@/components/ui/markdown-text";
import { coachingApi, type CoachingMessage, type CoachingThread } from "@/lib/api";
import { compressImage } from "@/lib/image";
import { cn } from "@/lib/utils";

// ─── Typing indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-start">
      <div className="bg-card border border-border/60 rounded-2xl rounded-bl-sm px-4 py-3">
        <div className="flex gap-1 items-center h-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Burbuja de mensaje ───────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: CoachingMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
      <div className={cn(
        "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
        isUser
          ? "bg-primary text-primary-foreground rounded-br-sm"
          : "bg-card border border-border/60 text-foreground rounded-bl-sm",
      )}>
        {isUser ? msg.bodyText : <MarkdownText text={msg.bodyText} />}
      </div>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export function CoachingPage() {
  const [thread, setThread] = useState<CoachingThread | null>(null);
  const [messages, setMessages] = useState<CoachingMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // ── Cargar hilo y mensajes ──────────────────────────────────────────────────

  useEffect(() => {
    coachingApi.getThread()
      .then(async (t) => {
        setThread(t);
        const res = await coachingApi.getMessages(t.id);
        setMessages(res.messages.filter((m) => m.role !== "system"));
      })
      .catch((err) => {
        console.error("Error cargando hilo de coaching:", err);
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  // ── Audio ──────────────────────────────────────────────────────────────────

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    audioChunksRef.current = [];
    mr.ondataavailable = (e) => audioChunksRef.current.push(e.data);
    mr.onstop = async () => {
      const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(",")[1];
        await sendMessage({ audioBase64: base64 });
      };
      reader.readAsDataURL(blob);
      stream.getTracks().forEach((t) => t.stop());
    };
    mr.start();
    mediaRecorderRef.current = mr;
    setRecording(true);
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  // ── Imagen ─────────────────────────────────────────────────────────────────

  async function handleImageFile(files: FileList | null) {
    if (!files?.length) return;
    const compressed = await compressImage(files[0]);
    await sendMessage({ imageBase64: compressed.base64, imageMimeType: compressed.mimeType });
  }

  // ── Enviar mensaje ─────────────────────────────────────────────────────────

  async function sendMessage(opts: { text?: string; audioBase64?: string; imageBase64?: string; imageMimeType?: string }) {
    if (!thread) return;
    setSending(true);

    const displayText = opts.text ?? (opts.audioBase64 ? "🎙 Audio" : opts.imageBase64 ? "📷 Imagen" : "");
    const tempUser: CoachingMessage = {
      id: `tmp-${Date.now()}`,
      role: "user",
      bodyText: displayText,
      linkedMealEntryId: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUser]);
    setText("");

    try {
      const res = await coachingApi.sendMessage(thread.id, opts);
      const assistantMsg: CoachingMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        bodyText: res.reply,
        linkedMealEntryId: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { ...tempUser, bodyText: res.transcription ?? displayText },
        assistantMsg,
      ]);
    } catch {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        tempUser,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          bodyText: "Ha ocurrido un error. Inténtalo de nuevo.",
          linkedMealEntryId: null,
          createdAt: "",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (text.trim()) sendMessage({ text: text.trim() });
    }
  }

  // ── Borrar hilo ────────────────────────────────────────────────────────────

  async function handleDeleteThread() {
    if (!thread) return;
    await coachingApi.deleteThread(thread.id).catch(() => {});
    const newThread = await coachingApi.getThread();
    setThread(newThread);
    setMessages([]);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const isEmpty = messages.length === 0 && !sending;
  const expiresIn = thread ? Math.ceil((new Date(thread.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;

  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)] md:h-full">
      {/* Cabecera */}
      <div className="shrink-0 px-4 pt-5 pb-3 border-b border-border/40">
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/20">
            <span className="text-sm font-bold text-white">H2</span>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold">Coach nutricional</h1>
            {expiresIn !== null && expiresIn > 0 && (
              <p className="text-xs text-muted-foreground">Hilo activo · expira en {expiresIn}d</p>
            )}
          </div>
          {thread && (
            <button
              onClick={handleDeleteThread}
              title="Reiniciar hilo"
              className="p-2 text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Mensajes */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4">
        <div className="max-w-lg mx-auto space-y-4">
          {loading && (
            <div className="flex justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}

          {!loading && loadError && (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
              <p className="text-sm text-muted-foreground">No se pudo conectar con el coach.</p>
              <button
                onClick={() => { setLoadError(false); setLoading(true); coachingApi.getThread().then(async (t) => { setThread(t); const res = await coachingApi.getMessages(t.id); setMessages(res.messages.filter((m) => m.role !== "system")); }).catch(() => setLoadError(true)).finally(() => setLoading(false)); }}
                className="text-sm text-primary hover:underline"
              >
                Reintentar
              </button>
            </div>
          )}

          {!loading && isEmpty && (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-2xl">🧠</div>
              <div>
                <p className="font-medium">Coach nutricional</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                  Pregúntame cualquier cosa sobre nutrición, entrenamiento o cómo alcanzar tu objetivo.
                </p>
              </div>
              <div className="flex flex-col gap-2 text-xs text-muted-foreground mt-2">
                {[
                  "¿Cuánta proteína necesito tras un entreno de fuerza?",
                  "¿Qué snack me recomiendas para antes de entrenar?",
                  "¿Cómo distribuyo mis macros en días de descanso?",
                ].map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage({ text: s })}
                    className="bg-card border border-border/60 rounded-xl px-4 py-2.5 italic hover:border-primary/40 transition-colors text-left"
                  >
                    "{s}"
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => <MessageBubble key={m.id} msg={m} />)}
          {sending && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-border/40 px-4 py-3 bg-background/80 backdrop-blur">
        <div className="max-w-lg mx-auto flex items-end gap-2">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleImageFile(e.target.files)} />
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleImageFile(e.target.files)} />

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || recording}
            className="shrink-0 flex h-10 w-10 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
          >
            <Image className="h-5 w-5" />
          </button>

          <button
            onClick={() => cameraInputRef.current?.click()}
            disabled={sending || recording}
            className="shrink-0 flex h-10 w-10 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
          >
            <Camera className="h-5 w-5" />
          </button>

          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={recording ? "Grabando…" : "Escribe tu pregunta…"}
              disabled={sending || recording}
              rows={1}
              className={cn(
                "w-full resize-none rounded-2xl border border-border/60 bg-card px-4 py-2.5",
                "text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/60",
                "max-h-56 min-h-[2.5rem] leading-relaxed disabled:opacity-50",
                recording && "border-red-500/50 bg-red-500/5",
              )}
              style={{ height: "auto" }}
              onInput={(e) => {
                const t = e.currentTarget;
                t.style.height = "auto";
                t.style.height = `${Math.min(t.scrollHeight, 224)}px`;
              }}
            />
          </div>

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

          <Button
            size="icon"
            className="shrink-0 h-10 w-10 rounded-xl"
            onClick={() => text.trim() && sendMessage({ text: text.trim() })}
            disabled={!text.trim() || sending || recording}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
