// @vitest-environment node

import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { DELETE as revokeShare, PATCH as renewShare } from "@/app/api/v1/shares/[id]/route";
import { GET as listShares, POST as createShare } from "@/app/api/v1/shares/route";
import { POST as createNote } from "@/app/api/v1/notes/route";
import { auth } from "@/lib/auth/server";
import { ShareService } from "@/modules/sharing/share-service";

process.env.CREDENTIAL_ENCRYPTION_KEYS = `sharing-test:${randomBytes(32).toString("base64url")}`;
process.env.CREDENTIAL_ACTIVE_KEY_ID = "sharing-test";

const base = "http://localhost:3000";
function request(url: string, options: { body?: unknown; cookie?: string; method?: string } = {}) { const headers = new Headers(); if (options.body !== undefined) headers.set("content-type", "application/json"); if (options.cookie) headers.set("cookie", options.cookie); return new Request(url, { method: options.method ?? (options.body === undefined ? "GET" : "POST"), headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }); }
async function sessionFor(label: string) { const email = `${label}-${randomUUID()}@example.com`; const password = "correct-horse-battery"; await auth.handler(request(`${base}/api/auth/sign-up/email`, { body: { name: label, email, password } })); const response = await auth.handler(request(`${base}/api/auth/sign-in/email`, { body: { email, password } })); const token = response.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;,]+)/)?.[1]; if (!token) throw new Error("no session"); return `better-auth.session_token=${token}`; }
async function note(cookie: string) { const response = await createNote(request(`${base}/api/v1/notes`, { cookie, body: { title: "Shared title", prompt: "private prompt body", sourceUrl: "https://private.example/source" } })); return (await response.json()).data; }

describe("revocable read-only sharing", () => {
  it("creates a short token, returns it to its owner, and omits owner data from public reads", async () => {
    const owner = await sessionFor("share-owner");
    const createdNote = await note(owner);
    const response = await createShare(request(`${base}/api/v1/shares`, { cookie: owner, body: { noteId: createdNote.id, expiresInDays: 7, allowCopy: false, includeImage: false, includeSource: false } }));
    const created = (await response.json()).data;
    const listed = await listShares(request(`${base}/api/v1/shares?noteId=${createdNote.id}`, { cookie: owner }));
    const publicShare = await new ShareService().publicRead(created.token, `test-${randomUUID()}`);
    expect(created.token).toMatch(/^\d{8}[23456789A-HJ-NP-Za-km-z]{5}$/);
    expect((await listed.json()).data).toEqual(expect.arrayContaining([expect.objectContaining({ token: created.token, title: "Shared title" })]));
    expect(publicShare).toMatchObject({ title: "Shared title", prompt: "private prompt body", allowCopy: false, image: null, source: null });
    expect(publicShare).not.toHaveProperty("userId");
  });

  it("prevents cross-owner revocation and rejects a revoked token", async () => {
    const owner = await sessionFor("share-revoke-owner");
    const attacker = await sessionFor("share-revoke-attacker");
    const createdNote = await note(owner);
    const created = (await (await createShare(request(`${base}/api/v1/shares`, { cookie: owner, body: { noteId: createdNote.id, expiresInDays: 1, allowCopy: true, includeImage: true, includeSource: false } }))).json()).data;
    const denied = await revokeShare(request(`${base}/api/v1/shares/${created.id}`, { cookie: attacker, method: "DELETE" }), { params: Promise.resolve({ id: created.id }) });
    const revoked = await revokeShare(request(`${base}/api/v1/shares/${created.id}`, { cookie: owner, method: "DELETE" }), { params: Promise.resolve({ id: created.id }) });
    expect(denied.status).toBe(404);
    expect(revoked.status).toBe(200);
    const listed = await listShares(request(`${base}/api/v1/shares?noteId=${createdNote.id}`, { cookie: owner }));
    expect((await listed.json()).data).toEqual([]);
    await expect(new ShareService().publicRead(created.token, `test-${randomUUID()}`)).rejects.toMatchObject({ status: 404 });
  });

  it("extends an active share by seven days", async () => {
    const owner = await sessionFor("share-renew-owner");
    const createdNote = await note(owner);
    const created = (await (await createShare(request(`${base}/api/v1/shares`, { cookie: owner, body: { noteId: createdNote.id, expiresInDays: 7, allowCopy: true, includeImage: true, includeSource: false } }))).json()).data;
    const response = await renewShare(request(`${base}/api/v1/shares/${created.id}`, { cookie: owner, method: "PATCH", body: { action: "renew" } }), { params: Promise.resolve({ id: created.id }) });
    const renewed = (await response.json()).data;
    expect(response.status).toBe(200);
    expect(new Date(renewed.expiresAt).getTime()).toBeGreaterThan(new Date(created.expiresAt).getTime() + 6.9 * 86_400_000);
  });
});
