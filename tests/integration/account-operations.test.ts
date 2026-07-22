// @vitest-environment node

import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { POST as deleteAccount } from "@/app/api/v1/account/delete/route";
import { GET as accountStatus } from "@/app/api/v1/account/status/route";
import { GET as mediaIntegrity } from "@/app/api/v1/media/integrity/route";
import { POST as createNote } from "@/app/api/v1/notes/route";
import { DELETE as removeNote } from "@/app/api/v1/notes/[id]/route";
import { POST as emptyTrash } from "@/app/api/v1/trash/empty/route";
import { auth } from "@/lib/auth/server";

const authBase = "http://localhost:3000/api/auth";
const apiBase = "http://localhost:3000/api/v1";

function request(url: string, options: { body?: unknown; cookie?: string; method?: string } = {}) {
  const headers = new Headers();
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  return new Request(url, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function sessionFor(label: string) {
  const email = `${label}-${randomUUID()}@example.com`;
  const password = "correct-horse-battery";
  await auth.handler(request(`${authBase}/sign-up/email`, { body: { name: label, email, password } }));
  const response = await auth.handler(request(`${authBase}/sign-in/email`, { body: { email, password } }));
  const token = response.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;,]+)/)?.[1];
  if (!token) throw new Error("missing session cookie");
  return { cookie: `better-auth.session_token=${token}`, password };
}

async function create(cookie: string, title: string) {
  const response = await createNote(request(`${apiBase}/notes`, { cookie, body: { title, prompt: "test prompt" } }));
  expect(response.status).toBe(201);
  return (await response.json()).data;
}

describe("account safety operations", () => {
  it("summarizes owner storage and does not expose another account", async () => {
    const owner = await sessionFor("status-owner");
    const other = await sessionFor("status-other");
    await create(owner.cookie, "Owner note");
    await create(other.cookie, "Other note");

    const response = await accountStatus(request(`${apiBase}/account/status`, { cookie: owner.cookie }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.notes.active).toBe(1);
    expect(body.data.images).toBe(0);
  });

  it("permanently purges only the signed-in user's trash", async () => {
    const owner = await sessionFor("trash-owner");
    const other = await sessionFor("trash-other");
    const mine = await create(owner.cookie, "Mine");
    const theirs = await create(other.cookie, "Theirs");
    await removeNote(request(`${apiBase}/notes/${mine.id}`, { cookie: owner.cookie, method: "DELETE", body: { version: mine.version } }), { params: Promise.resolve({ id: mine.id }) });
    await removeNote(request(`${apiBase}/notes/${theirs.id}`, { cookie: other.cookie, method: "DELETE", body: { version: theirs.version } }), { params: Promise.resolve({ id: theirs.id }) });

    const purged = await emptyTrash(request(`${apiBase}/trash/empty`, { cookie: owner.cookie, body: { limit: 10 } }));
    const otherStatus = await accountStatus(request(`${apiBase}/account/status`, { cookie: other.cookie }));
    expect((await purged.json()).data).toMatchObject({ deleted: 1, remaining: 0 });
    expect((await otherStatus.json()).data.notes.trash).toBe(1);
  });

  it("returns a conservative image integrity report", async () => {
    const owner = await sessionFor("integrity");
    const response = await mediaIntegrity(request(`${apiBase}/media/integrity`, { cookie: owner.cookie }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ references: 0, remoteDeletionSupported: false });
  });

  it("requires password and typed confirmation before deleting an account", async () => {
    const owner = await sessionFor("delete-account");
    await create(owner.cookie, "Will be deleted");
    const wrongPhrase = await deleteAccount(request(`${apiBase}/account/delete`, { cookie: owner.cookie, body: { password: owner.password, confirmation: "DELETE" } }));
    const wrongPassword = await deleteAccount(request(`${apiBase}/account/delete`, { cookie: owner.cookie, body: { password: "not-the-password", confirmation: "DELETE MY ACCOUNT" } }));
    const deleted = await deleteAccount(request(`${apiBase}/account/delete`, { cookie: owner.cookie, body: { password: owner.password, confirmation: "DELETE MY ACCOUNT" } }));
    const after = await accountStatus(request(`${apiBase}/account/status`, { cookie: owner.cookie }));

    expect(wrongPhrase.status).toBe(422);
    expect(wrongPassword.status).toBe(400);
    expect(deleted.status).toBe(200);
    expect(after.status).toBe(401);
  });
});
