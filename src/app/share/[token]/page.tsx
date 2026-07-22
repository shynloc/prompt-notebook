import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Image from "next/image";
import { ShareService } from "@/modules/sharing/share-service";
import { ShareCopyButton } from "@/components/sharing/share-copy-button";

const service = new ShareService();
export default async function SharedPromptPage({ params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  const requestHeaders = await headers();
  let share;
  try { share = await service.publicRead(token, requestHeaders.get("cf-connecting-ip") ?? requestHeaders.get("x-forwarded-for") ?? "anonymous"); } catch { notFound(); }
  return <main className="shared-prompt"><article><span className="section-kicker">SHARED PROMPT</span><h1>{share.title}</h1>{share.image ? <Image unoptimized src={share.image.displayUrl} alt="" width={share.image.width} height={share.image.height} /> : null}<pre>{share.prompt}</pre>{share.negativePrompt ? <><h2>负面提示词</h2><pre>{share.negativePrompt}</pre></> : null}{share.source?.url ? <a href={share.source.url} rel="noopener noreferrer">来源：{share.source.title || new URL(share.source.url).hostname}</a> : null}{share.allowCopy ? <ShareCopyButton prompt={share.prompt} /> : <p>分享者已关闭一键复制。</p>}<small>链接有效期至 {new Date(share.expiresAt).toLocaleString("zh-CN")}</small></article></main>;
}
