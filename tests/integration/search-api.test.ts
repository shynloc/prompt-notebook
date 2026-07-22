// @vitest-environment node

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { POST as bulkNotes } from "@/app/api/v1/notes/bulk/route";
import { GET as duplicates } from "@/app/api/v1/notes/duplicates/route";
import { GET as listNotes, POST as createNote } from "@/app/api/v1/notes/route";
import { POST as createProject } from "@/app/api/v1/projects/route";
import { auth } from "@/lib/auth/server";

const base = "http://localhost:3000";
function request(url: string, options: { body?: unknown; cookie?: string } = {}) { const headers = new Headers(); if (options.body !== undefined) headers.set("content-type", "application/json"); if (options.cookie) headers.set("cookie", options.cookie); return new Request(url, { method: options.body === undefined ? "GET" : "POST", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }); }
async function sessionFor(label: string) { const email = `${label}-${randomUUID()}@example.com`; const password = "correct-horse-battery"; await auth.handler(request(`${base}/api/auth/sign-up/email`, { body: { name: label, email, password } })); const response = await auth.handler(request(`${base}/api/auth/sign-in/email`, { body: { email, password } })); const token = response.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;,]+)/)?.[1]; if (!token) throw new Error("no session"); return `better-auth.session_token=${token}`; }
async function create(cookie: string, body: Record<string, unknown>) { const response = await createNote(request(`${base}/api/v1/notes`, { cookie, body: { title: "Search note", prompt: "default prompt", ...body } })); return (await response.json()).data; }

describe("advanced search and duplicate detection", () => {
  it("finds normalized exact duplicates without leaking another user", async () => {
    const owner = await sessionFor("duplicate-owner");
    const other = await sessionFor("duplicate-other");
    const first = await create(owner, { title: "First", prompt: "  Soft   Studio LIGHT " });
    await create(owner, { title: "Second", prompt: "soft studio light" });
    await create(other, { title: "Private", prompt: "soft studio light" });
    const response = await duplicates(request(`${base}/api/v1/notes/duplicates?noteId=${first.id}`, { cookie: owner }));
    const data = (await response.json()).data;
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0].notes.map((note: { title: string }) => note.title).sort()).toEqual(["First", "Second"]);
    expect(data.groups[0].notes.map((note: { title: string }) => note.title)).not.toContain("Private");
  });

  it("combines field, source host, date, image and project filters", async () => {
    const owner = await sessionFor("advanced-owner");
    const wanted = await create(owner, { title: "Botanical portrait", prompt: "editorial lighting", sourceUrl: "https://example.com/prompts/1" });
    await create(owner, { title: "Landscape", prompt: "botanical landscape", sourceUrl: "https://other.example/prompts/2" });
    const projectResponse = await createProject(request(`${base}/api/v1/projects`, { cookie: owner, body: { name: "Campaign" } }));
    const project = (await projectResponse.json()).data;
    await bulkNotes(request(`${base}/api/v1/notes/bulk`, { cookie: owner, body: { ids: [wanted.id], action: "project", projectId: project.id } }));
    const params = new URLSearchParams({ q: "botanical", field: "title", sourceHost: "example.com", projectId: project.id, dateFrom: "2020-01-01", dateTo: "2099-12-31", limit: "20" });
    const response = await listNotes(request(`${base}/api/v1/notes?${params}`, { cookie: owner }));
    const data = (await response.json()).data;
    expect(data.map((note: { id: string }) => note.id)).toEqual([wanted.id]);
  });

  it("rejects malformed host filters", async () => {
    const owner = await sessionFor("advanced-invalid");
    const response = await listNotes(request(`${base}/api/v1/notes?sourceHost=https%3A%2F%2Fevil.example`, { cookie: owner }));
    expect(response.status).toBe(422);
  });
});
