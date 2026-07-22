"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { authClient } from "@/lib/auth/client";

export default function ResetPasswordPage() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    const token = new URL(window.location.href).searchParams.get("token") ?? "";
    const result = await authClient.resetPassword({
      newPassword: String(form.get("password")),
      token,
    });
    setMessage(result.error ? "链接无效或已过期，请重新申请。" : "密码已更新，现在可以使用新密码登录。");
    setPending(false);
  }

  return (
    <AuthCard
      eyebrow="Choose a new password"
      title="设置新密码"
      description="新密码至少需要 8 个字符。完成后，其他设备上的旧会话会失效。"
      footer={<Link href="/sign-in">前往登录</Link>}
    >
      <form className="auth-form" onSubmit={submit}>
        <label className="auth-field">
          新密码
          <input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required autoFocus />
        </label>
        {message ? <p className="auth-message" role="status">{message}</p> : null}
        <button className="auth-submit" disabled={pending} type="submit">
          {pending ? "正在更新…" : "更新密码"}
        </button>
      </form>
    </AuthCard>
  );
}
