import type { Metadata } from "next";
import "./globals.css";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";

export const metadata: Metadata = {
  title: "Prompt Notebook",
  description: "A visual notebook for prompts and generated artwork.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}<ServiceWorkerRegistration /></body>
    </html>
  );
}
