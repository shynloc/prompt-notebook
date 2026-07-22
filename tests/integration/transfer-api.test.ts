// @vitest-environment node

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { auth } from "@/lib/auth/server";
import { GET as exportNotebook } from "@/app/api/v1/account/export/route";
import { POST as importNotebook } from "@/app/api/v1/account/import/commit/route";
import { POST as previewNotebook } from "@/app/api/v1/account/import/preview/route";
import { POST as createNote } from "@/app/api/v1/notes/route";

function request(url: string, options: { body?: string | object; cookie?: string } = {}) {
  const headers = new Headers();
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  return new Request(url, { method: options.body === undefined ? "GET" : "POST", headers, body: typeof options.body === "string" ? options.body : options.body === undefined ? undefined : JSON.stringify(options.body) });
}

async function sessionFor(label: string) {
  const email = `${label}-${randomUUID()}@example.com`; const password = "correct-horse-battery";
  await auth.handler(request("http://localhost:3000/api/auth/sign-up/email", { body: { name: label, email, password } }));
  const response = await auth.handler(request("http://localhost:3000/api/auth/sign-in/email", { body: { email, password } }));
  const token = (response.headers.get("set-cookie") ?? "").match(/better-auth\.session_token=([^;,]+)/)?.[1];
  if (!token) throw new Error("Sign-in did not return a session cookie");
  return `better-auth.session_token=${token}`;
}

describe("notebook transfer API", () => {
  it("exports, previews, imports, and safely repeats an import", async () => {
    const sourceCookie = await sessionFor("export-source");
    await createNote(request("http://localhost:3000/api/v1/notes", { cookie: sourceCookie, body: { title: "Portable", prompt: "portable prompt", tags: ["backup"] } }));
    const exported = await exportNotebook(request("http://localhost:3000/api/v1/account/export", { cookie: sourceCookie }));
    const document = await exported.text();
    expect(exported.headers.get("content-disposition")).toContain("prompt-notebook-");

    const targetCookie = await sessionFor("import-target");
    const preview = await previewNotebook(request("http://localhost:3000/api/v1/account/import/preview", { cookie: targetCookie, body: document }));
    expect((await preview.json()).data.newNotes).toBe(1);
    const first = await importNotebook(request("http://localhost:3000/api/v1/account/import/commit", { cookie: targetCookie, body: document }));
    expect((await first.json()).data.imported).toBe(1);
    const second = await importNotebook(request("http://localhost:3000/api/v1/account/import/commit", { cookie: targetCookie, body: document }));
    const secondBody = await second.json();
    expect(secondBody.data).toMatchObject({ imported: 0, skipped: 1 });
  });
});
