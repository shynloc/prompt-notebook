import type { ImageCandidate } from "../lib/messages";

/* eslint-disable @next/next/no-img-element */

export function ImageCandidates({ images, selected, onChange }: {
  images: ImageCandidate[];
  selected: string[];
  onChange: (urls: string[]) => void;
}) {
  if (!images.length) return <p className="empty-images">没有识别到适合的网页图片，仍可只保存文字。</p>;
  function toggle(url: string) {
    onChange(selected.includes(url) ? selected.filter((item) => item !== url) : selected.length < 8 ? [...selected, url] : selected);
  }
  return <div className="candidate-grid">{images.map((image, index) => <label className={selected.includes(image.url) ? "candidate candidate--selected" : "candidate"} key={image.url}>
    <input type="checkbox" checked={selected.includes(image.url)} onChange={() => toggle(image.url)} />
    <img src={image.url} alt={image.alt || `候选图片 ${index + 1}`} loading="lazy" />
    <span>{selected.includes(image.url) ? "已选择" : "选择"}</span>
  </label>)}</div>;
}
