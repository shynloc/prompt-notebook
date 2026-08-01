import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardView } from "./dashboard-view";

const snapshot = {
  summary: {
    totalNotes: 128,
    activeSharedNotes: 6,
    totalTags: 24,
    totalTerms: 386,
    totalFavorites: 32,
    totalProjects: 8,
    trashNotes: 4,
    totalPromptCharacters: 126580,
  },
  tags: [
    { id: "f11e5c3c-db2a-4c57-87e-5b2d620c65bc2", name: "电影感", noteCount: 17 },
    { id: "00000000-0000-0000-0000-000000000001", name: "空标签", noteCount: 0 },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe("DashboardView", () => {
  it("renders eight ordered metrics and links tag rows to their collection", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: snapshot }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    render(<DashboardView />);

    await screen.findByText("总提示词笔记数量");
    const cards = screen.getAllByTestId("dashboard-stat-card");
    expect(cards).toHaveLength(8);
    expect(cards.map((card) => within(card).getByText(/总提示词笔记数量|分享中的提示词数量|总标签数|总百科词汇量|总收藏数量|总项目数量|回收站内数量|总提示词字数合计/).textContent)).toEqual([
      "总提示词笔记数量",
      "分享中的提示词数量",
      "总标签数",
      "总百科词汇量",
      "总收藏数量",
      "总项目数量",
      "回收站内数量",
      "总提示词字数合计",
    ]);
    expect(screen.getByText("126,580")).toBeVisible();
    expect(screen.getByRole("link", { name: "电影感" })).toHaveAttribute("href", "/tags/f11e5c3c-db2a-4c57-87e-5b2d620c65bc2");
    expect(screen.getByRole("cell", { name: "17" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "0" })).toBeVisible();
  });

  it("shows an actionable error and succeeds when retried", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: snapshot }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));

    render(<DashboardView />);
    const retry = await screen.findByRole("button", { name: "重新加载" });
    fireEvent.click(retry);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("126,580")).toBeVisible();
  });
});
