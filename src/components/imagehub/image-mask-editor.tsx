"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";

import { AppDialog } from "@/components/ai/app-dialog";
import "./image-mask-editor.css";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const PREVIEW_MAX_EDGE = 1600;

type Point = { x: number; y: number };
type Stroke = { size: number; points: Point[] };
type LoadedImage = { source: File; url: string; width: number; height: number };

export type ImageMaskEditorProps = {
  source: File;
  onApply: (mask: File) => void;
  onClose: () => void;
};

/** Map the displayed image (not the surrounding letterbox) to original pixels. */
export function imageMaskPoint(
  clientX: number,
  clientY: number,
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
  width: number,
  height: number,
): Point | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  return {
    x: Math.max(0, Math.min(width, ((clientX - bounds.left) / bounds.width) * width)),
    y: Math.max(0, Math.min(height, ((clientY - bounds.top) / bounds.height) * height)),
  };
}

/** Transparent pixels are editable; all other pixels must stay opaque white. */
export function binaryImageMaskAlpha(pixels: Uint8ClampedArray): void {
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = pixels[index + 1] = pixels[index + 2] = 255;
    pixels[index + 3] = pixels[index + 3] < 255 ? 0 : 255;
  }
}

function paintStroke(context: CanvasRenderingContext2D, stroke: Stroke) {
  const first = stroke.points[0];
  if (!first) return;
  context.lineWidth = stroke.size;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.arc(first.x, first.y, stroke.size / 2, 0, 2 * Math.PI);
  context.fill();
  if (stroke.points.length < 2) return;
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
  context.stroke();
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("无法导出蒙版，请重试。"));
      else resolve(blob);
    }, "image/png");
  });
}

