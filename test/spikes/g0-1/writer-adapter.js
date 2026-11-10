#!/usr/bin/env node
/*
 * G0-1 spike: single-writer adapter in front of FableCut's HTTP API.
 *
 * NOT PRODUCT CODE. This is a throwaway evidence harness for M0-T2/G0-1.
 * It does not modify FableCut; it only calls its /api/project over HTTP.
 *
 * Contract:
 *   PUT /project
 *   { projectId, baseRevision, commandId, project }
 *   -> 200 { ok, projectId, revision, commandId } | 409 | 400
 *
 * GET /project -> current project + projectId + revision
 * GET /health  -> { ok, projectId, writer }
 * GET /events  -> SSE after each commit
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".g0-data");
const PROJECT_ID = process.env.PROJECT_ID || "P";
const BASE_URL = process.env.FABLECUT_BASE_URL || "http://127.0.0.1:7790";
const PORT = Number(process.env.ADAPTER_PORT || 7792);
const LOCK = path.join(DATA_DIR, ".adapter.lock");
const LEDGER = path.join(DATA_DIR, ".adapter-ledger.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function acquireLock() {
  const token = `${process.pid}-${Date.now()}`;
  try {
    const fd = fs.openSync(LOCK, "wx");
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
    fs.closeSync(fd);
    return token;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    let old = null;
    try { old = JSON.parse(fs.readFileSync(LOCK, "utf8")); } catch {}
    if (old && old.pid) {
      try { process.kill(old.pid, 0); console.error(`another adapter is running: pid ${old.pid}`); process.exit(2); }
      catch { /* stale */ }
    }
    try { fs.unlinkSync(LOCK); } catch {}
    const fd = fs.openSync(LOCK, "wx");
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
    fs.closeSync(fd);
    return token;
  }
}

const token = acquireLock();
function releaseLock() {
  try {
    const cur = JSON.parse(fs.readFileSync(LOCK, "utf8"));
    if (cur.token === token) fs.unlinkSync(LOCK);
  } catch {}
}
process.on("exit", releaseLock);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

function readLedger() {
  try { return JSON.parse(fs.readFileSync(LEDGER, "utf8")); } catch { return {}; }
}
function writeLedger(l) { fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2)); }

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canonical(v[k]);
    return out;
  }
  return v;
}
function summaryOf(baseRevision, project) {
  return JSON.stringify(canonical({ baseRevision, project }));
}
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
async function readCurrent() {
  const r = await fetch(`${BASE_URL}/api/project`);
  if (!r.ok) throw new Error(`FableCut GET ${r.status}`);
  return await r.json();
}
async function writeCurrent(doc) {
  const r = await fetch(`${BASE_URL}/api/project`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc),
  });
  return { status: r.status, text: await r.text() };
}
function validate(project) {
  if (!project || typeof project !== "object") return "project must be an object";
  if (typeof project.name !== "string" || !project.name.trim()) return "project.name is required";
  if (!Array.isArray(project.clips)) return "project.clips must be an array";
  if (project.media != null && !Array.isArray(project.media)) return "project.media must be an array";
  return null;
}

const clients = new Set();
let eventSeq = 0;
function emit(ev) {
  eventSeq += 1;
  const payload = { eventId: `e${eventSeq}`, projectId: PROJECT_ID, ...ev };
  for (const res of clients) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  return payload;
}

let chain = Promise.resolve();
function enqueue(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/health" && req.method === "GET") {
      return send(res, 200, { ok: true, projectId: PROJECT_ID, writer: "adapter", base: BASE_URL });
    }
    if (req.url === "/events" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write("\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.url === "/project" && req.method === "GET") {
      const cur = await readCurrent();
      return send(res, 200, { projectId: PROJECT_ID, revision: cur.revision || 0, project: cur });
    }
    if (req.url.startsWith("/project") && req.method === "PUT") {
      if (req.url.includes("force")) return send(res, 400, { code: "FORCE_FORBIDDEN", message: "force is not allowed" });
      const body = await readJson(req);
      if (body.projectId !== PROJECT_ID) return send(res, 400, { code: "PROJECT_ID_INVALID" });
      if (!Number.isInteger(body.baseRevision)) return send(res, 400, { code: "BASE_REVISION_REQUIRED" });
      if (typeof body.commandId !== "string" || !body.commandId) return send(res, 400, { code: "COMMAND_ID_REQUIRED" });
      const bad = validate(body.project);
      if (bad) return send(res, 400, { code: "VALIDATION_ERROR", message: bad });

      return enqueue(async () => {
        const ledger = readLedger();
        const summary = summaryOf(body.baseRevision, body.project);
        if (ledger[body.commandId]) {
          const prev = ledger[body.commandId];
          if (prev.summary === summary) return send(res, 200, { ...prev.result, replayed: true });
          return send(res, 409, { code: "COMMAND_ID_CONFLICT", message: "same commandId with different payload" });
        }
        const cur = await readCurrent();
        const current = cur.revision || 0;
        if (body.baseRevision !== current) {
          return send(res, 409, { code: "REVISION_CONFLICT", currentRevision: current });
        }
        const next = { ...body.project, revision: current + 1 };
        const w = await writeCurrent(next);
        if (w.status !== 200) {
          return send(res, 409, { code: "REVISION_CONFLICT", currentRevision: current, upstream: w.text });
        }
        const result = { ok: true, projectId: PROJECT_ID, revision: next.revision, commandId: body.commandId };
        ledger[body.commandId] = { summary, result };
        writeLedger(ledger);
        emit({ newRevision: next.revision, commandId: body.commandId, affectedIds: next.clips.map((c) => c.id) });
        return send(res, 200, result);
      });
    }
    return send(res, 404, { code: "NOT_FOUND" });
  } catch (e) {
    return send(res, 500, { code: "INTERNAL", message: String(e && e.message || e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`writer adapter on http://127.0.0.1:${PORT} -> ${BASE_URL}, data=${DATA_DIR}`);
});
