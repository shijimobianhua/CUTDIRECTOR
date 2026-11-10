/**
 * M0-T3 Host half.
 *
 * Not product code. Exposes two agent tools and a small same-origin HTTP
 * facade for the Client panel. All writes go to the single-writer adapter
 * (test/spikes/g0-1/writer-adapter.js); this plugin never touches
 * FableCut's project.json directly.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_ADAPTER = "http://127.0.0.1:7792";
const DEFAULT_PROJECT = "P";
const SKILL_PATH = fileURLToPath(new URL("./skills/video-editing/SKILL.md", import.meta.url));

function cleanBase(url) {
  return String(url || DEFAULT_ADAPTER).replace(/\/+$/, "");
}

function text(value) {
  return [{ type: "text", text: value }];
}

async function readBody(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

export const inject = ["tools", "webServer", "skills"];

export function apply(ctx, config = {}) {
  const adapterUrl = cleanBase(config.adapterUrl);
  const projectId = String(config.projectId || DEFAULT_PROJECT);
  const skillContent = readFileSync(SKILL_PATH, "utf8");
  /** commandId -> original payload/clip id, so an identical retry can be replayed. */
  const commandLedger = new Map();
  /** Panel traffic counters, exposed by /m0t3/health for verification without browser control. */
  const stats = {
    gets: 0,
    puts: 0,
    eventConnections: 0,
    panelGets: 0,
    panelPuts: 0,
    eventStreams: 0,
    lastGetRevision: null,
    lastGetProjectId: null,
    lastPanelRevision: null,
    lastPanelProjectId: null,
  };

  async function adapterGet() {
    const res = await fetch(`${adapterUrl}/project`, { headers: { Accept: "application/json" } });
    const body = await res.text();
    if (!res.ok) throw new Error(`adapter GET ${res.status}: ${body}`);
    return JSON.parse(body);
  }

  async function adapterPut(payload, signal) {
    const res = await fetch(`${adapterUrl}/project`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`adapter PUT ${res.status}: ${body}`);
    return JSON.parse(body);
  }

  function clipSummary(clip) {
    return {
      id: String(clip.id || ""),
      text: String(clip.props?.text || clip.name || ""),
      start: Number(clip.start || 0),
      duration: Number(clip.duration || 0),
      track: String(clip.track || ""),
    };
  }

  const readTool = {
    name: "video_project_read",
    description: "Read the current video project (projectId, revision, clips) through the M0-T3 single-writer adapter. Use this before any edit and after an event to confirm the latest revision.",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["projectId", "revision", "clipCount", "clips"],
        properties: {
          projectId: { type: "string" },
          revision: { type: "integer" },
          clipCount: { type: "integer" },
          clips: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "text", "start", "duration", "track"],
              properties: {
                id: { type: "string" },
                text: { type: "string" },
                start: { type: "number" },
                duration: { type: "number" },
                track: { type: "string" },
              },
            },
          },
        },
      },
      render: (_args, value) => text(
        `project=${value.projectId} revision=${value.revision} clips=${value.clipCount}`,
      ),
    },
    async execute(_args, exec) {
      const current = await adapterGet();
      const project = current.project || {};
      const clips = Array.isArray(project.clips) ? project.clips : [];
      return {
        projectId: current.projectId || projectId,
        revision: Number(project.revision || 0),
        clipCount: clips.length,
        clips: clips.map(clipSummary),
      };
    },
    presentCall() {
      return { card: "generic", title: "Read video project", kind: "read" };
    },
  };

  const applyTool = {
    name: "video_project_apply",
    description: "Add one text clip to the current video project through the M0-T3 single-writer adapter. Requires the observed baseRevision and a stable commandId; the adapter rejects stale revisions, force, and duplicate command IDs with different content.",
    parameters: {
      text: {
        type: "string",
        required: true,
        description: "Text of the clip to add.",
      },
      baseRevision: {
        type: "integer",
        required: true,
        description: "Revision read from video_project_read immediately before this call.",
      },
      commandId: {
        type: "string",
        required: true,
        description: "Stable id for this logical command; reuse it only for an identical retry.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["ok", "projectId", "revision", "commandId", "clipId"],
        properties: {
          ok: { type: "boolean" },
          projectId: { type: "string" },
          revision: { type: "integer" },
          commandId: { type: "string" },
          clipId: { type: "string" },
        },
      },
      render: (_args, value) => text(
        `applied ${value.clipId} project=${value.projectId} revision=${value.revision} command=${value.commandId}`,
      ),
    },
    async execute(args, exec) {
      const commandId = String(args.commandId);
      const textValue = String(args.text);
      const baseRevision = Number(args.baseRevision);
      const stored = commandLedger.get(commandId);
      if (stored) {
        if (stored.text !== textValue || stored.baseRevision !== baseRevision) {
          throw new Error("COMMAND_ID_CONFLICT: same commandId with different text or baseRevision");
        }
        const replay = await adapterPut({
          projectId,
          baseRevision: stored.baseRevision,
          commandId,
          project: stored.project,
        }, exec.signal);
        return {
          ok: true,
          projectId,
          revision: Number(replay.revision),
          commandId,
          clipId: stored.clipId,
        };
      }

      const current = await adapterGet();
      const project = current.project || {};
      const clips = Array.isArray(project.clips) ? project.clips : [];
      const start = clips.reduce((max, clip) => Math.max(max, Number(clip.start || 0) + Number(clip.duration || 0)), 0);
      const clipId = `c_agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const next = {
        ...project,
        clips: [
          ...clips,
          {
            id: clipId,
            mediaId: null,
            kind: "text",
            track: "V1",
            start,
            duration: 2,
            name: textValue,
            props: { text: textValue, fontSize: 72 },
          },
        ],
      };
      const result = await adapterPut({
        projectId,
        baseRevision,
        commandId,
        project: next,
      }, exec.signal);
      commandLedger.set(commandId, { text: textValue, baseRevision, project: next, clipId });
      return {
        ok: true,
        projectId,
        revision: Number(result.revision),
        commandId,
        clipId,
      };
    },
    presentCall(args) {
      return { card: "generic", title: "Apply video edit", kind: "edit", rawInput: args };
    },
  };

  async function route(req, res) {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    try {
      if (req.method === "GET" && url.pathname === "/m0t3/health") {
        return sendJson(res, 200, { ok: true, adapterUrl, projectId, stats });
      }
      if (req.method === "GET" && url.pathname === "/m0t3/project") {
        const current = await adapterGet();
        stats.gets += 1;
        stats.lastGetRevision = Number(current.project?.revision || 0);
        stats.lastGetProjectId = String(current.projectId || "");
        if (url.searchParams.get("client") === "1") {
          stats.panelGets += 1;
          stats.lastPanelRevision = Number(current.project?.revision || 0);
          stats.lastPanelProjectId = String(current.projectId || "");
        }
        return sendJson(res, 200, current);
      }
      if (req.method === "PUT" && url.pathname === "/m0t3/project") {
        const body = await readBody(req);
        const upstream = await fetch(`${adapterUrl}/project`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
        });
        const payload = await upstream.text();
        if (upstream.ok) stats.puts += 1;
        if (url.searchParams.get("client") === "1") {
          if (upstream.ok) stats.panelPuts += 1;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.revision != null) stats.lastPanelRevision = Number(parsed.revision);
          } catch {}
        }
        res.writeHead(upstream.status, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(payload),
        });
        return res.end(payload);
      }
      if (req.method === "GET" && url.pathname === "/m0t3/events") {
        stats.eventConnections += 1;
        if (url.searchParams.get("client") === "1") stats.eventStreams += 1;
        const controller = new AbortController();
        req.on("close", () => controller.abort());
        const upstream = await fetch(`${adapterUrl}/events`, {
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!upstream.ok || !upstream.body) {
          return sendJson(res, 502, { error: `adapter events ${upstream.status}` });
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write("\n");
        const reader = upstream.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }
        } catch (error) {
          if (error?.name !== "AbortError") throw error;
        } finally {
          res.end();
        }
        return;
      }
      return sendJson(res, 404, { error: "not found" });
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      return sendJson(res, 502, { error: String(error?.message || error) });
    }
  }

  ctx.effect(() => {
    const offRead = ctx.tools.register(readTool);
    const offApply = ctx.tools.register(applyTool);
    const offSkill = ctx.skills.register({
      name: "video-editing",
      description: "M0-T3 draft: use video_project_read and video_project_apply through the single-writer adapter; never bypass to the project file.",
      whenToUse: "When a video project task needs to read the current revision or apply one text clip through the shared writer.",
      content: skillContent,
      source: "runtime",
      path: SKILL_PATH,
      invocation: { modelInvocable: true, userInvocable: true },
    });
    const offRoute = ctx.webServer.register({ kind: "prefix", path: "/m0t3", handler: route });
    return () => {
      offRead();
      offApply();
      offSkill();
      offRoute();
    };
  }, "video-m0t3: tools, skill, and web route");
}
