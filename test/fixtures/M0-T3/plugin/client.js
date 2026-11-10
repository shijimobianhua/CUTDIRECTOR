/**
 * M0-T3 Client half: a minimal dock card under the composer.
 * Not product code. It reads and writes the project only through the Host
 * route /m0t3, which forwards to the single-writer adapter.
 */
window.__ModuleLoader__.load({
  id: "@local/video-m0t3",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const NS = "video-m0t3";

    const en = {
      title: "Video project (M0-T3)",
      project: "Project",
      revision: "Revision",
      clips: "Clips",
      read: "Read",
      add: "Add test clip",
      adding: "Adding…",
      loading: "Loading…",
      disconnected: "Event stream disconnected",
      failed: "Failed: ",
      hint: "Page writes go through the shared adapter, not project.json.",
    };
    const zh = {
      title: "视频工程（M0-T3）",
      project: "工程",
      revision: "版本",
      clips: "片段",
      read: "读取",
      add: "加测试片段",
      adding: "提交中…",
      loading: "读取中…",
      disconnected: "事件流已断开",
      failed: "失败：",
      hint: "页面写入经共享适配器，不直接改 project.json。",
    };
    const tr = (key) => zh[key] || en[key] || key;

    async function apiRead() {
      const res = await fetch("/m0t3/project?client=1", { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`GET /m0t3/project ${res.status}: ${await res.text()}`);
      return res.json();
    }
    async function apiWrite(payload) {
      const res = await fetch("/m0t3/project?client=1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`PUT /m0t3/project ${res.status}: ${await res.text()}`);
      return res.json();
    }
    function apiEvents() {
      return new EventSource("/m0t3/events?client=1");
    }

    function Panel() {
      const [state, setState] = React.useState({
        loading: true,
        error: "",
        projectId: "",
        revision: 0,
        clips: [],
        live: false,
      });
      const [busy, setBusy] = React.useState(false);

      const refresh = React.useCallback(async () => {
        try {
          const current = await apiRead();
          setState((prev) => ({
            ...prev,
            loading: false,
            error: "",
            projectId: current.projectId || "",
            revision: Number(current.project?.revision || 0),
            clips: Array.isArray(current.project?.clips) ? current.project.clips : [],
          }));
        } catch (error) {
          setState((prev) => ({ ...prev, loading: false, error: String(error?.message || error) }));
        }
      }, []);

      React.useEffect(() => {
        refresh();
        let stream;
        try {
          stream = apiEvents();
        } catch (error) {
          setState((prev) => ({ ...prev, error: String(error?.message || error) }));
          return undefined;
        }
        stream.onmessage = () => refresh();
        stream.onerror = () => setState((prev) => ({ ...prev, live: false, error: tr("disconnected") }));
        stream.onopen = () => setState((prev) => ({ ...prev, live: true }));
        return () => stream.close();
      }, [refresh]);

      const addClip = async () => {
        if (busy) return;
        setBusy(true);
        try {
          const commandId = `ui-${Date.now()}`;
          await apiWrite({
            baseRevision: state.revision,
            commandId,
            text: `UI clip ${new Date().toLocaleTimeString()}`,
          });
          await refresh();
        } catch (error) {
          setState((prev) => ({ ...prev, error: String(error?.message || error) }));
        } finally {
          setBusy(false);
        }
      };

      const styleButton = (disabled) => ({
        border: "1px solid var(--dsw-alias-border-l1)",
        borderRadius: 6,
        background: disabled ? "var(--dsw-alias-bg-layer-2)" : "var(--dsw-alias-brand-primary)",
        color: disabled ? "var(--dsw-alias-label-secondary)" : "var(--dsw-alias-bg-base)",
        padding: "4px 10px",
        font: "12px/1.4 system-ui, sans-serif",
        cursor: disabled ? "default" : "pointer",
      });

      const meta = (label, value) => h("span", {
        style: { display: "inline-flex", gap: 4, alignItems: "baseline" },
      }, h("span", { style: { color: "var(--dsw-alias-label-secondary)" } }, label), h("strong", null, String(value)));

      const recent = state.clips.slice(-3).reverse();

      return h("section", {
        "aria-label": tr("title"),
        style: {
          border: "1px solid var(--dsw-alias-border-l1)",
          borderRadius: 10,
          background: "var(--dsw-alias-bg-layer-1)",
          color: "var(--dsw-alias-label-primary)",
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          font: "12px/1.5 system-ui, sans-serif",
        },
      },
        h("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" } },
          h("strong", null, tr("title")),
          h("span", { style: { color: state.live ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-label-secondary)" } },
            state.live ? "● live" : "○"),
        ),
        h("div", { style: { display: "flex", gap: 12, flexWrap: "wrap" } },
          meta(tr("project"), state.projectId || "—"),
          meta(tr("revision"), state.revision),
          meta(tr("clips"), state.clips.length),
        ),
        state.loading ? h("div", { style: { color: "var(--dsw-alias-label-secondary)" } }, tr("loading")) : null,
        state.error ? h("div", { role: "alert", style: { color: "var(--dsw-alias-state-error-primary)" } }, tr("failed") + state.error) : null,
        h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
          h("button", { type: "button", onClick: refresh, disabled: busy, style: styleButton(busy) }, tr("read")),
          h("button", { type: "button", onClick: addClip, disabled: busy, style: styleButton(busy) }, busy ? tr("adding") : tr("add")),
        ),
        recent.length
          ? h("ul", { style: { margin: 0, paddingLeft: 16, color: "var(--dsw-alias-label-secondary)" } },
            recent.map((clip) => h("li", { key: String(clip.id) }, `${clip.id}: ${clip.props?.text || clip.name || ""}`)))
          : null,
        h("div", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: 11 } }, tr("hint")),
      );
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), "video-m0t3: dictionaries");
      ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
        name: "conversation.composer.dock",
        id: "video-m0t3",
        order: 10,
        locale: NS,
      }, Panel));
    }

    return { inject: ["slots", "locale"], apply };
  },
});
