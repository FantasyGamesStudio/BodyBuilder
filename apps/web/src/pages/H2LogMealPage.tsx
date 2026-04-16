/**
 * H2LogMealPage — flujo completo de registro con IA
 *
 * Estados:
 *   idle            → formulario inicial (slot, nota opcional)
 *   uploading       → subiendo archivos a storage
 *   processing      → IA analizando (polling)
 *   review          → IA terminó, usuario revisa / confirma / corrige
 *   confirmed       → entrada guardada
 *   error           → algo falló
 */

import { Camera, CheckCircle, ChevronLeft, Image, Mic, MicOff, RefreshCw, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { h2MealsApi, type MealDetail } from "@/lib/api";
import { compressImage } from "@/lib/image";
import { cn } from "@/lib/utils";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type PageState = "idle" | "uploading" | "processing" | "review" | "confirmed" | "error";

type PendingFile = {
  file: File;
  preview: string;
  type: "image" | "audio";
};

const SLOT_LABELS: Record<string, string> = {
  breakfast: "Desayuno",
  lunch: "Comida",
  dinner: "Cena",
  snack: "Snack",
  other: "Otro",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function uploadToStorage(url: string, headers: Record<string, string>, file: File): Promise<void> {
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: file,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
}

async function pollUntilReady(mealId: string, maxMs = 60_000): Promise<MealDetail> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const detail = await h2MealsApi.getDetail(mealId);
    if (detail.status !== "ai_processing") return detail;
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error("timeout");
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function H2LogMealPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const date = searchParams.get("date") ?? new Date().toLocaleDateString("sv-SE");
  const slot = searchParams.get("slot") ?? "other";
  const reviewId = searchParams.get("reviewId");

  const [pageState, setPageState] = useState<PageState>("idle");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [mealDetail, setMealDetail] = useState<MealDetail | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  // Review form state (editable)
  const [reviewKcal, setReviewKcal] = useState("");
  const [reviewProtein, setReviewProtein] = useState("");
  const [reviewCarbs, setReviewCarbs] = useState("");
  const [reviewFat, setReviewFat] = useState("");
  const [correctionNote, setCorrectionNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Audio
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // ── F2: Si hay reviewId en la URL, cargar la comida y saltar a revisión
  useEffect(() => {
    if (!reviewId) return;
    h2MealsApi.getDetail(reviewId)
      .then((detail) => {
        setMealDetail(detail);
        if (detail.status === "ai_processing") {
          setPageState("processing");
          pollUntilReady(reviewId).then((d) => {
            setMealDetail(d);
            setPageState(d.status === "pending_user_review" ? "review" : "error");
          }).catch(() => setPageState("error"));
        } else if (detail.status === "pending_user_review") {
          setPageState("review");
        } else if (detail.status === "confirmed" || detail.status === "corrected") {
          setPageState("confirmed");
        }
      })
      .catch(() => {
        setErrorMsg("No se pudo cargar la comida. Inténtalo de nuevo.");
        setPageState("error");
      });
  }, [reviewId]);

  // ── F3: pre-rellena el formulario desde aiEstimate si existe, o desde top-level fields
  useEffect(() => {
    if (mealDetail?.status === "pending_user_review") {
      const est = mealDetail.aiEstimate;
      setReviewKcal(String(est?.kcal ?? mealDetail.kcal ?? ""));
      setReviewProtein(String(est?.proteinG ?? mealDetail.proteinG ?? ""));
      setReviewCarbs(String(est?.carbsG ?? mealDetail.carbsG ?? ""));
      setReviewFat(String(est?.fatG ?? mealDetail.fatG ?? ""));
    }
  }, [mealDetail]);

  // ── Añadir archivos ──────────────────────────────────────────────────────────

  function addImageFiles(fileList: FileList | null) {
    if (!fileList) return;
    Array.from(fileList).forEach((file) => {
      compressImage(file).then((compressed) => {
        // compressImage devuelve { base64, mimeType, preview }
        // Necesitamos el File — lo reconstruimos desde base64
        const byteStr = atob(compressed.base64);
        const ab = new ArrayBuffer(byteStr.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
        const blob = new Blob([ab], { type: compressed.mimeType });
        const f = new File([blob], file.name, { type: compressed.mimeType });
        setFiles((prev) => [...prev, { file: f, preview: compressed.preview, type: "image" }]);
      });
    });
  }

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    audioChunksRef.current = [];
    mr.ondataavailable = (e) => audioChunksRef.current.push(e.data);
    mr.onstop = () => {
      const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      const url = URL.createObjectURL(blob);
      const f = new File([blob], "audio.webm", { type: "audio/webm" });
      setFiles((prev) => [...prev, { file: f, preview: url, type: "audio" }]);
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

  // ── Flujo principal ──────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (files.length === 0 && !note.trim()) return;

    setPageState("uploading");
    setErrorMsg("");

    try {
      // 1. Crear draft
      const draft = await h2MealsApi.createDraft({
        nutritionDate: date,
        mealSlot: slot,
        userNote: note.trim() || undefined,
      });

      // 2. Subir archivos
      const hasImages = files.some((f) => f.type === "image");
      const hasAudio = files.some((f) => f.type === "audio");

      for (const { file } of files) {
        const { url, headers } = await h2MealsApi.getUploadUrl(
          draft.id,
          file.type,
          file.size,
        );
        await uploadToStorage(url, headers, file);
      }

      // 3. Enviar a IA
      await h2MealsApi.submitForAi(draft.id, { hasImages, hasAudio });

      setPageState("processing");

      // 4. Polling hasta que la IA termine
      const detail = await pollUntilReady(draft.id);
      setMealDetail(detail);

      if (detail.status === "pending_user_review") {
        setPageState("review");
      } else if (detail.status === "confirmed") {
        setPageState("confirmed");
      } else {
        setErrorMsg("La IA no pudo procesar la comida. Inténtalo de nuevo.");
        setPageState("error");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error desconocido");
      setPageState("error");
    }
  }

  // ── Confirmar estimación ─────────────────────────────────────────────────────

  async function handleConfirm(accept: boolean) {
    if (!mealDetail) return;
    setSaving(true);
    try {
      let confirmed: MealDetail;
      if (accept) {
        confirmed = await h2MealsApi.confirm(mealDetail.id, { acceptAiEstimate: true });
      } else {
        confirmed = await h2MealsApi.confirm(mealDetail.id, {
          acceptAiEstimate: false,
          kcal: Number(reviewKcal) || undefined,
          proteinG: Number(reviewProtein) || undefined,
          carbsG: Number(reviewCarbs) || undefined,
          fatG: Number(reviewFat) || undefined,
        });
      }
      setMealDetail(confirmed); // F4: actualizar con datos confirmados
      setPageState("confirmed");
    } catch {
      setErrorMsg("Error al confirmar. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  // ── Corrección / reprocesar ──────────────────────────────────────────────────

  async function handleReprocess() {
    if (!mealDetail) return;
    setSaving(true);
    try {
      await h2MealsApi.reprocess(mealDetail.id, {
        userExplanationText: correctionNote || undefined,
      });
      setPageState("processing");
      const detail = await pollUntilReady(mealDetail.id);
      setMealDetail(detail);
      if (detail.status === "pending_user_review") setPageState("review");
      else setPageState("error");
    } catch {
      setErrorMsg("Error al reprocesar.");
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)] md:h-full">
      {/* Cabecera */}
      <div className="flex items-center gap-3 px-4 pt-5 pb-3 border-b border-border/40 shrink-0">
        <button onClick={() => navigate(-1)} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-base font-semibold">{SLOT_LABELS[slot] ?? slot}</h1>
          <p className="text-xs text-muted-foreground">{date} · Registrar con IA</p>
        </div>
      </div>

      {/* Contenido */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">

        {/* ── Estado: idle ───────────────────────────────────────────────── */}
        {pageState === "idle" && (
          <>
            {/* Archivos adjuntos */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Añade una foto o audio de tu comida
              </p>

              {/* Previews */}
              {files.length > 0 && (
                <div className="flex gap-2 flex-wrap mb-3">
                  {files.map((f, i) => (
                    <div key={i} className="relative h-20 w-20 rounded-xl overflow-hidden border border-border/60">
                      {f.type === "image" ? (
                        <img src={f.preview} className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center bg-muted/30">
                          <Mic className="h-6 w-6 text-primary" />
                        </div>
                      )}
                      <button
                        onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 flex items-center justify-center"
                      >
                        <X className="h-3 w-3 text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Botones de media */}
              <div className="flex gap-2">
                <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addImageFiles(e.target.files)} />
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => addImageFiles(e.target.files)} />

                <button
                  onClick={() => imageInputRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-border/60 bg-muted/30 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                >
                  <Image className="h-4 w-4" />
                  Galería
                </button>
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-border/60 bg-muted/30 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                >
                  <Camera className="h-4 w-4" />
                  Cámara
                </button>
                <button
                  onClick={recording ? stopRecording : startRecording}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 rounded-xl border py-3 text-sm transition-colors",
                    recording
                      ? "border-red-500/50 bg-red-500/10 text-red-400 animate-pulse"
                      : "border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/60",
                  )}
                >
                  {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  {recording ? "Parar" : "Audio"}
                </button>
              </div>
            </div>

            {/* Nota opcional */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Nota (opcional)
              </p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ej: 200g de arroz con pollo, sin piel..."
                rows={3}
                className="w-full resize-none rounded-xl border border-border/60 bg-card px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/60"
              />
            </div>

            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={files.length === 0 && !note.trim()}
            >
              <Send className="h-4 w-4 mr-2" />
              Analizar con IA
            </Button>
          </>
        )}

        {/* ── Estado: uploading ───────────────────────────────────────────── */}
        {pageState === "uploading" && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <div className="h-12 w-12 animate-spin rounded-full border-3 border-primary border-t-transparent" />
            <p className="text-sm font-medium">Subiendo archivos…</p>
            <p className="text-xs text-muted-foreground">Esto solo tardará un momento</p>
          </div>
        )}

        {/* ── Estado: processing ─────────────────────────────────────────── */}
        {pageState === "processing" && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <div className="relative h-16 w-16">
              <div className="absolute inset-0 rounded-full border-4 border-primary/20" />
              <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center text-xl">🤖</div>
            </div>
            <p className="text-sm font-medium">La IA está analizando tu comida…</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Identificando alimentos, estimando porciones y calculando macros
            </p>
          </div>
        )}

        {/* ── Estado: review ─────────────────────────────────────────────── */}
        {pageState === "review" && mealDetail && (
          <>
            <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
              <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">Estimación de la IA</p>
              <p className="text-sm font-medium">{mealDetail.aiEstimate?.foodName ?? mealDetail.foodName ?? "Comida"}</p>
              {mealDetail.aiEstimate?.reasoning && (
                <p className="text-xs text-muted-foreground mt-1">{mealDetail.aiEstimate.reasoning}</p>
              )}
            </div>

            {/* Macros editables */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Revisa y ajusta si hace falta
              </p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Calorías (kcal)", value: reviewKcal, set: setReviewKcal, color: "text-primary" },
                  { label: "Proteína (g)", value: reviewProtein, set: setReviewProtein, color: "text-blue-400" },
                  { label: "Carbos (g)", value: reviewCarbs, set: setReviewCarbs, color: "text-violet-400" },
                  { label: "Grasas (g)", value: reviewFat, set: setReviewFat, color: "text-orange-400" },
                ].map(({ label, value, set, color }) => (
                  <div key={label}>
                    <p className={cn("text-[11px] font-medium mb-1", color)}>{label}</p>
                    <Input
                      type="number"
                      value={value}
                      onChange={(e) => set(e.target.value)}
                      className="h-9 text-sm"
                      min={0}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Acciones */}
            <div className="space-y-2">
              <Button className="w-full" onClick={() => handleConfirm(true)} disabled={saving}>
                {saving ? "Guardando…" : "Confirmar estimación de la IA"}
              </Button>
              <Button variant="outline" className="w-full" onClick={() => handleConfirm(false)} disabled={saving}>
                Guardar con mis valores
              </Button>
            </div>

            {/* Reprocesar */}
            <div className="pt-2 border-t border-border/30 space-y-2">
              <p className="text-xs text-muted-foreground">¿La IA se equivocó? Explica qué está mal:</p>
              <textarea
                value={correctionNote}
                onChange={(e) => setCorrectionNote(e.target.value)}
                placeholder="Ej: Eran 300g, no 150g. Era pollo sin piel..."
                rows={2}
                className="w-full resize-none rounded-xl border border-border/60 bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/60"
              />
              <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={handleReprocess} disabled={saving}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Volver a analizar
              </Button>
            </div>
          </>
        )}

        {/* ── Estado: confirmed ──────────────────────────────────────────── */}
        {pageState === "confirmed" && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-green-500/15">
              <CheckCircle className="h-8 w-8 text-green-400" />
            </div>
            <div>
              <p className="text-base font-semibold">¡Comida registrada!</p>
              <p className="text-sm text-muted-foreground mt-1">
                {mealDetail?.foodName ?? "Comida"} añadida al {SLOT_LABELS[slot] ?? slot}
              </p>
            </div>
            <Button className="mt-2" onClick={() => navigate(`/?date=${date}`)}>
              Volver al dashboard
            </Button>
          </div>
        )}

        {/* ── Estado: error ──────────────────────────────────────────────── */}
        {pageState === "error" && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/15">
              <X className="h-8 w-8 text-red-400" />
            </div>
            <div>
              <p className="text-base font-semibold">Algo fue mal</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">{errorMsg}</p>
            </div>
            <Button variant="outline" onClick={() => { setPageState("idle"); setFiles([]); setNote(""); }}>
              Intentar de nuevo
            </Button>
          </div>
        )}

      </div>
    </div>
  );
}
