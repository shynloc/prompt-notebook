import { useEffect, useState, type KeyboardEvent } from "react";

import { ImageCandidates } from "../../components/ImageCandidates";
import { APP_URL, connect, disconnect, validTokens } from "../../lib/auth";
import { fetchTags, saveCapture } from "../../lib/api";
import { STORAGE_KEYS, type CaptureDraft, type CaptureResponse, type RecentCapture } from "../../lib/messages";
import { addRecent, clearDraft, clearTokens, loadDraft, loadRecent, loadTokens, saveDraft } from "../../lib/storage";
import { getAppUrl, saveAppUrl } from "../../lib/settings";

function emptyDraft(): CaptureDraft {
  return {
    idempotencyKey: crypto.randomUUID(), title: "", prompt: "", tags: [],
    sourceUrl: APP_URL, sourceTitle: "", images: [], selectedImageUrls: [], updatedAt: Date.now(),
  };
}

export function App() {
  const [draft, setDraft] = useState<CaptureDraft | null>(null);
  const [connected, setConnected] = useState(false);
  const [tagOptions, setTagOptions] = useState<Array<{ id: string; name: string; count: number }>>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<CaptureResponse | null>(null);
  const [serverUrl, setServerUrl] = useState(APP_URL);
  const [recent, setRecent] = useState<RecentCapture[]>([]);

  useEffect(() => {
    void Promise.all([loadDraft(), loadTokens(), getAppUrl(), loadRecent()]).then(([storedDraft, tokens, appUrl, recentCaptures]) => {
      setDraft(storedDraft ?? emptyDraft());
      setConnected(Boolean(tokens));
      if (tokens) void fetchTags().then(setTagOptions).catch(() => undefined);
      setServerUrl(appUrl);
      setRecent(recentCaptures);
    });
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[STORAGE_KEYS.draft]?.newValue) {
        setDraft(changes[STORAGE_KEYS.draft].newValue as CaptureDraft);
        setResult(null);
        setMessage("");
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  function update(values: Partial<CaptureDraft>) {
    setDraft((current) => {
      const next = { ...(current ?? emptyDraft()), ...values, updatedAt: Date.now() };
      void saveDraft(next);
      return next;
    });
  }

  async function linkAccount() {
    setBusy(true); setMessage("");
    try {
      if (!(await getAppUrl())) throw new Error("请先填写并验证你的服务器地址");
      await connect(`Chrome · ${navigator.platform || "browser"}`);
      setConnected(true);
      setTagOptions(await fetchTags());
      setMessage("账户连接成功，可以保存提示词了。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "连接失败");
    } finally { setBusy(false); }
  }

  function addTag(value = tagDraft) {
    if (!draft) return;
    const normalized = value.trim().normalize("NFKC");
    if (normalized && draft.tags.length < 20 && !draft.tags.some((tag) => tag.toLocaleLowerCase() === normalized.toLocaleLowerCase())) update({ tags: [...draft.tags, normalized] });
    setTagDraft("");
  }

  function tagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (["Enter", ","].includes(event.key)) { event.preventDefault(); addTag(); }
    if (event.key === "Backspace" && !tagDraft && draft?.tags.length) update({ tags: draft.tags.slice(0, -1) });
  }

  async function save() {
    if (!draft?.title.trim() || !draft.prompt.trim()) { setMessage("请填写标题和提示词内容。"); return; }
    setBusy(true); setMessage(""); setResult(null);
    try {
      if (!(await validTokens())) { setConnected(false); throw new Error("请先连接提示词笔记本账户"); }
      const saved = await saveCapture(draft);
      setResult(saved);
      await addRecent({ id: saved.note.id, title: saved.note.title, savedAt: Date.now(), replayed: saved.replayed });
      setRecent(await loadRecent());
      if (saved.replayed) setMessage("这条请求已经保存过，已返回原笔记，没有创建重复副本。");
      setMessage(saved.imageWarnings.length ? `提示词已保存；${saved.imageWarnings.length} 张图片未能导入。` : "提示词已保存到云端笔记本。");
      if (saved.replayed) setMessage("这条请求已经保存过，已返回原笔记，没有创建重复副本。");
      await clearDraft();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败，请重试");
    } finally { setBusy(false); }
  }

  async function collectAgain() {
    setMessage("正在读取当前页面…");
    await chrome.runtime.sendMessage({ type: "collect-current-page" });
  }

  async function updateServer() {
    setBusy(true); setMessage("");
    try { const appUrl = await saveAppUrl(serverUrl); await clearTokens(); setConnected(false); setServerUrl(appUrl); setMessage("服务器已验证，请重新连接账户。"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "服务器设置失败"); }
    finally { setBusy(false); }
  }

  async function openNote(id: string) { chrome.tabs.create({ url: `${await getAppUrl()}/notes/${id}/edit` }); }

  if (!draft) return <main className="panel-loading"><span className="ink-spinner" /><p>正在展开收藏卡片…</p></main>;

  return <main className="panel-shell">
    <header className="panel-header"><div><span className="brand-mark">PN</span><div><strong>Prompt Notebook</strong><small>网页提示词剪藏器</small></div></div><button type="button" onClick={() => void collectAgain()}>重新读取</button></header>
    {!connected ? <section className="connect-panel"><span className="eyebrow">ONE-TAP CAPTURE</span><h1>把灵感留在<br />正在阅读的地方</h1><p>先填写你的自建 Prompt Notebook 地址。验证后连接账户，选中的文字、来源和图片即可直接保存。</p><label className="field"><span>Prompt Notebook 地址</span><input type="url" value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="https://prompts.example.com" /></label><button disabled={busy || !serverUrl.trim()} type="button" onClick={() => void updateServer()}>{busy ? "正在验证…" : "验证服务器"}</button><button disabled={busy || !serverUrl.trim()} type="button" onClick={() => void linkAccount()}>{busy ? "正在连接…" : "连接 Prompt Notebook"}</button>{message ? <p className="panel-message" role="status">{message}</p> : null}<small>服务器地址和授权令牌只保存在此浏览器中。</small></section> : <form className="capture-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="capture-heading"><div><span className="eyebrow">QUICK CAPTURE</span><h1>收藏提示词</h1></div><span className="connection-dot">已连接</span></div>
      <label className="field"><span>标题</span><input autoFocus value={draft.title} maxLength={200} onChange={(event) => update({ title: event.target.value })} placeholder="给这条提示词一个容易找到的名字" /></label>
      <label className="field"><span>提示词内容</span><textarea value={draft.prompt} maxLength={100000} onChange={(event) => update({ prompt: event.target.value })} placeholder="在网页中选中文字后重新打开收藏卡片，或直接在这里输入…" /></label>
      <div className="field"><span>标签</span><div className="tag-editor">{draft.tags.map((tag) => <button type="button" key={tag} onClick={() => update({ tags: draft.tags.filter((item) => item !== tag) })}>{tag} ×</button>)}<input aria-label="标签" list="extension-tag-options" value={tagDraft} maxLength={40} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={tagKeyDown} onBlur={() => tagDraft && addTag()} placeholder="输入后按回车" /><datalist id="extension-tag-options">{tagOptions.map((tag) => <option key={tag.id} value={tag.name} />)}</datalist></div></div>
      <section className="image-section"><div><span>网页插图</span><small>{draft.images.length ? `识别到 ${draft.images.length} 张，已选择 ${draft.selectedImageUrls.length} 张` : "没有合适图片也可以保存"}</small></div><ImageCandidates images={draft.images} selected={draft.selectedImageUrls} onChange={(selectedImageUrls) => update({ selectedImageUrls })} /></section>
      <details className="source-section"><summary>来源信息</summary><label className="field"><span>来源标题</span><input value={draft.sourceTitle} maxLength={500} onChange={(event) => update({ sourceTitle: event.target.value })} /></label><label className="field"><span>来源链接</span><input type="url" value={draft.sourceUrl} maxLength={4000} onChange={(event) => update({ sourceUrl: event.target.value })} /></label></details>
      {message ? <p className={result ? "panel-message panel-message--success" : "panel-message"} role="status">{message}</p> : null}
      <div className="save-bar"><button className="save-button" disabled={busy} type="submit">{busy ? "正在保存…" : "保存到笔记本"}</button>{result ? <button type="button" onClick={() => void openNote(result.note.id)}>打开笔记</button> : null}</div>
      {recent.length ? <details className="recent-section"><summary>最近保存（{recent.length}）</summary><ol>{recent.map((item) => <li key={item.id}><button type="button" onClick={() => void openNote(item.id)}>{item.title}</button><small>{new Date(item.savedAt).toLocaleString("zh-CN")}{item.replayed ? " · 已去重" : ""}</small></li>)}</ol></details> : null}
      <details className="server-settings"><summary>自建服务器设置</summary><label className="field"><span>Prompt Notebook 地址</span><input type="url" value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} /></label><button disabled={busy} type="button" onClick={() => void updateServer()}>验证并切换服务器</button><small>服务器地址只保存在本机。切换后需要重新授权。</small></details>
      <footer><button type="button" onClick={async () => { await disconnect(); setConnected(false); setMessage(""); }}>断开账户</button><span>Alt + Shift + P</span></footer>
    </form>}
  </main>;
}
