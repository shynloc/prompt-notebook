import { collectPageContext } from "../lib/page-collector";
import { saveDraft } from "../lib/storage";
import type { CaptureDraft } from "../lib/messages";
import { getAppUrl } from "../lib/settings";

async function collect(tab: { id?: number; title?: string; url?: string }, selectionText = "") {
  let draft: CaptureDraft;
  try {
    if (!tab.id) throw new Error("No active tab");
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectPageContext,
      args: [selectionText],
    });
    if (!result.result) throw new Error("No page context");
    draft = result.result;
  } catch {
    const appUrl = await getAppUrl();
    draft = {
      idempotencyKey: crypto.randomUUID(),
      title: (tab.title || selectionText.slice(0, 60) || "新提示词").slice(0, 200),
      prompt: selectionText.slice(0, 100_000),
      tags: [],
      sourceUrl: tab.url?.startsWith("http") ? tab.url : appUrl,
      sourceTitle: (tab.title || "").slice(0, 500),
      images: [],
      selectedImageUrls: [],
      updatedAt: Date.now(),
    };
  }
  await saveDraft(draft);
}

async function openAndCollect(tab: { id?: number; windowId?: number; title?: string; url?: string }, selectionText = "") {
  if (tab.windowId !== undefined) void chrome.sidePanel.open({ windowId: tab.windowId });
  await collect(tab, selectionText);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll().then(() => chrome.contextMenus.create({
    id: "save-to-prompt-notebook",
    title: "保存到提示词笔记本",
    contexts: ["selection"],
  }));
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
});

chrome.action.onClicked.addListener((tab) => { void openAndCollect(tab); });
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "save-to-prompt-notebook" && tab) void openAndCollect(tab, info.selectionText ?? "");
});
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "save-prompt") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) void openAndCollect(tab);
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "collect-current-page") return false;
  void chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
    if (tab) await collect(tab);
    sendResponse({ ok: Boolean(tab) });
  });
  return true;
});
