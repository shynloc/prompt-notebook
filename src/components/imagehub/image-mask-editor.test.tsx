import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { binaryImageMaskAlpha, ImageMaskEditor, imageMaskPoint } from "./image-mask-editor";

let decodedWidth = 400;
let decodedHeight = 200;
let failDecode = false;
let deferExport = false;
let finishExport: ((blob: Blob | null) => void) | undefined;
let exportedSize: { width: number; height: number } | null = null;
const contexts = new WeakMap<HTMLCanvasElement, ReturnType<typeof canvasContext>>();

function canvasContext() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 127]) })),
    putImageData: vi.fn<(pixels: { data: Uint8ClampedArray }, x: number, y: number) => void>(),
    fillStyle: "",
    strokeStyle: "",
    globalCompositeOperation: "source-over",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
  };
}

function source() {
  return new File(["image fixture"], "original.webp", { type: "image/webp" });
}

async function draw() {
  const canvas = await screen.findByLabelText("蒙版绘制画布") as HTMLCanvasElement;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 10, top: 20, width: 200, height: 100, right: 210, bottom: 120, x: 10, y: 20, toJSON: () => ({}) });
  fireEvent.pointerDown(canvas, { clientX: 60, clientY: 45, pointerId: 1, button: 0, isPrimary: true });
  fireEvent.pointerMove(canvas, { clientX: 160, clientY: 95, pointerId: 1, button: 0, isPrimary: true });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
  return canvas;
}

