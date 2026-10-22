const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const MAX_RESULT_BYTES = 40 * 1024 * 1024;
const MAX_EDIT_PIXELS = 40_000_000;

/** Preserve native dimensions and alpha while fitting a generated image into the reference budget. */
export async function prepareEditingImage(blob: Blob, name: string, mimeType: string): Promise<File> {
  if (!blob.size || blob.size > MAX_RESULT_BYTES) throw new Error("这张图片超过继续编辑的文件大小限制，请下载并压缩后重新上传。");
  if (blob.size <= MAX_REFERENCE_BYTES) return new File([blob], name, { type: mimeType });
  if (typeof createImageBitmap !== "function") throw new Error("这张图片超过 10MB，请下载后压缩，或更换支持自动压缩的浏览器。");
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  try {
    if (bitmap.width <= 0 || bitmap.height <= 0 || bitmap.width * bitmap.height > MAX_EDIT_PIXELS) throw new Error("这张图片的像素过大，请下载后缩小再继续编辑。");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器暂时无法压缩大图，请下载并压缩后重新上传。");
    context.drawImage(bitmap, 0, 0);
    for (const quality of [0.92, 0.82, 0.7]) {
      const compressed = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
      if (compressed?.type === "image/webp" && compressed.size > 0 && compressed.size <= MAX_REFERENCE_BYTES) {
        return new File([compressed], `${name.replace(/\.[^.]+$/, "")}-edit.webp`, { type: "image/webp" });
      }
    }
    throw new Error("图片自动压缩后仍超过 10MB，请下载后缩小再继续编辑。");
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}
