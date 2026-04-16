/**
 * Redimensiona y comprime una imagen a JPEG antes de enviarla al servidor.
 * - maxDim: lado máximo en píxeles (default 1024, suficiente para GPT-4o)
 * - quality: calidad JPEG 0–1 (default 0.82)
 * Devuelve { base64, mimeType, preview } listo para la cola de imágenes.
 */
export function compressImage(
  file: File,
  maxDim = 1024,
  quality = 0.82,
): Promise<{ base64: string; mimeType: string; preview: string }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new window.Image();

    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("No se pudo cargar la imagen")); };
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) { height = Math.round(height * maxDim / width); width = maxDim; }
        else { width = Math.round(width * maxDim / height); height = maxDim; }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas no disponible")); return; }

      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      const base64 = dataUrl.split(",")[1];

      resolve({ base64, mimeType: "image/jpeg", preview: dataUrl });
    };

    img.src = objectUrl;
  });
}