export function ImageMaskEditor({ source, onApply, onClose }: ImageMaskEditorProps) {
  const titleId = useId();
  const helpId = useId();
  const [loaded, setLoaded] = useState<LoadedImage | null>(null);
  const [loadError, setLoadError] = useState<{ source: File; message: string } | null>(null);
  const [exportError, setExportError] = useState("");
  const [brushSize, setBrushSize] = useState(40);
  const [strokeCount, setStrokeCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<LoadedImage | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const pointerRef = useRef<{ id: number; stroke: Stroke } | null>(null);
  const sessionRef = useRef<{ active: boolean } | null>(null);
  const savingRef = useRef(false);
  const closedRef = useRef(false);
  const currentImage = loaded?.source === source ? loaded : null;
  const currentError = loadError?.source === source ? loadError.message : "";

  useEffect(() => {
    const session = { active: true };
    sessionRef.current = session;
    imageRef.current = null;
    strokesRef.current = [];
    pointerRef.current = null;
    savingRef.current = false;
    closedRef.current = false;
    let url: string | null = null;
    let image: HTMLImageElement | null = null;

    const decode = async () => {
      if (source.size > MAX_IMAGE_BYTES) throw new Error("原图不能超过 10 MiB，请使用较小的图片。");
      url = URL.createObjectURL(source);
      image = new Image();
      const decoder = image;
      await new Promise<void>((resolve, reject) => {
        decoder.onload = () => resolve();
        decoder.onerror = () => reject(new Error("无法读取这张图片，请重新选择 PNG、JPEG 或 WebP 图片。"));
        decoder.src = url!;
      });
      if (!session.active || closedRef.current) return;
      const width = decoder.naturalWidth;
      const height = decoder.naturalHeight;
      if (!width || !height || width * height > MAX_IMAGE_PIXELS) {
        throw new Error("原图尺寸无效或超过 4000 万像素，请使用较小的图片。");
      }
      const next = { source, url: url!, width, height };
      imageRef.current = next;
      setLoaded(next);
      setLoadError(null);
      setExportError("");
      setStrokeCount(0);
      setSaving(false);
    };
    void decode().catch((error: unknown) => {
      if (session.active && !closedRef.current) {
        setLoadError({ source, message: error instanceof Error ? error.message : "无法读取图片。" });
      }
    });

    return () => {
      session.active = false;
      if (image) {
        image.onload = null;
        image.onerror = null;
        image.src = "";
      }
      if (url) URL.revokeObjectURL(url);
    };
  }, [source]);

  function close() {
    closedRef.current = true;
    onClose();
  }

  function previewContext() {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || image.source !== source) return null;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.setTransform(canvas.width / image.width, 0, 0, canvas.height / image.height, 0, 0);
    context.fillStyle = context.strokeStyle = "#ec6a38";
    return context;
  }

  function redraw() {
    const context = previewContext();
    const image = imageRef.current;
    if (!context || !image) return;
    context.clearRect(0, 0, image.width, image.height);
    for (const stroke of strokesRef.current) paintStroke(context, stroke);
  }

  function pointFor(event: PointerEvent<HTMLCanvasElement>) {
    const image = imageRef.current;
    if (!image || image.source !== source) return null;
    return imageMaskPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), image.width, image.height);
  }

  function startStroke(event: PointerEvent<HTMLCanvasElement>) {
    if (savingRef.current || pointerRef.current || event.button !== 0 || event.isPrimary === false) return;
    const point = pointFor(event);
    const image = imageRef.current;
    const bounds = event.currentTarget.getBoundingClientRect();
    const context = previewContext();
    if (!point || !image || !context) return;
    event.preventDefault();
    // Brush controls are in displayed pixels, so the visible brush stays predictable.
    const stroke = { size: brushSize * image.width / bounds.width, points: [point] };
    strokesRef.current.push(stroke);
    pointerRef.current = { id: event.pointerId, stroke };
    event.currentTarget.setPointerCapture(event.pointerId);
    paintStroke(context, stroke);
    setStrokeCount(strokesRef.current.length);
    setExportError("");
  }

  function moveStroke(event: PointerEvent<HTMLCanvasElement>) {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId || savingRef.current) return;
    const point = pointFor(event);
    const context = previewContext();
    if (!point || !context) return;
    event.preventDefault();
    const previous = pointer.stroke.points[pointer.stroke.points.length - 1];
    pointer.stroke.points.push(point);
    context.lineWidth = pointer.stroke.size;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function endStroke(event: PointerEvent<HTMLCanvasElement>) {
    if (pointerRef.current?.id !== event.pointerId) return;
    pointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function undo() {
    pointerRef.current = null;
    strokesRef.current.pop();
    setStrokeCount(strokesRef.current.length);
    setExportError("");
    redraw();
  }

  function clear() {
    pointerRef.current = null;
    strokesRef.current = [];
    setStrokeCount(0);
    setExportError("");
    redraw();
  }

  async function apply() {
    const image = imageRef.current;
    const session = sessionRef.current;
    if (!image || image.source !== source || !session || savingRef.current || !strokesRef.current.length) return;
    savingRef.current = true;
    pointerRef.current = null;
    setSaving(true);
    setExportError("");
    const canvas = document.createElement("canvas");
    const isCurrent = () => session.active && !closedRef.current && sessionRef.current === session;
    try {
      // Give the saving indicator a chance to paint before the full-resolution work.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!isCurrent()) return;
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("浏览器不支持蒙版绘制，请更换浏览器后重试。");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, image.width, image.height);
      context.globalCompositeOperation = "destination-out";
      context.fillStyle = context.strokeStyle = "#000000";
      for (const stroke of strokesRef.current) paintStroke(context, stroke);
      const pixels = context.getImageData(0, 0, image.width, image.height);
      binaryImageMaskAlpha(pixels.data);
      context.putImageData(pixels, 0, 0);
      const blob = await canvasPng(canvas);
      if (!isCurrent()) return;
      if (blob.size > MAX_IMAGE_BYTES) throw new Error("导出的蒙版超过 10 MiB，请减少涂抹细节后重试。");
      const name = source.name.replace(/\.[^.]+$/, "") || "image";
      onApply(new File([blob], `${name}-mask.png`, { type: "image/png" }));
    } catch (error: unknown) {
      if (isCurrent()) setExportError(error instanceof Error ? error.message : "无法导出蒙版，请重试。");
    } finally {
      // Release large backing buffers after encoding, including cancelled exports.
      canvas.width = canvas.height = 0;
      if (isCurrent()) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  }

  const previewScale = currentImage ? Math.min(1, PREVIEW_MAX_EDGE / Math.max(currentImage.width, currentImage.height)) : 1;
  const ready = Boolean(currentImage) && !currentError;

  return (
    <AppDialog labelledBy={titleId} className="image-mask-editor" onClose={close}>
      <section className="image-mask-editor__panel">
        <header className="image-mask-editor__header">
          <div>
            <span className="image-mask-editor__kicker">LOCAL MASK EDITOR</span>
            <h2 id={titleId}>涂抹要修改的区域</h2>
          </div>
          <button type="button" className="image-mask-editor__close" onClick={close} aria-label="关闭蒙版编辑器">×</button>
        </header>
        <p id={helpId} className="image-mask-editor__help">用鼠标、触控笔或手指涂抹。橙色区域会重新生成，其余区域将尽量保留。</p>
        <div className="image-mask-editor__tools" aria-label="蒙版绘制工具">
          <label htmlFor={`${titleId}-brush`}>笔刷大小 <output>{brushSize}px</output></label>
          <input id={`${titleId}-brush`} type="range" min="8" max="160" step="4" value={brushSize} disabled={!ready || saving} onChange={(event) => setBrushSize(Number(event.target.value))} />
          <button type="button" disabled={!ready || !strokeCount || saving} onClick={undo}>撤销上一笔</button>
          <button type="button" disabled={!ready || !strokeCount || saving} onClick={clear}>清空涂抹</button>
        </div>
        <div className="image-mask-editor__stage" aria-busy={!ready && !currentError}>
          {currentImage && !currentError ? (
            <div className="image-mask-editor__image" style={{ aspectRatio: `${currentImage.width} / ${currentImage.height}`, width: `min(100%, ${currentImage.width / currentImage.height * 54}vh)` }}>
              {/* The local file is displayed unmodified; only the separate canvas is painted. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={currentImage.url} alt="待局部修改的原图" draggable={false} />
              <canvas
                key={currentImage.url}
                ref={canvasRef}
                width={Math.max(1, Math.round(currentImage.width * previewScale))}
                height={Math.max(1, Math.round(currentImage.height * previewScale))}
                aria-label="蒙版绘制画布"
                aria-describedby={helpId}
                onPointerDown={startStroke}
                onPointerMove={moveStroke}
                onPointerUp={endStroke}
                onPointerCancel={endStroke}
                onLostPointerCapture={endStroke}
              />
            </div>
          ) : !currentError ? <p role="status">正在读取原图…</p> : null}
        </div>
        {currentError || exportError ? <p className="image-mask-editor__error" role="alert">{currentError || exportError}</p> : null}
        <footer className="image-mask-editor__footer">
          <span className="image-mask-editor__detail">{currentImage ? `${currentImage.width} × ${currentImage.height} · ${strokeCount} 笔涂抹` : "蒙版仅在本地编辑"}</span>
          {saving ? <span role="status">正在导出蒙版…</span> : null}
          <button type="button" onClick={close}>{saving ? "取消导出" : "取消"}</button>
          <button type="button" className="image-mask-editor__apply" disabled={!ready || !strokeCount || saving} onClick={() => void apply()}>{saving ? "正在导出…" : "使用此蒙版"}</button>
        </footer>
      </section>
    </AppDialog>
  );
}
