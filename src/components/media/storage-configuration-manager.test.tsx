import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatStorageBytes, StorageConfigurationManager } from "./storage-configuration-manager";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const local = {
  providerType: "local", endpoint: "", tokenHint: "", enabled: true, picbedConfigured: false,
  local: { usedBytes: 2 * 1024 ** 2, quotaBytes: 1024 ** 3 },
  lastTestStatus: null, lastTestMessage: null, lastTestedAt: null,
};
const external = { ...local, providerType: "picbed", endpoint: "https://images.example.com/upload", tokenHint: "••••1234", picbedConfigured: true };

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); router.push.mockReset(); });

describe("storage configuration manager", () => {
  it("starts with usable local storage, account quota and no provider credentials", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: local }));
    vi.stubGlobal("fetch", fetcher);
    render(<StorageConfigurationManager />);
    expect(await screen.findByRole("radio", { name: "站点本地存储" })).toBeChecked();
    expect(screen.getByText("当前：站点本地存储")).toBeVisible();
    expect(screen.getByText("2 MiB")).toBeVisible();
    expect(screen.getByText("1 GiB")).toBeVisible();
    expect(screen.getByText(/删除笔记或移除图片引用不会自动释放存储空间/)).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "本地存储使用率" })).toHaveAttribute("value", String(2 / 1024 * 100));
    expect(screen.queryByLabelText("访问令牌")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("图床上传端点")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "外部图床" }));
    expect(screen.getByText("当前：站点本地存储")).toBeVisible();
    expect(screen.getByText("尚未保存")).toBeVisible();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "测试当前存储" })).toBeDisabled();
  });

  it("shows only the masked external token and preserves it for endpoint-only updates", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { void input; void init; return Response.json({ data: external }); });
    vi.stubGlobal("fetch", fetcher);
    render(<StorageConfigurationManager />);
    expect(await screen.findByDisplayValue(external.endpoint)).toBeVisible();
    expect(screen.getByPlaceholderText(/••••1234/)).toHaveValue("");
    fireEvent.submit(screen.getByRole("button", { name: "保存存储设置" }).closest("form")!);
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    const request = fetcher.mock.calls.find(([, init]) => init?.method === "PUT")?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({ providerType: "picbed", endpoint: external.endpoint, enabled: true });
    expect(await screen.findByRole("status")).toHaveTextContent("外部图床配置已加密保存");
  });

  it("requires a token only when a new external connection is selected", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: local }));
    vi.stubGlobal("fetch", fetcher);
    render(<StorageConfigurationManager />);
    fireEvent.click(await screen.findByRole("radio", { name: "外部图床" }));
    fireEvent.change(screen.getByLabelText("图床上传端点"), { target: { value: external.endpoint } });
    fireEvent.submit(screen.getByRole("button", { name: "保存存储设置" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("必须填写访问令牌");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("saves a local-only selection once and retains a configured external connection", async () => {
    let finish: (response: Response) => void = () => undefined;
    const gate = new Promise<Response>((resolve) => { finish = resolve; });
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "PUT" ? gate : Response.json({ data: external }));
    vi.stubGlobal("fetch", fetcher);
    render(<StorageConfigurationManager />);
    fireEvent.click(await screen.findByRole("radio", { name: "站点本地存储" }));
    const form = screen.getByRole("button", { name: "保存存储设置" }).closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    expect(screen.getByRole("button", { name: "正在保存存储设置…" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "外部图床" })).toBeDisabled();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    const request = fetcher.mock.calls.find(([, init]) => init?.method === "PUT")?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({ providerType: "local" });
    finish(Response.json({ data: { ...external, providerType: "local" } }));
    expect(await screen.findByRole("status")).toHaveTextContent("已有图片不会迁移");
    expect(screen.getByText("当前：站点本地存储")).toBeVisible();
    fireEvent.click(screen.getByRole("radio", { name: "外部图床" }));
    expect(screen.getByLabelText("图床上传端点")).toHaveValue(external.endpoint);
    expect(screen.getByLabelText("访问令牌")).not.toBeRequired();
  });

  it("keeps the saved provider unchanged after a failed switch", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "PUT"
      ? Response.json({ error: { message: "存储设置暂时不能保存" } }, { status: 503 }) : Response.json({ data: external })));
    render(<StorageConfigurationManager />);
    fireEvent.click(await screen.findByRole("radio", { name: "站点本地存储" }));
    fireEvent.submit(screen.getByRole("button", { name: "保存存储设置" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("存储设置暂时不能保存");
    expect(screen.getByText("当前：外部图床")).toBeVisible();
    expect(screen.getByText("尚未保存")).toBeVisible();
  });

  it("tests the saved local storage and shows explicit completion feedback", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/test")
      ? Response.json({ data: { ok: true, providerType: "local" } }) : Response.json({ data: local }));
    vi.stubGlobal("fetch", fetcher);
    render(<StorageConfigurationManager />);
    fireEvent.click(await screen.findByRole("button", { name: "测试当前存储" }));
    expect(await screen.findByRole("status")).toHaveTextContent("写入、读取和清理测试");
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/test"))).toHaveLength(1);
  });

  it("clearly marks a disabled external provider and never claims uploads are active", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { ...external, enabled: false } })));
    render(<StorageConfigurationManager />);
    const badge = await screen.findByText("外部图床已停用", { exact: true });
    expect(badge).not.toHaveClass("ai-status--enabled");
    expect(screen.getByText("外部图床已停用，当前不能上传")).toBeVisible();
    expect(screen.queryByText("正在使用外部图床")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "启用这套外部图床配置" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "测试当前存储" })).toBeDisabled();
    // Another device can change the state again before the response returns;
    // feedback must reflect the server-confirmed state, not the submitted draft.
    fireEvent.click(screen.getByRole("checkbox", { name: "启用这套外部图床配置" }));
    fireEvent.submit(screen.getByRole("button", { name: "保存存储设置" }).closest("form")!);
    expect(await screen.findByRole("status")).toHaveTextContent("已加密保存并停用。当前不能上传图片");
    expect(screen.queryByText("外部图床配置已加密保存。后续上传使用此配置，已有图片不会迁移。")).not.toBeInTheDocument();
  });

  it("deletes only the external connection and returns to local storage", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => Response.json({ data: init?.method === "DELETE" ? local : external }));
    vi.stubGlobal("fetch", fetcher);
    render(<StorageConfigurationManager />);
    fireEvent.click(await screen.findByRole("button", { name: "删除外部图床配置" }));
    expect(await screen.findByRole("status")).toHaveTextContent("后续上传使用站点本地存储");
    expect(screen.getByRole("radio", { name: "站点本地存储" })).toBeChecked();
    expect(screen.queryByRole("button", { name: "删除外部图床配置" })).not.toBeInTheDocument();
  });

  it("does not show a usable save form when configuration loading fails, and supports retry", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async () => ++attempts === 1 ? Response.json({ data: { invalid: true } }) : Response.json({ data: local })));
    render(<StorageConfigurationManager />);
    expect(await screen.findByRole("alert")).toHaveTextContent("配置响应无效");
    expect(screen.queryByRole("button", { name: "保存存储设置" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByRole("radio", { name: "站点本地存储" })).toBeChecked();
  });

  it("redirects an expired session through the client router", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: {} }, { status: 401 })));
    render(<StorageConfigurationManager />);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/sign-in?returnTo=/settings/storage"));
  });

  it("formats quota values without decimal noise", () => {
    expect(formatStorageBytes(0)).toBe("0 B");
    expect(formatStorageBytes(1536)).toBe("1.5 KiB");
    expect(formatStorageBytes(1024 ** 3)).toBe("1 GiB");
  });
});
