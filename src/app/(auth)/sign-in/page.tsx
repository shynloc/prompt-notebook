"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useSyncExternalStore, type FormEvent } from "react";

import { AuthCard } from "@/components/auth/auth-card";
import { signIn } from "@/lib/auth/client";

export default function SignInPage() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const hydrated = useSyncExternalStore(() => () => undefined, () => true, () => false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const result = await signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
      rememberMe: form.get("rememberMe") === "on",
    });

    if (result.error) {
      setMessage("邮箱或密码不正确，请检查后重试。");
      setPending(false);
      return;
    }

    const requested = new URLSearchParams(window.location.search).get("returnTo");
    const returnTo = requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/";
    router.replace(returnTo);
    router.refresh();
  }

  return (
    <AuthCard
      eyebrow="Welcome back"
      title="登录"
      description="继续整理你的提示词、参数和生成作品。"
      footer={<>还没有账号？ <Link href="/sign-up">创建账号</Link></>}
    >
      <form className="auth-form" onSubmit={submit}>
        <label className="auth-field">
          邮箱
          <input name="email" type="email" autoComplete="email" required autoFocus />
        </label>
        <label className="auth-field">
          密码
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <label><input name="rememberMe" type="checkbox" /> 在这台设备上保持登录</label>
        {message ? <p className="auth-message" role="alert">{message}</p> : null}
        <button className="auth-submit" disabled={pending || !hydrated} type="submit">
          {pending ? "正在登录…" : "登录"}
        </button>
        <Link href="/forgot-password">忘记密码？</Link>
      </form>
    </AuthCard>
  );
}
