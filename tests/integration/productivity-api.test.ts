// @vitest-environment node

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { POST as bulkNotes } from "@/app/api/v1/notes/bulk/route";
import { GET as listVersions } from "@/app/api/v1/notes/[id]/versions/route";
import { POST as restoreVersion } from "@/app/api/v1/notes/[id]/versions/[versionId]/restore/route";
import { PATCH as patchNote } from "@/app/api/v1/notes/[id]/route";
import { POST as createNote } from "@/app/api/v1/notes/route";
import { GET as listProjects, POST as createProject } from "@/app/api/v1/projects/route";
import { GET as listTemplates, POST as createTemplate } from "@/app/api/v1/templates/route";
import { auth } from "@/lib/auth/server";

const base = "http://localhost:3000";
function request(url: string, options: { body?: unknown; cookie?: string; method?: string } = {}) { const headers = new Headers(); if (options.body !== undefined) headers.set("content-type", "application/json"); if (options.cookie) headers.set("cookie", options.cookie); return new Request(url, { method: options.method ?? (options.body === undefined ? "GET" : "POST"), headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }); }
async function sessionFor(label: string) { const email = `${label}-${randomUUID()}@example.com`; const password = "correct-horse-battery"; await auth.handler(request(`${base}/api/auth/sign-up/email`, { body: { name: label, email, password } })); const response = await auth.handler(request(`${base}/api/auth/sign-in/email`, { body: { email, password } })); const token = response.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;,]+)/)?.[1]; if (!token) throw new Error("no session"); return { cookie: `better-auth.session_token=${token}` }; }
async function create(cookie: string, title = "Original") { const response = await createNote(request(`${base}/api/v1/notes`, { cookie, body: { title, prompt: "initial prompt" } })); return (await response.json()).data; }
const noteContext = (id: string) => ({ params: Promise.resolve({ id }) });

describe("productivity APIs", () => {
  it("captures immutable versions and restores with optimistic concurrency", async () => {
    const owner = await sessionFor("history-owner");
    const attacker = await sessionFor("history-attacker");
    const note = await create(owner.cookie);
    const updatedResponse = await patchNote(request(`${base}/api/v1/notes/${note.id}`, { cookie: owner.cookie, method: "PATCH", body: { version: note.version, title: "Updated" } }), noteContext(note.id));
    const updated = (await updatedResponse.json()).data;
    const versionsResponse = await listVersions(request(`${base}/api/v1/notes/${note.id}/versions`, { cookie: owner.cookie }), noteContext(note.id));
    const versions = (await versionsResponse.json()).data;
    const hidden = await listVersions(request(`${base}/api/v1/notes/${note.id}/versions`, { cookie: attacker.cookie }), noteContext(note.id));
    const restored = await restoreVersion(request(`${base}/api/v1/notes/${note.id}/versions/${versions[0].id}/restore`, { cookie: owner.cookie, body: { version: updated.version } }), { params: Promise.resolve({ id: note.id, versionId: versions[0].id }) });
    const conflict = await restoreVersion(request(`${base}/api/v1/notes/${note.id}/versions/${versions[0].id}/restore`, { cookie: owner.cookie, body: { version: updated.version } }), { params: Promise.resolve({ id: note.id, versionId: versions[0].id }) });
    expect(versions[0].snapshot.title).toBe("Original");
    expect((await hidden.json()).data).toHaveLength(0);
    expect((await restored.json()).data.title).toBe("Original");
    expect(conflict.status).toBe(409);
  });

  it("keeps projects owner-scoped and applies bounded project batches", async () => {
    const owner = await sessionFor("project-owner");
    const other = await sessionFor("project-other");
    const note = await create(owner.cookie, "Batch note");
    const projectResponse = await createProject(request(`${base}/api/v1/projects`, { cookie: owner.cookie, body: { name: "Client A" } }));
    const project = (await projectResponse.json()).data;
    const applied = await bulkNotes(request(`${base}/api/v1/notes/bulk`, { cookie: owner.cookie, body: { ids: [note.id], action: "project", projectId: project.id } }));
    const otherProjects = await listProjects(request(`${base}/api/v1/projects`, { cookie: other.cookie }));
    const oversized = await bulkNotes(request(`${base}/api/v1/notes/bulk`, { cookie: owner.cookie, body: { ids: Array.from({ length: 101 }, () => randomUUID()), action: "favorite" } }));
    expect((await applied.json()).data.updated).toBe(1);
    expect((await otherProjects.json()).data).toHaveLength(0);
    expect(oversized.status).toBe(422);
  });

  it("extracts variables and renders templates deterministically", async () => {
    const owner = await sessionFor("template-owner");
    const created = await createTemplate(request(`${base}/api/v1/templates`, { cookie: owner.cookie, body: { name: "Portrait", content: "A {{style}} portrait of {{subject}}, {{style}} lighting" } }));
    const rendered = await createTemplate(request(`${base}/api/v1/templates`, { cookie: owner.cookie, body: { mode: "render", content: "A {{style}} portrait of {{subject}}", values: { style: "editorial", subject: "a botanist" } } }));
    const listed = await listTemplates(request(`${base}/api/v1/templates`, { cookie: owner.cookie }));
    expect((await created.json()).data.variables).toEqual(["style", "subject"]);
    expect((await rendered.json()).data.rendered).toBe("A editorial portrait of a botanist");
    expect((await listed.json()).data).toHaveLength(1);
  });
});
