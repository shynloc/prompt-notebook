export const imageAspectRatios = [
  { id: "1:1", label: "方形" },
  { id: "4:3", label: "横版" },
  { id: "3:4", label: "竖版" },
  { id: "3:2", label: "摄影横幅" },
  { id: "2:3", label: "摄影竖幅" },
  { id: "16:9", label: "宽屏" },
  { id: "9:16", label: "手机竖屏" },
] as const;

export type ImageAspectRatio = (typeof imageAspectRatios)[number]["id"];

export const imageResolutionTiers = [
  { id: "1k", label: "1K", detail: "快速预览" },
  { id: "2k", label: "2K", detail: "精细输出" },
  { id: "4k", label: "4K", detail: "实验性" },
] as const;

export type ImageResolutionTier = (typeof imageResolutionTiers)[number]["id"];

type ImageSize = { width: number; height: number };

const imageSizePresets: Record<ImageResolutionTier, Record<ImageAspectRatio, ImageSize>> = {
  "1k": {
    "1:1": { width: 1024, height: 1024 },
    "4:3": { width: 1024, height: 768 },
    "3:4": { width: 768, height: 1024 },
    "3:2": { width: 1152, height: 768 },
    "2:3": { width: 768, height: 1152 },
    "16:9": { width: 1280, height: 720 },
    "9:16": { width: 720, height: 1280 },
  },
  "2k": {
    "1:1": { width: 2048, height: 2048 },
    "4:3": { width: 2048, height: 1536 },
    "3:4": { width: 1536, height: 2048 },
    "3:2": { width: 2016, height: 1344 },
    "2:3": { width: 1344, height: 2016 },
    "16:9": { width: 2048, height: 1152 },
    "9:16": { width: 1152, height: 2048 },
  },
  "4k": {
    // GPT Image 2 caps total output at 8,294,400 pixels, so square and
    // classic-photo ratios use the largest valid multiple-of-16 canvas.
    "1:1": { width: 2880, height: 2880 },
    "4:3": { width: 3264, height: 2448 },
    "3:4": { width: 2448, height: 3264 },
    "3:2": { width: 3504, height: 2336 },
    "2:3": { width: 2336, height: 3504 },
    "16:9": { width: 3840, height: 2160 },
    "9:16": { width: 2160, height: 3840 },
  },
};

export function imageSizeFor(aspectRatio: ImageAspectRatio, resolution: ImageResolutionTier) {
  return imageSizePresets[resolution][aspectRatio];
}
