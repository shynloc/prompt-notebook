import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reverseResultFixture } from "@/test/reverse-fixture";
import { ReversePromptWorkbench } from "./reverse-prompt-workbench";

beforeEach(() => {
  vi.restoreAllMocks();
});
describe("reverse prompt workbench", () => {
  it("sends requirements, preserves observations, edits modules and invalidates changed inputs", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ data: reverseResultFixture() }));
    const onUse = vi.fn();
    render(
      <ReversePromptWorkbench
        initialSource={{ imageUrl: "https://example.com/source.png" }}
        onUse={onUse}
      />,
    );
    fireEvent.change(screen.getByLabelText("额外要求（可选）"), {
      target: { value: "把衬衫改成蓝色" },
    });
    fireEvent.click(screen.getByRole("button", { name: "AI 一键反推" }));
    expect(
      await screen.findByText("白色衬衫 → 蓝色衬衫", { exact: false }),
    ).toBeVisible();
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
      additionalRequirements: "把衬衫改成蓝色",
      language: "zh",
    });
    fireEvent.click(screen.getByRole("tab", { name: "分模块编辑" }));
    fireEvent.change(screen.getByLabelText(/服饰与配件/), {
      target: { value: "蓝色丝绸衬衫" },
    });
    fireEvent.click(screen.getByRole("button", { name: "使用这个 Prompt" }));
    expect(onUse).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("蓝色丝绸衬衫"),
      }),
    );
    fireEvent.change(screen.getByLabelText("额外要求（可选）"), {
      target: { value: "改成红色" },
    });
    expect(
      screen.getByRole("button", { name: "使用这个 Prompt" }),
    ).toBeDisabled();
  });
  it("cancels late results and never reopens or applies them", async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(pending);
    render(
      <ReversePromptWorkbench
        initialSource={{ imageUrl: "https://example.com/source.png" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "AI 一键反推" }));
    fireEvent.click(screen.getByRole("button", { name: "取消反推" }));
    release(Response.json({ data: reverseResultFixture() }));
    await waitFor(() =>
      expect(screen.queryByText("反推结果")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText("已取消反推，图片与额外要求仍然保留。"),
    ).toBeVisible();
  });
  it("prevents double saves and retries the same idempotent request", async () => {
    let saveAttempt = 0;
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) => {
        if (String(url).endsWith("reverse-prompt"))
          return Response.json({ data: reverseResultFixture() });
        if (String(url) === "/api/v1/notes") {
          if (++saveAttempt === 1) throw new Error("offline");
          return Response.json({ data: { id: "saved-note" } });
        }
        throw new Error("unexpected request");
      });
    render(
      <ReversePromptWorkbench
        initialSource={{ imageUrl: "https://example.com/source.png" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "AI 一键反推" }));
    const save = await screen.findByRole("button", {
      name: "保存为提示词笔记",
    });
    fireEvent.click(save);
    fireEvent.click(save);
    await screen.findByRole("alert");
    fireEvent.click(save);
    await screen.findByText("提示词笔记已保存。");
    const saves = fetcher.mock.calls.filter(
      ([url]) => String(url) === "/api/v1/notes",
    );
    expect(saves).toHaveLength(2);
    expect(new Headers(saves[0][1]?.headers).get("idempotency-key")).toMatch(
      /^reverse-note:/,
    );
    expect(saves[0][1]?.headers).toEqual(saves[1][1]?.headers);
    expect(screen.getByRole("button", { name: "已保存为笔记" })).toBeDisabled();
  });
  it("shows model configuration errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        {
          error: {
            code: "AI_REVERSE_PROMPT_NOT_CONFIGURED",
            message: "请配置反推模型",
          },
        },
        { status: 422 },
      ),
    );
    render(
      <ReversePromptWorkbench
        initialSource={{ imageUrl: "https://example.com/source.png" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "AI 一键反推" }));
    expect(
      await screen.findByRole("link", { name: "配置图片反推模型" }),
    ).toHaveAttribute("href", "/settings/ai");
  });
  it("renders provider content as inert text instead of executable HTML", async () => {
    const result = reverseResultFixture();
    result.structure.uncertainties = ['<img src=x onerror="alert(1)">'];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ data: result }),
    );
    const { container } = render(
      <ReversePromptWorkbench
        initialSource={{ imageUrl: "https://example.com/source.png" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "AI 一键反推" }));
    expect(
      await screen.findByText('<img src=x onerror="alert(1)">'),
    ).toBeVisible();
    expect(container.querySelector("[onerror]")).toBeNull();
  });
});
