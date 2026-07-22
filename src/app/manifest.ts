import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Prompt Notebook",
    short_name: "Prompt Notes",
    description: "提示词、标签与生成作品的独立云端笔记本",
    start_url: "/notes",
    display: "standalone",
    background_color: "#d6cbbd",
    theme_color: "#252320",
    lang: "zh-CN",
    categories: ["productivity", "utilities"],
    icons: [{ src: "/icons/prompt-notebook.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
