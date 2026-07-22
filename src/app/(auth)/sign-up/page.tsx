"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { AuthCard } from "@/components/auth/auth-card";
import { signUp } from "@/lib/auth/client";

export default function SignUpPage() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const result = await signUp.email({
      name: String(form.get("name")),
      email: String(form.get("email")),
      password: String(form.get("password")),
      callbackURL: "/",
    });

    if (result.error) {
      setMessage("暂时无法创建账号。请检查输入，或稍后再试。");
      setPending(false);
      return;
    }

    if (!result.data.token) {
      setMessage("请查看邮箱并完成验证，然后再登录。");
      setPending(false);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <AuthCard
      eyebrow="Your own library"
      title="创建账号"
      description="账号和数据属于 Prompt Notebook，不依赖 WordPress。"
      footer={<>已有账号？ <Link href="/sign-in">直接登录</Link></>}
    >
      <form className="auth-form" onSubmit={submit}>
        <label className="auth-field">
          昵称
          <input name="name" autoComplete="name" required autoFocus />
        </label>
        <label className="auth-field">
          邮箱
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label className="auth-field">
          密码
          <input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
        </label>
        {message ? <p className="auth-message" role="status">{message}</p> : null}
        <button className="auth-submit" disabled={pending} type="submit">
          {pending ? "正在创建…" : "创建账号"}
        </button>
      </form>
    </AuthCard>
  );
}
