import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NoteView } from "@/components/notes/types";
import { ShareManager } from "./share-manager";

const note: NoteView = {
  id: "4d1266f3-e63d-4d98-b1bd-bc706524e959",
  title: "Shared prompt",
  prompt: "Prompt body",
  negativePrompt: null,
  favorite: false,
  version: 1,
  updatedAt: "2026-07-22T00:00:00.000Z",
  tags: [],
  characterProfiles: [],
  images: [],
  coverImage: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ShareManager", () => {
  it("uses an explicit button, copies a short link, and shows its validity", async () => {
    const active = {
      id: "dc05d126-4f6f-4800-bbca-8b6d930874c3",
      token: "20260722Ab3Xq",
      createdAt: "2026-07-22T00:00:00.000Z",
      expiresAt: "2026-07-29T00:00:00.000Z",
      viewCount: 0,
    };
    let getCount = 0;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return Response.json({ data: { ...active, reused: false } }, { status: 201 });
      getCount += 1;
      return Response.json({ data: getCount === 1 ? [] : [active] });
    });
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("fetch", fetcher);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(<ShareManager note={note} />);
    const button = screen.getByRole("button", { name: "创建 7 天分享并复制链接" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(await screen.findByRole("status")).toHaveTextContent("分享链接已复制");
    expect(writeText).toHaveBeenCalledWith("http://localhost:3000/share/20260722Ab3Xq");
    expect(await screen.findByText(/分享始于/)).toHaveTextContent("过期于");
    expect(screen.getByRole("button", { name: "复制分享链接" })).toBeVisible();
  });

  it("shows immediate progress and prevents duplicate create requests", async () => {
    let resolveCreate!: (response: Response) => void;
    const createResponse = new Promise<Response>((resolve) => { resolveCreate = resolve; });
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return createResponse;
      return Response.json({ data: [] });
    });
    vi.stubGlobal("fetch", fetcher);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => undefined) } });

    render(<ShareManager note={note} />);
    const button = screen.getByRole("button", { name: "创建 7 天分享并复制链接" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    fireEvent.click(button);

    expect(screen.getByRole("button", { name: /正在创建分享/ })).toBeDisabled();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    resolveCreate(Response.json({ data: { token: "20260722Ab3Xq" } }, { status: 201 }));
    await screen.findByRole("status");
  });
});