beforeEach(() => {
  decodedWidth = 400;
  decodedHeight = 200;
  failDecode = false;
  deferExport = false;
  finishExport = undefined;
  exportedSize = null;
  vi.stubGlobal("Image", class {
    naturalWidth = decodedWidth;
    naturalHeight = decodedHeight;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) {
      if (value) queueMicrotask(() => failDecode ? this.onerror?.() : this.onload?.());
    }
  });
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.isPrimary = init.isPrimary ?? true;
    }
  });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => `blob:mask-${Math.random()}`) });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    const context = contexts.get(this) ?? canvasContext();
    contexts.set(this, context);
    return context as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback) {
    exportedSize = { width: this.width, height: this.height };
    finishExport = callback;
    if (!deferExport) callback(new Blob(["encoded png"], { type: "image/png" }));
  });
  Object.defineProperties(HTMLCanvasElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("image mask geometry and alpha", () => {
  it("maps client coordinates to original pixels, including a non-square scaled image", () => {
    expect(imageMaskPoint(160, 95, { left: 10, top: 20, width: 200, height: 100 }, 4000, 2000)).toEqual({ x: 3000, y: 1500 });
    expect(imageMaskPoint(-4, 900, { left: 10, top: 20, width: 200, height: 100 }, 4000, 2000)).toEqual({ x: 0, y: 2000 });
    expect(imageMaskPoint(1, 1, { left: 0, top: 0, width: 0, height: 1 }, 100, 100)).toBeNull();
  });

  it("makes painted and antialiased edge pixels fully transparent while preserving opaque white", () => {
    const pixels = new Uint8ClampedArray([
      255, 255, 255, 255,
      255, 255, 255, 254,
      50, 20, 90, 128,
      0, 0, 0, 0,
    ]);
    binaryImageMaskAlpha(pixels);
    expect([...pixels]).toEqual([
      255, 255, 255, 255,
      255, 255, 255, 0,
      255, 255, 255, 0,
      255, 255, 255, 0,
    ]);
  });
});

describe("ImageMaskEditor", () => {
  it("requires painting, scales pointer input, supports undo, and clears the selection", async () => {
    render(<ImageMaskEditor source={source()} onApply={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "涂抹要修改的区域" })).toBeVisible();
    const apply = screen.getByRole("button", { name: "使用此蒙版" });
    expect(apply).toBeDisabled();
    const canvas = await draw();
    expect(contexts.get(canvas)?.arc).toHaveBeenCalledWith(100, 50, 40, 0, 2 * Math.PI);
    expect(contexts.get(canvas)?.lineTo).toHaveBeenCalledWith(300, 150);
    expect(apply).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "撤销上一笔" }));
    expect(apply).toBeDisabled();
    expect(contexts.get(canvas)?.clearRect).toHaveBeenCalledWith(0, 0, 400, 200);
    await draw();
    fireEvent.click(screen.getByRole("button", { name: "清空涂抹" }));
    expect(apply).toBeDisabled();
  });

  it("exports the original pixel dimensions and a PNG mask rather than the color preview", async () => {
    const onApply = vi.fn();
    decodedWidth = 4000;
    decodedHeight = 2000;
    render(<ImageMaskEditor source={source()} onApply={onApply} onClose={vi.fn()} />);
    const preview = await draw();
    expect(preview.width).toBe(1600);
    expect(preview.height).toBe(800);
    fireEvent.click(screen.getByRole("button", { name: "使用此蒙版" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    expect(exportedSize).toEqual({ width: 4000, height: 2000 });
    const mask = onApply.mock.calls[0][0] as File;
    expect(mask).toBeInstanceOf(File);
    expect(mask.type).toBe("image/png");
    expect(mask.name).toBe("original-mask.png");
    const getContexts = vi.mocked(HTMLCanvasElement.prototype.getContext).mock.results;
    const exported = getContexts[getContexts.length - 1].value as ReturnType<typeof canvasContext>;
    expect(exported.globalCompositeOperation).toBe("destination-out");
    expect([...exported.putImageData.mock.calls[0][0].data]).toEqual([255, 255, 255, 255, 255, 255, 255, 0]);
  });

  it("reports a decode failure without enabling confirmation", async () => {
    failDecode = true;
    render(<ImageMaskEditor source={source()} onApply={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("无法读取这张图片");
    expect(screen.getByRole("button", { name: "使用此蒙版" })).toBeDisabled();
  });

  it("rejects oversized input before creating an object URL", async () => {
    const oversized = source();
    Object.defineProperty(oversized, "size", { value: 10 * 1024 * 1024 + 1 });
    render(<ImageMaskEditor source={oversized} onApply={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("原图不能超过 10 MiB");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("rejects images larger than 40 million original pixels", async () => {
    decodedWidth = 8000;
    decodedHeight = 6000;
    render(<ImageMaskEditor source={source()} onApply={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("超过 4000 万像素");
    expect(screen.queryByLabelText("蒙版绘制画布")).not.toBeInTheDocument();
  });

  it("shows export progress, cancels a late result, and releases the local URL", async () => {
    deferExport = true;
    const onApply = vi.fn();
    const onClose = vi.fn();
    const { unmount } = render(<ImageMaskEditor source={source()} onApply={onApply} onClose={onClose} />);
    await draw();
    fireEvent.click(screen.getByRole("button", { name: "使用此蒙版" }));
    expect(await screen.findByText("正在导出蒙版…")).toHaveAttribute("role", "status");
    await waitFor(() => expect(finishExport).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "取消导出" }));
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    await act(async () => { finishExport?.(new Blob(["late png"], { type: "image/png" })); });
    expect(onApply).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("rejects a mask larger than 10 MiB and permits retry", async () => {
    deferExport = true;
    const onApply = vi.fn();
    render(<ImageMaskEditor source={source()} onApply={onApply} onClose={vi.fn()} />);
    await draw();
    fireEvent.click(screen.getByRole("button", { name: "使用此蒙版" }));
    await waitFor(() => expect(finishExport).toBeDefined());
    const oversized = new Blob(["oversized"], { type: "image/png" });
    Object.defineProperty(oversized, "size", { value: 10 * 1024 * 1024 + 1 });
    await act(async () => { finishExport?.(oversized); });
    expect(await screen.findByRole("alert")).toHaveTextContent("导出的蒙版超过 10 MiB");
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "使用此蒙版" })).toBeEnabled();
  });

  it("ignores an export from a replaced source and resets the drawing", async () => {
    deferExport = true;
    const onApply = vi.fn();
    const first = source();
    const { rerender } = render(<ImageMaskEditor source={first} onApply={onApply} onClose={vi.fn()} />);
    await draw();
    fireEvent.click(screen.getByRole("button", { name: "使用此蒙版" }));
    await waitFor(() => expect(finishExport).toBeDefined());
    rerender(<ImageMaskEditor source={source()} onApply={onApply} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("400 × 200 · 0 笔涂抹")).toBeVisible());
    await act(async () => { finishExport?.(new Blob(["previous mask"], { type: "image/png" })); });
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "使用此蒙版" })).toBeDisabled();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("recovers from an unavailable PNG encoder without losing the selection", async () => {
    deferExport = true;
    render(<ImageMaskEditor source={source()} onApply={vi.fn()} onClose={vi.fn()} />);
    await draw();
    fireEvent.click(screen.getByRole("button", { name: "使用此蒙版" }));
    await waitFor(() => expect(finishExport).toBeDefined());
    await act(async () => { finishExport?.(null); });
    expect(await screen.findByRole("alert")).toHaveTextContent("无法导出蒙版");
    expect(screen.getByText("400 × 200 · 1 笔涂抹")).toBeVisible();
    expect(screen.getByRole("button", { name: "使用此蒙版" })).toBeEnabled();
  });
});
