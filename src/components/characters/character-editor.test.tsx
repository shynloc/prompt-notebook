import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CharacterEditor } from "./character-editor";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  push.mockReset();
  refresh.mockReset();
});

describe("CharacterEditor", () => {
  it("creates a role card and provides clear save feedback", async () => {
    let finish: (value: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const fetcher = vi.spyOn(globalThis, "fetch").mockReturnValue(pending);
    render(<CharacterEditor />);

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Luna" } });
    fireEvent.change(screen.getByLabelText("角色设定"), { target: { value: "都市时装摄影中的虚拟模特" } });
    fireEvent.change(screen.getByLabelText("用途方向"), { target: { value: "时尚" } });
    fireEvent.keyDown(screen.getByLabelText("用途方向"), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "创建 AI Model" }));

    expect(screen.getByRole("button", { name: "正在保存…" })).toBeDisabled();
    finish(Response.json({ data: { id: "11111111-1111-4111-8111-111111111111" } }, { status: 201 }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/ai-models/11111111-1111-4111-8111-111111111111"));
    const call = fetcher.mock.calls[0];
    expect(call[0]).toBe("/api/v1/ai-models");
    expect(call[1]?.method).toBe("POST");
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({
      name: "Luna",
      roleDefinition: "都市时装摄影中的虚拟模特",
      useCases: ["时尚"],
      images: [],
    });
  });
});
