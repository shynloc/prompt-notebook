"use client";

import { signOut, useSession } from "@/lib/auth/client";
import Link from "next/link";

export function SessionControls() {
  const { data, isPending } = useSession();

  if (isPending) return <span aria-label="正在检查登录状态">…</span>;
  if (!data) return <Link href="/sign-in">登录</Link>;

  return (
    <button
      type="button"
      onClick={async () => {
        await signOut();
        window.location.assign("/sign-in");
      }}
    >
      退出登录
    </button>
  );
}
