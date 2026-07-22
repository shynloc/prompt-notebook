import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShareManagement } from "./share-management";

const activeShare = {
  id: "dc05d126-4f6f-4800-bbca-8b6d930874c3",
  noteId: "4d1266f3-e63d-4d98-b1bd-bc706524e959",
  title: "正在分享的提示词",
  previewImageUrl: null,
  createdAt: "2026-07-22T00:00:00.000Z",
  expiresAt: "2026-07-29T00:00:00.000Z",
  viewCount: 3,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ShareManagement", () => {
  it("lists active shares, renews them, and removes them immediately when closed", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") return Response.json({ data: { id: activeShare.id, expiresAt: "2026-08-05T00:00:00.000Z" } });
      if (init?.method === "DELETE") return Response.json({ data: { revoked: true } });
      return Response.json({ data: [activeShare] });
    });
    vi.stubGlobal("fetch", fetcher);

    render(<ShareManagement />);
    expect(await screen.findByText(activeShare.title)).toBeVisible();
    expect(screen.getByText("3 次查看")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "续期 7 天" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已续期 7 天");
    await waitFor(() => expect(screen.getByRole("button", { name: "立即关闭" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "立即关闭" }));
    expect(await screen.findByText(/目前没有有效的提示词分享/)).toBeVisible();
    expect(screen.queryByText(activeShare.title)).not.toBeInTheDocument();
  });
});
