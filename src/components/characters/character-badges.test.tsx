import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CharacterBadges } from "./character-badges";

describe("CharacterBadges", () => {
  it("links a note relationship back to the AI Model profile", () => {
    render(<CharacterBadges profiles={[{
      id: "11111111-1111-4111-8111-111111111111",
      name: "Luna",
      summary: "都市时装角色",
      archivedAt: null,
      deletedAt: null,
      role: "primary",
      sortOrder: 0,
      avatar: {
        id: "22222222-2222-4222-8222-222222222222",
        thumbnailUrl: "https://img.example.com/luna-thumb.png",
        displayUrl: "https://img.example.com/luna.png",
        focusX: 45,
        focusY: 38,
      },
    }]} />);

    const link = screen.getByRole("link", { name: "主要角色 AI Model：Luna" });
    expect(link).toHaveAttribute("href", "/ai-models/11111111-1111-4111-8111-111111111111");
    expect(screen.getByText("主要角色")).toBeVisible();
  });
});
