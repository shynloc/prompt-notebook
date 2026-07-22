import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StorageConfigurationManager } from "./storage-configuration-manager";

const setting = {
  providerType: "picbed",
  endpoint: "https://images.example.com/upload",
  tokenHint: "••••1234",
  enabled: true,
  lastTestStatus: null,
  lastTestMessage: null,
  lastTestedAt: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("storage configuration manager", () => {
  it("shows only the masked token and preserves it on endpoint-only updates", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") return Response.json({ data: setting });
      return Response.json({ data: setting });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<StorageConfigurationManager />);

    expect(await screen.findByDisplayValue(setting.endpoint)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/••••1234/)).toBeInTheDocument();
    expect(screen.queryByText("private-token-1234")).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole("button", { name: "保存图床配置" }).closest("form")!);

    await waitFor(() => {
      const call = fetcher.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).not.toHaveProperty("token");
    });
  });

  it("requires a token for the first configuration", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: null })));
    render(<StorageConfigurationManager />);
    await screen.findByRole("heading", { name: "连接图片存储" });
    fireEvent.change(screen.getByLabelText("图床上传端点"), { target: { value: "https://images.example.com/upload" } });
    fireEvent.submit(screen.getByRole("button", { name: "保存图床配置" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("必须填写访问令牌");
  });
});
