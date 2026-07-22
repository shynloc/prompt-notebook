import type { CaptureDraft, ImageCandidate } from "./messages";

// This function is intentionally self-contained because Chrome serializes it for executeScript.
export function collectPageContext(selectionOverride = ""): CaptureDraft {
  const rejectedAlt = /avatar|profile|emoji|icon|logo|badge|头像|表情|图标/i;
  const asPublicUrl = (value: string | null | undefined) => {
    if (!value) return null;
    try {
      const url = new URL(value, document.baseURI);
      return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
    } catch {
      return null;
    }
  };
  const selection = window.getSelection();
  const selected = (selectionOverride || selection?.toString() || "").trim().slice(0, 100_000);
  const node = selection?.anchorNode;
  const element = node instanceof Element ? node : node?.parentElement;
  const root = element?.closest("article, main, section, [role='article'], [data-testid*='tweet']") ?? null;
  const nearby = root?.querySelector("h1, h2, h3")?.textContent?.trim();
  const socialTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"], meta[name="twitter:title"]')?.content.trim();
  const images: ImageCandidate[] = [];

  for (const image of Array.from(document.images)) {
    const url = asPublicUrl(image.currentSrc || image.src);
    const alt = image.alt.trim();
    const rect = image.getBoundingClientRect();
    const width = image.naturalWidth || image.width || Math.round(rect.width);
    const height = image.naturalHeight || image.height || Math.round(rect.height);
    if (!url || rejectedAlt.test(alt) || width < 160 || height < 120) continue;
    let score = Math.min(30, Math.round((width * height) / 100_000));
    if (root?.contains(image)) score += 60;
    if (width >= 600 && height >= 400) score += 15;
    if (alt) score += 4;
    images.push({ url, alt, width, height, score });
  }

  const metadata = document.querySelectorAll<HTMLMetaElement>('meta[property="og:image"], meta[property="og:image:url"], meta[property="og:image:secure_url"], meta[name="twitter:image"], meta[name="twitter:image:src"]');
  for (const meta of Array.from(metadata)) {
    const url = asPublicUrl(meta.content);
    if (url) images.push({ url, alt: "网页预览图", width: 0, height: 0, score: 25 });
  }

  const unique = new Map<string, ImageCandidate>();
  for (const candidate of images) {
    const current = unique.get(candidate.url);
    if (!current || current.score < candidate.score) unique.set(candidate.url, candidate);
  }
  const ranked = [...unique.values()].sort((a, b) => b.score - a.score).slice(0, 8);
  return {
    idempotencyKey: crypto.randomUUID(),
    title: (nearby || socialTitle || document.title.trim() || selected.slice(0, 60) || "网页提示词").slice(0, 200),
    prompt: selected,
    tags: [],
    sourceUrl: location.href,
    sourceTitle: document.title.trim().slice(0, 500),
    images: ranked,
    selectedImageUrls: ranked[0] ? [ranked[0].url] : [],
    updatedAt: Date.now(),
  };
}
