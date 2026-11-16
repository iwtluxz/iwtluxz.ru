(() => {
  "use strict";
  const limit = 4 * 1024 * 1024;
  const maxInput = 80 * 1024 * 1024;

  async function animated(file, type) {
    if (type === "image/gif") return true;
    if (type === "image/webp") {
      const bytes = new Uint8Array(await file.slice(0, 21).arrayBuffer());
      return bytes.length >= 21 && String.fromCharCode(...bytes.slice(12, 16)) === "VP8X" && Boolean(bytes[20] & 2);
    }
    if (type !== "image/png") return false;
    let offset = 8, chunks = 0;
    while (offset + 8 <= file.size && chunks++ < 4096) {
      const header = new Uint8Array(await file.slice(offset, offset + 8).arrayBuffer());
      const length = new DataView(header.buffer).getUint32(0);
      const name = String.fromCharCode(...header.slice(4, 8));
      if (name === "acTL") return true;
      if (name === "IDAT" || name === "IEND") return false;
      if (length > file.size - offset - 12) throw new Error("Не удалось прочитать изображение.");
      offset += length + 12;
    }
    throw new Error("Не удалось прочитать изображение.");
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Не удалось открыть изображение. Выбери другой файл.")); };
      image.src = url;
    });
  }

  function encode(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Браузер не смог сжать изображение.")), type, quality);
    });
  }

  async function compress(file, type) {
    if (file.size <= limit) return file;
    if (file.size > maxInput) throw new Error("Изображение слишком большое для обработки в браузере: максимум 80 МБ.");
    if (await animated(file, type)) throw new Error("Анимированные изображения больше 4 МБ нельзя сжать без потери анимации. Выбери файл до 4 МБ.");
    const image = await loadImage(file);
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("Не удалось определить размер изображения.");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Браузер не поддерживает сжатие изображений.");
    let scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
    const target = type === "image/jpeg" ? "image/jpeg" : "image/webp";
    for (let pass = 0; pass < 8; pass++) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.88, 0.76, 0.64, 0.52]) {
        const blob = await encode(canvas, target, quality);
        if (blob.size > 0 && blob.size <= limit && ["image/jpeg", "image/png", "image/webp"].includes(blob.type)) {
          const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[blob.type];
          return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.${extension}`, { type: blob.type, lastModified: file.lastModified });
        }
      }
      scale *= 0.75;
    }
    throw new Error("Не удалось сжать изображение до 4 МБ. Выбери изображение поменьше.");
  }

  window.IwtxzImageCompression = Object.freeze({ compress });
})();
