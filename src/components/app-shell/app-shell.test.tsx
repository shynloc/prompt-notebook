import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("offers the desktop notebook destinations", () => {
    render(<AppShell>Notebook content</AppShell>);

    const navigation = screen.getByRole("navigation", {
      name: "桌面主导航",
    });

    for (const label of ["全部提示词", "收藏", "归档", "回收站", "分享管理", "标签", "提示词百科", "图床设置", "新建 Prompt"]) {
      expect(within(navigation).getByRole("link", { name: label })).toBeVisible();
    }
  });

  it("offers the mobile task navigation", () => {
    render(<AppShell>Notebook content</AppShell>);

    const navigation = screen.getByRole("navigation", {
      name: "移动主导航",
    });

    for (const label of ["作品库", "收藏", "新建", "词库", "我的"]) {
      expect(within(navigation).getByRole("link", { name: label })).toBeVisible();
    }
  });
});
