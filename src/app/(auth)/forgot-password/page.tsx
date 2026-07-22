"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { authClient } from "@/lib/auth/client";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    await authClient.requestPasswordReset({
      email: String(form.get("email")),
      redirectTo: "/reset-password",
    });
    setSent(true);
    setPending(false);
  }

  return (
    <AuthCard
      eyebrow="Account recovery"
      title="重置密码"
      description="输入注册邮箱，我们会发送一条限时重置链接。"
      footer={<Link href="/sign-in">返回登录</Link>}
    >
      <form className="auth-form" onSubmit={submit}>
        <label className="auth-field">
          邮箱
          <input name="email" type="email" autoComplete="email" required autoFocus />
        </label>
        {sent ? <p className="auth-message" role="status">如果该邮箱已注册，重置邮件很快会送达。</p> : null}
        <button className="auth-submit" disabled={pending} type="submit">
          {pending ? "正在发送…" : "发送重置链接"}
        </button>
      </form>
    </AuthCard>
  );
}
