/**
 * M0-T4 async demo. Not product code.
 *
 * Business job -> one DSH runtime job (kind "bash") -> progress, cancel, read,
 * simulated restart reconciliation. The business store is the state machine;
 * the DSH job remains the execution/evidence record.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const STORE = fileURLToPath(new URL("../data/business-jobs.json", import.meta.url));
const TERMINAL = new Set(["succeeded", "failed", "canceled"]);
const live = new Map();

const now = () => new Date().toISOString();
function load() {
  try {
    return JSON.parse(readFileSync(STORE, "utf8"));
  } catch {
    return {};
  }
}
function save(db) {
  mkdirSync(dirname(STORE), { recursive: true });
  const tmp = `${STORE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  renameSync(tmp, STORE);
}
function text(value) {
  return [{ type: "text", text: value }];
}
function ensure(db, id) {
  const job = db[id];
  if (!job) throw new Error(`unknown businessJobId: ${id}`);
  return job;
}
function summary(job) {
  return {
    businessJobId: job.businessJobId,
    state: job.state,
    runtimeJobId: job.runtimeJobId || "",
    runtimeStatus: job.runtimeStatus || "see job_output",
    progress: job.progress || "",
    output: job.output || "",
  };
}

export const inject = ["tools", "jobs"];

export function apply(ctx) {
  const startTool = {
    name: "video_job_start",
    description: "Start one controlled demo render as a DSH runtime job (M0-T4). scenario=success goes running -> verifying -> succeeded; failure ends failed; slow waits long enough to cancel. Returns businessJobId and runtimeJobId.",
    parameters: {
      scenario: {
        type: "string",
        required: true,
        enum: ["success", "failure", "slow"],
        description: "Which controlled outcome to run.",
      },
      durationMs: {
        type: "integer",
        required: false,
        description: "Optional duration override; defaults 6000 (success), 3000 (failure), 60000 (slow).",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["businessJobId", "runtimeJobId", "state", "projectId"],
        properties: {
          businessJobId: { type: "string" },
          runtimeJobId: { type: "string" },
          state: { type: "string" },
          projectId: { type: "string" },
        },
      },
      render: (_a, v) => text(`business=${v.businessJobId} runtime=${v.runtimeJobId} state=${v.state}`),
    },
    async execute(args, exec) {
      const owner = exec.agent?.id;
      if (!owner) throw new Error("video_job_start requires an owning agent session");
      const scenario = String(args.scenario || "success");
      const duration = Number(args.durationMs) || (scenario === "success" ? 6000 : scenario === "failure" ? 3000 : 60000);
      const db = load();
      const businessJobId = `bj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const attemptId = `at-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const bj = {
        businessJobId,
        kind: "demo-render",
        projectId: "P",
        scenario,
        owner,
        state: "queued",
        progress: "queued",
        output: "",
        result: null,
        history: [{ state: "queued", at: now() }],
        runtimeJobId: null,
        runtimeStatus: "registered",
        attempts: [{ attemptId, runtimeJobId: null, state: "queued", startedAt: now(), finishedAt: null }],
        createdAt: now(),
        updatedAt: now(),
      };
      db[businessJobId] = bj;
      save(db);

      let resolveDone;
      const done = new Promise((resolve) => {
        resolveDone = resolve;
      });
      let timer;
      let verifyTimer;
      let append = () => {};
      let finish = () => {};
      let cancel = () => {};

      try {
        bj.runtimeJobId = String(ctx.jobs.start({
          kind: "bash",
          label: `video demo ${businessJobId}`,
          owner,
          ...(exec.callId ? { toolCall: { callId: exec.callId, rootCallId: exec.rootCallId } } : {}),
          run(job) {
            append = (line) => {
              job.append(line);
              bj.output = `${bj.output}${line}`;
              save(db);
            };
            finish = (state, detail) => {
              if (bj.state === "needsReconcile" || bj.reconcileMarked) return;
              bj.state = state;
              bj.progress = state;
              bj.history.push({ state, at: now() });
              if (detail) bj.result = detail;
              bj.attempts[0].state = state;
              bj.attempts[0].finishedAt = now();
              bj.updatedAt = now();
              save(db);
            };
            cancel = (reason) => {
              if (TERMINAL.has(bj.state)) return;
              clearTimeout(timer);
              clearTimeout(verifyTimer);
              bj.state = "cancelRequested";
              bj.progress = "cancelRequested";
              bj.history.push({ state: "cancelRequested", at: now() });
              bj.updatedAt = now();
              save(db);
              job.updateProgress("cancelRequested");
              append(`cancel requested: ${reason || "user"}\n`);
              resolveDone({ status: "killed", detail: reason || "canceled" });
              verifyTimer = setTimeout(() => finish("canceled"), 300);
            };
            bj.state = "running";
            bj.progress = "running";
            bj.history.push({ state: "running", at: now() });
            bj.attempts[0].state = "running";
            bj.attempts[0].startedAt = now();
            bj.updatedAt = now();
            save(db);
            job.updateProgress("running");
            append(`started ${scenario}\n`);
            timer = setTimeout(() => {
              if (bj.state === "needsReconcile") return;
              if (scenario === "failure") {
                append("FAILED injected failure\n");
                finish("failed", "injected failure");
                resolveDone({ status: "failed", detail: "injected failure" });
                return;
              }
              bj.state = "verifying";
              bj.progress = "verifying";
              bj.history.push({ state: "verifying", at: now() });
              bj.updatedAt = now();
              save(db);
              job.updateProgress("verifying");
              append("verifying\n");
              resolveDone({ status: "completed", result: "ok" });
              verifyTimer = setTimeout(() => {
                append("DONE ok\n");
                finish("succeeded", "ok");
              }, 3000);
            }, duration);
            return { done, cancel };
          },
        }));
      } catch (error) {
        bj.state = "failed";
        bj.progress = `start failed: ${error?.message || error}`;
        bj.attempts[0].state = "failed";
        bj.attempts[0].finishedAt = now();
        bj.updatedAt = now();
        save(db);
        throw error;
      }

      bj.attempts[0].runtimeJobId = bj.runtimeJobId;
      bj.state = bj.state === "queued" ? "running" : bj.state;
      bj.updatedAt = now();
      save(db);
      live.set(businessJobId, { cancel: (reason) => cancel(reason), bj });
      return { businessJobId, runtimeJobId: bj.runtimeJobId, state: bj.state, projectId: bj.projectId };
    },
  };

  const statusTool = {
    name: "video_job_status",
    description: "Read one M0-T4 business job state, runtimeJobId, progress, and output. The business state machine is driven by the job lifecycle; DSH runtime settlement is the execution record.",
    parameters: {
      businessJobId: { type: "string", required: true, description: "Business job id returned by video_job_start." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["businessJobId", "state", "runtimeJobId", "runtimeStatus", "progress", "output"],
        properties: {
          businessJobId: { type: "string" },
          state: { type: "string" },
          runtimeJobId: { type: "string" },
          runtimeStatus: { type: "string" },
          progress: { type: "string" },
          output: { type: "string" },
        },
      },
      render: (_a, v) => text(`business=${v.businessJobId} state=${v.state} runtime=${v.runtimeJobId}`),
    },
    async execute(args) {
      const db = load();
      const bj = ensure(db, String(args.businessJobId));
      return summary(bj);
    },
  };

  const cancelTool = {
    name: "video_job_cancel",
    description: "Request cancellation of one M0-T4 business job. Marks cancelRequested; does not claim stopped until the runtime job settles.",
    parameters: {
      businessJobId: { type: "string", required: true, description: "Business job id." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["businessJobId", "state", "runtimeJobId"],
        properties: {
          businessJobId: { type: "string" },
          state: { type: "string" },
          runtimeJobId: { type: "string" },
        },
      },
      render: (_a, v) => text(`cancel requested: ${v.businessJobId} state=${v.state}`),
    },
    async execute(args, exec) {
      const owner = exec.agent?.id;
      if (!owner) throw new Error("video_job_cancel requires an owning agent session");
      const db = load();
      const bj = ensure(db, String(args.businessJobId));
      if (TERMINAL.has(bj.state)) {
        return { businessJobId: bj.businessJobId, state: bj.state, runtimeJobId: bj.runtimeJobId || "" };
      }
      const hook = live.get(bj.businessJobId);
      if (hook) hook.cancel("user canceled from M0-T4 demo");
      bj.state = "cancelRequested";
      bj.progress = "cancelRequested";
      bj.updatedAt = now();
      save(db);
      return { businessJobId: bj.businessJobId, state: bj.state, runtimeJobId: bj.runtimeJobId || "" };
    },
  };

  const readTool = {
    name: "video_job_read",
    description: "Read the retained output and business state of one M0-T4 job. For the DSH runtime record, also use job_output with runtimeJobId.",
    parameters: {
      businessJobId: { type: "string", required: true, description: "Business job id." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["businessJobId", "state", "runtimeJobId", "output", "result"],
        properties: {
          businessJobId: { type: "string" },
          state: { type: "string" },
          runtimeJobId: { type: "string" },
          output: { type: "string" },
          result: { type: "string" },
        },
      },
      render: (_a, v) => text(`business=${v.businessJobId} state=${v.state} runtime=${v.runtimeJobId}`),
    },
    async execute(args) {
      const db = load();
      const bj = ensure(db, String(args.businessJobId));
      return {
        businessJobId: bj.businessJobId,
        state: bj.state,
        runtimeJobId: bj.runtimeJobId || "",
        output: bj.output || "",
        result: bj.result == null ? "" : String(bj.result),
      };
    },
  };

  const restartTool = {
    name: "video_job_simulate_restart",
    description: "Simulate a host restart for M0-T4: every nonterminal business job becomes needsReconcile, and its live demo hook is canceled. Does not start work. Use video_job_reconcile to record the checked outcome.",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["marked"],
        properties: {
          marked: { type: "array", items: { type: "string" } },
        },
      },
      render: (_a, v) => text(`needsReconcile: ${v.marked.join(", ")}`),
    },
    async execute() {
      const db = load();
      const marked = [];
      for (const bj of Object.values(db)) {
        if (TERMINAL.has(bj.state)) continue;
        const entry = live.get(bj.businessJobId);
        if (entry) {
          entry.bj.reconcileMarked = true;
          entry.cancel("simulated restart");
        }
        bj.state = "needsReconcile";
        bj.progress = "needsReconcile after simulated restart";
        bj.runtimeStatus = "needsReconcile";
        bj.updatedAt = now();
        marked.push(bj.businessJobId);
      }
      save(db);
      return { marked };
    },
  };

  const reconcileTool = {
    name: "video_job_reconcile",
    description: "Resolve a needsReconcile M0-T4 business job after checking its artifact/logs. decision must be failed, canceled, or succeeded; never restart the same attempt automatically.",
    parameters: {
      businessJobId: { type: "string", required: true, description: "Business job id." },
      decision: { type: "string", required: true, enum: ["failed", "canceled", "succeeded"], description: "Checked outcome." },
      note: { type: "string", required: false, description: "What was checked." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["businessJobId", "state", "note"],
        properties: {
          businessJobId: { type: "string" },
          state: { type: "string" },
          note: { type: "string" },
        },
      },
      render: (_a, v) => text(`reconciled ${v.businessJobId} -> ${v.state}`),
    },
    async execute(args) {
      const db = load();
      const bj = ensure(db, String(args.businessJobId));
      if (bj.state !== "needsReconcile") throw new Error(`not needsReconcile: ${bj.state}`);
      bj.state = String(args.decision);
      bj.progress = `reconciled: ${args.decision}`;
      if (args.note) bj.result = String(args.note);
      bj.attempts[0].state = bj.state;
      bj.attempts[0].finishedAt = now();
      bj.updatedAt = now();
      save(db);
      live.delete(bj.businessJobId);
      return { businessJobId: bj.businessJobId, state: bj.state, note: bj.result || "" };
    },
  };

  ctx.effect(() => {
    const offs = [
      ctx.tools.register(startTool),
      ctx.tools.register(statusTool),
      ctx.tools.register(cancelTool),
      ctx.tools.register(readTool),
      ctx.tools.register(restartTool),
      ctx.tools.register(reconcileTool),
    ];
    return () => offs.forEach((off) => off());
  }, "video-m0t4: job tools");
}
