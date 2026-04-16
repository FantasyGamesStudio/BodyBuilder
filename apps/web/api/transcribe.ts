import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { audioBase64, mimeType = "audio/webm" } = req.body as {
    audioBase64: string;
    mimeType?: string;
  };

  if (!audioBase64) {
    return res.status(400).json({ error: "audioBase64 is required" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY not configured" });
  }

  try {
    const buffer = Buffer.from(audioBase64, "base64");
    const blob = new Blob([buffer], { type: mimeType });

    const formData = new FormData();
    formData.append("file", blob, "audio.webm");
    formData.append("model", "whisper-1");
    formData.append("language", "es");

    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      }
    );

    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: `OpenAI error: ${err}` });
    }

    const data = (await response.json()) as { text: string };
    return res.status(200).json({ text: data.text });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: `Error al transcribir: ${msg}` });
  }
}
