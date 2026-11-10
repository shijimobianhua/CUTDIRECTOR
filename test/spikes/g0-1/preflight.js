#!/usr/bin/env node
/*
 * G0-1 spike preflight. NOT PRODUCT CODE.
 * Assumes:
 *   FableCut on 7790 with a disposable data dir
 *   writer-adapter.js on 7792 with the same data dir
 */
"use strict";
const http = require("http");

const ADAPTER = "http://127.0.0.1:7792";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (text) => ({ id: "c_g0", mediaId: null, kind: "text", track: "V1", start: 0, duration: 2, name: text, props: { text, fontSize: 72 } });
const project = (rev, text) => ({ name: "G0 adapter proof", width: 1280, height: 720, fps: 30, revision: rev, media: [], clips: [clip(text)] });
async function get() {
  const r = await fetch(`${ADAPTER}/project`);
  return { status: r.status, body: await r.json() };
}
async function put(body, qs = "") {
  const r = await fetch(`${ADAPTER}/project${qs}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.text() };
}
(async () => {
  const initial = await get();
  console.log("INITIAL", initial.status, initial.body.revision, initial.body.project.clips.length);

  const events = [];
  const es = http.get(`${ADAPTER}/events`, (res) => {
    res.on("data", (buf) => {
      for (const line of buf.toString().split("\n")) {
        if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)));
      }
    });
  });
  await sleep(300);

  const a = await Promise.all([
    put({ projectId: "P", baseRevision: 0, commandId: "A1", project: project(0, "A") }),
    put({ projectId: "P", baseRevision: 0, commandId: "B1", project: project(0, "B") }),
  ]);
  console.log("T01_CONCURRENT", a[0].status, a[0].body, "||", a[1].status, a[1].body);
  const after1 = await get();
  console.log("T01_FINAL", after1.body.revision, after1.body.project.clips[0].props.text);

  console.log("T02_STALE", (await put({ projectId: "P", baseRevision: 0, commandId: "A2", project: project(0, "stale") })).status);

  const forged = await put({ projectId: "P", baseRevision: 1, commandId: "A3", project: project(100, "forged") });
  console.log("T02_FORGED_HIGH", forged.status, forged.body);
  const afterForged = await get();
  console.log("T02_FORGED_FINAL", afterForged.body.revision, afterForged.body.project.clips[0].props.text);

  console.log("T06_FORCE", (await put({ projectId: "P", baseRevision: 1, commandId: "A4", project: project(1, "force") }, "?force=1")).status);

  const missing = await put({ projectId: "P", baseRevision: 2, commandId: "A5", project: { revision: 2 } });
  console.log("T02_MISSING_FIELDS", missing.status, missing.body);

  const replay = await put({ projectId: "P", baseRevision: 2, commandId: "A3", project: project(100, "forged") });
  console.log("T04_REPLAY", replay.status, replay.body);
  const afterReplay = await get();
  console.log("T04_REPLAY_FINAL", afterReplay.body.revision);

  const conflict = await put({ projectId: "P", baseRevision: 2, commandId: "A3", project: project(2, "different") });
  console.log("T05_SAME_ID_DIFFERENT", conflict.status, conflict.body);

  await sleep(300);
  console.log("T07_EVENTS", JSON.stringify(events));
  es.destroy();
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
