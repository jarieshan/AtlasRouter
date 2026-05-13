export function renderAdminPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AtlasRouter Admin</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --bg: #f4f6f8;
      --surface: #ffffff;
      --surface-muted: #f8fafc;
      --border: #d8dee8;
      --border-strong: #bac4d2;
      --text: #17202f;
      --muted: #5d6878;
      --primary: #0b63ce;
      --primary-strong: #084fa6;
      --danger: #b42318;
      --success: #067647;
      --warning: #b54708;
      --focus: rgba(11, 99, 206, .22);
      background: var(--bg);
      color: var(--text);
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--text); }
    button, input, textarea { font: inherit; }
    button {
      min-height: 38px;
      border: 1px solid var(--border-strong);
      border-radius: 6px;
      padding: 0 13px;
      background: var(--surface);
      color: var(--text);
      font-weight: 650;
      cursor: pointer;
      white-space: nowrap;
    }
    button:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
    button:focus-visible, textarea:focus-visible { outline: 3px solid var(--focus); outline-offset: 1px; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    button.primary { background: var(--primary); border-color: var(--primary); color: #fff; }
    button.primary:hover:not(:disabled) { background: var(--primary-strong); border-color: var(--primary-strong); color: #fff; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: .95em;
    }
    .shell { width: min(1280px, 100%); margin: 0 auto; padding: 28px 22px 40px; }
    .masthead {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 18px;
      align-items: end;
      margin-bottom: 18px;
    }
    .eyebrow { margin: 0 0 5px; color: var(--primary); font-size: 13px; font-weight: 750; }
    h1, h2, h3, p { margin-top: 0; }
    h1 { margin-bottom: 7px; font-size: 28px; line-height: 1.2; letter-spacing: 0; }
    h2 { margin-bottom: 0; font-size: 16px; line-height: 1.3; letter-spacing: 0; }
    h3 { margin-bottom: 0; font-size: 13px; line-height: 1.3; letter-spacing: 0; }
    .intro { margin-bottom: 0; color: var(--muted); font-size: 14px; line-height: 1.5; }
    .status-pill {
      min-width: 180px;
      max-width: 100%;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 8px 12px;
      background: var(--surface);
      color: var(--muted);
      font-size: 13px;
      text-align: center;
    }
    .status-pill.error { border-color: rgba(180, 35, 24, .35); color: var(--danger); }
    .status-pill.success { border-color: rgba(6, 118, 71, .35); color: var(--success); }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }
    .metric {
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      padding: 13px 14px;
    }
    .metric span { display: block; color: var(--muted); font-size: 12px; font-weight: 650; }
    .metric strong { display: block; margin-top: 5px; font-size: 24px; line-height: 1.1; letter-spacing: 0; }
    .workspace {
      display: grid;
      grid-template-columns: 320px minmax(0, 1fr);
      gap: 14px;
      align-items: start;
    }
    .panel {
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
    }
    .panel-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--border);
      padding: 14px;
    }
    .panel-heading p { margin: 3px 0 0; color: var(--muted); font-size: 13px; line-height: 1.4; }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
    .profile-list { display: grid; gap: 8px; padding: 10px; }
    .profile-item {
      display: block;
      width: 100%;
      height: auto;
      border-color: transparent;
      background: transparent;
      padding: 10px;
      text-align: left;
      white-space: normal;
    }
    .profile-item:hover:not(:disabled) { background: var(--surface-muted); }
    .profile-item.active {
      border-color: rgba(11, 99, 206, .35);
      background: rgba(11, 99, 206, .08);
      color: var(--text);
    }
    .profile-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
    }
    .profile-name {
      overflow: hidden;
      color: var(--text);
      font-weight: 750;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .profile-count { color: var(--muted); font-size: 12px; font-weight: 650; }
    .profile-meta {
      margin-top: 5px;
      overflow: hidden;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .detail-body { padding: 14px; }
    .validation {
      display: none;
      margin-bottom: 14px;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      background: var(--surface-muted);
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }
    .validation.visible { display: block; }
    .validation.error { border-color: rgba(180, 35, 24, .32); color: var(--danger); background: rgba(180, 35, 24, .06); }
    .validation.warning { border-color: rgba(181, 71, 8, .32); color: var(--warning); background: rgba(181, 71, 8, .07); }
    .validation ul { margin: 6px 0 0 18px; padding: 0; }
    .facts {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    .fact {
      min-width: 0;
      border-right: 1px solid var(--border);
      padding: 11px 12px;
      background: var(--surface-muted);
    }
    .fact:last-child { border-right: 0; }
    .fact span { display: block; color: var(--muted); font-size: 12px; font-weight: 650; }
    .fact strong {
      display: block;
      margin-top: 5px;
      overflow: hidden;
      font-size: 14px;
      line-height: 1.35;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin: 16px 0 8px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
      text-transform: uppercase;
    }
    .chip-list { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip {
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 5px 9px;
      background: var(--surface);
      color: var(--text);
      font-size: 12px;
      font-weight: 650;
    }
    .node-list {
      display: grid;
      gap: 8px;
      max-height: 360px;
      overflow: auto;
      padding-right: 2px;
    }
    .node-row {
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 11px;
      background: var(--surface);
    }
    .node-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
      margin-bottom: 5px;
    }
    .node-name {
      overflow: hidden;
      font-weight: 750;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .node-group {
      flex: 0 0 auto;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }
    .node-line {
      display: block;
      overflow: hidden;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .empty {
      border: 1px dashed var(--border-strong);
      border-radius: 8px;
      padding: 18px;
      color: var(--muted);
      font-size: 14px;
      text-align: center;
    }
    .editor-panel { margin-top: 14px; }
    .editor-body { padding: 14px; }
    label { display: block; margin-bottom: 7px; color: var(--muted); font-size: 13px; font-weight: 700; }
    textarea {
      width: 100%;
      min-height: 52vh;
      resize: vertical;
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      padding: 12px;
      background: var(--surface);
      color: var(--text);
      font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      tab-size: 2;
    }
    .meta {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-top: 10px;
      color: var(--muted);
      font-size: 13px;
    }
    .dirty {
      display: inline-flex;
      align-items: center;
      min-height: 26px;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 2px 9px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    .dirty.changed { border-color: rgba(181, 71, 8, .35); color: var(--warning); background: rgba(181, 71, 8, .07); }
    @media (max-width: 980px) {
      .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .workspace { grid-template-columns: 1fr; }
      .facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .fact:nth-child(2) { border-right: 0; }
      .fact:nth-child(-n+2) { border-bottom: 1px solid var(--border); }
    }
    @media (max-width: 640px) {
      .shell { padding: 18px 12px 28px; }
      .masthead { grid-template-columns: 1fr; align-items: start; }
      .status-pill { width: 100%; text-align: left; }
      .summary-grid, .facts { grid-template-columns: 1fr; }
      .fact { border-right: 0; border-bottom: 1px solid var(--border); }
      .fact:last-child { border-bottom: 0; }
      .panel-heading { align-items: stretch; flex-direction: column; }
      .actions { justify-content: stretch; }
      .actions button { flex: 1 1 120px; }
      .meta { flex-direction: column; }
      textarea { min-height: 58vh; }
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f131a;
        --surface: #171c25;
        --surface-muted: #1d2430;
        --border: #303848;
        --border-strong: #465164;
        --text: #edf1f7;
        --muted: #aab4c3;
        --primary: #5c9dff;
        --primary-strong: #3e83ec;
        --danger: #ff8a7a;
        --success: #69d59c;
        --warning: #ffb86a;
        --focus: rgba(92, 157, 255, .26);
      }
      button.primary { color: #08111f; }
      .profile-item.active { background: rgba(92, 157, 255, .14); border-color: rgba(92, 157, 255, .42); }
      .validation.error { background: rgba(255, 138, 122, .08); }
      .validation.warning { background: rgba(255, 184, 106, .08); }
      .dirty.changed { background: rgba(255, 184, 106, .08); }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="masthead">
      <div>
        <p class="eyebrow">AtlasRouter Admin</p>
        <h1>订阅配置管理</h1>
        <p class="intro">编辑 ATLAS_ROUTER KV 中的 <code>router-config</code>，预览 profiles、节点组和节点行，保存前先做本地检查。</p>
      </div>
      <div class="status-pill" id="status" role="status">准备加载配置</div>
    </header>

    <section class="summary-grid" aria-label="配置摘要">
      <article class="metric">
        <span>Profiles</span>
        <strong id="profile-count">--</strong>
      </article>
      <article class="metric">
        <span>Nodes</span>
        <strong id="node-count">--</strong>
      </article>
      <article class="metric">
        <span>Groups</span>
        <strong id="group-count">--</strong>
      </article>
      <article class="metric">
        <span>Checks</span>
        <strong id="check-count">--</strong>
      </article>
    </section>

    <section class="workspace">
      <aside class="panel" aria-label="Profile 列表">
        <div class="panel-heading">
          <div>
            <h2>Profiles</h2>
            <p>选择一个租户查看节点分布。</p>
          </div>
          <button type="button" id="load">重新加载</button>
        </div>
        <div class="profile-list" id="profile-list">
          <div class="empty">尚未加载配置</div>
        </div>
      </aside>

      <section class="panel" aria-label="Profile 详情">
        <div class="panel-heading">
          <div>
            <h2 id="profile-title">配置预览</h2>
            <p id="profile-subtitle">加载后会显示当前 profile 的可用信息。</p>
          </div>
          <div class="actions">
            <button type="button" id="copy-url" disabled>复制订阅地址</button>
            <button type="button" id="format">格式化 JSON</button>
            <button type="button" id="save" class="primary" disabled>保存</button>
          </div>
        </div>
        <div class="detail-body">
          <div class="validation" id="validation"></div>
          <div class="facts">
            <div class="fact">
              <span>Profile ID</span>
              <strong id="profile-id">--</strong>
            </div>
            <div class="fact">
              <span>Name</span>
              <strong id="profile-name">--</strong>
            </div>
            <div class="fact">
              <span>Subscribe Token</span>
              <strong id="profile-token">--</strong>
            </div>
            <div class="fact">
              <span>Path</span>
              <strong id="profile-path">--</strong>
            </div>
          </div>

          <div class="section-title">Node Groups <span id="group-total">0</span></div>
          <div class="chip-list" id="group-list">
            <div class="empty">没有可显示的节点组</div>
          </div>

          <div class="section-title">Nodes <span id="node-total">0</span></div>
          <div class="node-list" id="node-list">
            <div class="empty">没有可显示的节点</div>
          </div>
        </div>
      </section>
    </section>

    <section class="panel editor-panel" aria-label="JSON 编辑器">
      <div class="panel-heading">
        <div>
          <h2>JSON Editor</h2>
          <p>这是保存到 KV 的完整配置，服务端会在保存时再次规范化。</p>
        </div>
        <span class="dirty" id="dirty-state">未加载</span>
      </div>
      <div class="editor-body">
        <label for="config">router-config JSON</label>
        <textarea id="config" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea>
        <div class="meta">
          <span>KV key: <code>router-config</code></span>
          <span id="editor-meta">0 chars</span>
        </div>
      </div>
    </section>
  </main>

  <script>
    const configInput = document.getElementById("config");
    const statusEl = document.getElementById("status");
    const profileListEl = document.getElementById("profile-list");
    const validationEl = document.getElementById("validation");
    const groupListEl = document.getElementById("group-list");
    const nodeListEl = document.getElementById("node-list");
    const buttons = {
      load: document.getElementById("load"),
      save: document.getElementById("save"),
      format: document.getElementById("format"),
      copyUrl: document.getElementById("copy-url"),
    };
    const fields = {
      profileCount: document.getElementById("profile-count"),
      nodeCount: document.getElementById("node-count"),
      groupCount: document.getElementById("group-count"),
      checkCount: document.getElementById("check-count"),
      title: document.getElementById("profile-title"),
      subtitle: document.getElementById("profile-subtitle"),
      id: document.getElementById("profile-id"),
      name: document.getElementById("profile-name"),
      token: document.getElementById("profile-token"),
      path: document.getElementById("profile-path"),
      groupTotal: document.getElementById("group-total"),
      nodeTotal: document.getElementById("node-total"),
      editorMeta: document.getElementById("editor-meta"),
      dirtyState: document.getElementById("dirty-state"),
    };

    let selectedProfileIndex = 0;
    let savedSnapshot = "";
    let busy = false;
    let latest = {
      config: null,
      profiles: [],
      errors: ["尚未加载配置"],
      warnings: [],
    };

    buttons.load.addEventListener("click", loadConfig);
    buttons.save.addEventListener("click", saveConfig);
    buttons.format.addEventListener("click", formatConfig);
    buttons.copyUrl.addEventListener("click", copySelectedUrl);
    configInput.addEventListener("input", refreshFromEditor);
    profileListEl.addEventListener("click", (event) => {
      const item = event.target.closest("[data-profile-index]");
      if (!item) return;
      selectedProfileIndex = Number(item.dataset.profileIndex);
      renderAll();
    });
    window.addEventListener("beforeunload", (event) => {
      if (!isDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    });

    loadConfig();

    async function loadConfig() {
      setBusy(true);
      setStatus("正在加载配置");
      try {
        const response = await fetch("/admin/config");
        const text = await response.text();
        if (!response.ok) throw new Error(text || response.statusText);
        const parsed = JSON.parse(text);
        const nextText = JSON.stringify(parsed, null, 2);
        configInput.value = nextText;
        savedSnapshot = nextText;
        selectedProfileIndex = 0;
        refreshFromEditor();
        setStatus("配置已加载", "success");
      } catch (error) {
        setStatus(error.message, "error");
        refreshFromEditor();
      } finally {
        setBusy(false);
      }
    }

    async function saveConfig() {
      refreshFromEditor();
      if (latest.errors.length > 0) {
        setStatus("请先修复 JSON 或必填字段错误", "error");
        return;
      }

      setBusy(true);
      setStatus("正在保存配置");
      try {
        const response = await fetch("/admin/config", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(latest.config),
        });
        const text = await response.text();
        if (!response.ok) throw new Error(text || response.statusText);
        const parsed = JSON.parse(text);
        const nextText = JSON.stringify(parsed, null, 2);
        configInput.value = nextText;
        savedSnapshot = nextText;
        refreshFromEditor();
        setStatus("配置已保存", "success");
      } catch (error) {
        setStatus(error.message, "error");
      } finally {
        setBusy(false);
      }
    }

    function formatConfig() {
      try {
        const parsed = JSON.parse(configInput.value);
        configInput.value = JSON.stringify(parsed, null, 2);
        refreshFromEditor();
        setStatus("JSON 已格式化", "success");
      } catch (error) {
        setStatus(error.message, "error");
        refreshFromEditor();
      }
    }

    async function copySelectedUrl() {
      const profile = latest.profiles[selectedProfileIndex];
      if (!profile || typeof profile.subscribeToken !== "string") return;
      const url = new URL("/surge", window.location.href);
      url.searchParams.set("token", profile.subscribeToken);
      try {
        await copyText(url.toString());
        setStatus("订阅地址已复制", "success");
      } catch (error) {
        setStatus(error.message, "error");
      }
    }

    function refreshFromEditor() {
      latest = readEditor();
      if (selectedProfileIndex >= latest.profiles.length) {
        selectedProfileIndex = Math.max(0, latest.profiles.length - 1);
      }
      renderAll();
    }

    function readEditor() {
      const text = configInput.value.trim();
      if (!text) {
        return {
          config: null,
          profiles: [],
          errors: ["配置不能为空"],
          warnings: [],
        };
      }

      try {
        const config = JSON.parse(text);
        const report = validateConfig(config);
        return {
          config,
          profiles: getProfiles(config),
          errors: report.errors,
          warnings: report.warnings,
        };
      } catch (error) {
        return {
          config: null,
          profiles: [],
          errors: [error.message],
          warnings: [],
        };
      }
    }

    function validateConfig(config) {
      const errors = [];
      const warnings = [];
      if (!isPlainObject(config)) {
        return { errors: ["router-config 必须是 JSON object"], warnings };
      }

      const profiles = getProfiles(config);
      if (Array.isArray(config.profiles)) {
        if (config.profiles.length === 0) {
          errors.push("profiles 至少需要一个 profile");
        }
      } else if (config.profiles != null) {
        errors.push("profiles 必须是数组");
      } else if (config.subscribeToken != null || config.nodes != null) {
        warnings.push("检测到旧版单 profile 格式，保存后会被服务端规范化为 profiles[]");
      } else {
        errors.push("router-config 必须包含 profiles[]");
      }

      const ids = new Set();
      const tokens = new Set();
      profiles.forEach((profile, index) => {
        const label = "Profile " + (profile && (profile.id || profile.name) ? profile.id || profile.name : "#" + (index + 1));
        if (!isPlainObject(profile)) {
          errors.push(label + " 必须是 object");
          return;
        }

        checkRequiredString(profile.id, label + " 缺少 id", errors);
        checkRequiredString(profile.name, label + " 缺少 name", errors);
        checkRequiredString(profile.subscribeToken, label + " 缺少 subscribeToken", errors);
        if (typeof profile.id === "string" && profile.id.includes(",")) {
          errors.push(label + " 的 id 不能包含逗号");
        }
        if (typeof profile.id === "string" && profile.id.trim()) {
          if (ids.has(profile.id.trim())) errors.push("重复的 profile id: " + profile.id.trim());
          ids.add(profile.id.trim());
        }
        if (typeof profile.subscribeToken === "string" && profile.subscribeToken.trim()) {
          if (tokens.has(profile.subscribeToken.trim())) errors.push(label + " 的 subscribeToken 与其他 profile 重复");
          tokens.add(profile.subscribeToken.trim());
        }

        if (!Array.isArray(profile.nodes)) {
          errors.push(label + " 的 nodes 必须是数组");
          return;
        }
        if (profile.nodes.length === 0) {
          errors.push(label + " 至少需要一个 node");
          return;
        }

        const names = new Set();
        profile.nodes.forEach((node, nodeIndex) => {
          const nodeLabel = label + " node #" + (nodeIndex + 1);
          if (!isPlainObject(node)) {
            errors.push(nodeLabel + " 必须是 object");
            return;
          }
          checkRequiredString(node.group, nodeLabel + " 缺少 group", errors);
          if (typeof node.group === "string" && node.group.includes(",")) {
            errors.push(nodeLabel + " 的 group 不能包含逗号");
          }

          const hasLine = typeof node.line === "string" && node.line.trim() !== "";
          const hasLegacy = typeof node.name === "string" && node.name.trim() !== "" && typeof node.value === "string" && node.value.trim() !== "";
          if (hasLine && (node.name != null || node.value != null)) {
            errors.push(nodeLabel + " 只能使用 line，或使用 name/value，不能混用");
          }
          if (!hasLine && !hasLegacy) {
            errors.push(nodeLabel + " 缺少 line");
            return;
          }

          const name = getNodeName(node);
          if (!name) {
            errors.push(nodeLabel + " 的 line 必须使用 name = value");
            return;
          }
          if (names.has(name)) errors.push(label + " 存在重复节点名: " + name);
          names.add(name);
        });
      });

      return { errors, warnings };
    }

    function renderAll() {
      const profile = latest.profiles[selectedProfileIndex];
      renderSummary();
      renderProfiles();
      renderValidation();
      renderProfile(profile);
      renderEditorState();
      buttons.save.disabled = busy || latest.errors.length > 0 || !latest.config;
      buttons.copyUrl.disabled = busy || !profile || typeof profile.subscribeToken !== "string";
    }

    function renderSummary() {
      const groups = new Set();
      let nodeCount = 0;
      for (const profile of latest.profiles) {
        if (!Array.isArray(profile.nodes)) continue;
        nodeCount += profile.nodes.length;
        for (const node of profile.nodes) {
          if (node && typeof node.group === "string" && node.group.trim()) groups.add(node.group.trim());
        }
      }
      fields.profileCount.textContent = String(latest.profiles.length);
      fields.nodeCount.textContent = String(nodeCount);
      fields.groupCount.textContent = String(groups.size);
      fields.checkCount.textContent = latest.errors.length > 0 ? String(latest.errors.length) : "OK";
    }

    function renderProfiles() {
      profileListEl.replaceChildren();
      if (latest.profiles.length === 0) {
        profileListEl.append(emptyState("没有可显示的 profile"));
        return;
      }

      latest.profiles.forEach((profile, index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "profile-item" + (index === selectedProfileIndex ? " active" : "");
        item.dataset.profileIndex = String(index);

        const row = document.createElement("div");
        row.className = "profile-row";
        const name = document.createElement("span");
        name.className = "profile-name";
        name.textContent = profile.name || profile.id || "Unnamed";
        const count = document.createElement("span");
        count.className = "profile-count";
        count.textContent = String(Array.isArray(profile.nodes) ? profile.nodes.length : 0) + " nodes";
        row.append(name, count);

        const meta = document.createElement("div");
        meta.className = "profile-meta";
        meta.textContent = (profile.id || "missing-id") + " · " + maskSecret(profile.subscribeToken);

        item.append(row, meta);
        profileListEl.append(item);
      });
    }

    function renderValidation() {
      validationEl.replaceChildren();
      validationEl.className = "validation";
      if (latest.errors.length === 0 && latest.warnings.length === 0) {
        validationEl.classList.add("visible");
        validationEl.textContent = "本地检查通过。保存时服务端仍会做最终校验。";
        return;
      }

      validationEl.classList.add("visible", latest.errors.length > 0 ? "error" : "warning");
      const title = document.createElement("strong");
      title.textContent = latest.errors.length > 0 ? "需要修复" : "提示";
      const list = document.createElement("ul");
      for (const message of [...latest.errors, ...latest.warnings].slice(0, 8)) {
        const item = document.createElement("li");
        item.textContent = message;
        list.append(item);
      }
      validationEl.append(title, list);
    }

    function renderProfile(profile) {
      groupListEl.replaceChildren();
      nodeListEl.replaceChildren();
      if (!profile) {
        fields.title.textContent = "配置预览";
        fields.subtitle.textContent = "加载或输入有效配置后会显示 profile 详情。";
        fields.id.textContent = "--";
        fields.name.textContent = "--";
        fields.token.textContent = "--";
        fields.path.textContent = "--";
        fields.groupTotal.textContent = "0";
        fields.nodeTotal.textContent = "0";
        groupListEl.append(emptyState("没有可显示的节点组"));
        nodeListEl.append(emptyState("没有可显示的节点"));
        return;
      }

      const nodes = Array.isArray(profile.nodes) ? profile.nodes : [];
      const groups = countGroups(nodes);
      fields.title.textContent = profile.name || profile.id || "Unnamed profile";
      fields.subtitle.textContent = "Profile " + (selectedProfileIndex + 1) + " / " + latest.profiles.length;
      fields.id.textContent = profile.id || "--";
      fields.name.textContent = profile.name || "--";
      fields.token.textContent = maskSecret(profile.subscribeToken);
      fields.path.textContent = typeof profile.subscribeToken === "string" ? "/surge?token=" + maskSecret(profile.subscribeToken) : "--";
      fields.groupTotal.textContent = String(groups.length);
      fields.nodeTotal.textContent = String(nodes.length);

      if (groups.length === 0) {
        groupListEl.append(emptyState("没有可显示的节点组"));
      } else {
        for (const group of groups) {
          const chip = document.createElement("span");
          chip.className = "chip";
          chip.textContent = group.name + " · " + group.count;
          groupListEl.append(chip);
        }
      }

      if (nodes.length === 0) {
        nodeListEl.append(emptyState("没有可显示的节点"));
      } else {
        for (const node of nodes) {
          nodeListEl.append(renderNode(node));
        }
      }
    }

    function renderNode(node) {
      const row = document.createElement("div");
      row.className = "node-row";

      const top = document.createElement("div");
      top.className = "node-top";
      const name = document.createElement("div");
      name.className = "node-name";
      name.textContent = getNodeName(node) || "Unnamed node";
      const group = document.createElement("div");
      group.className = "node-group";
      group.textContent = node && typeof node.group === "string" ? node.group : "missing group";
      top.append(name, group);

      const line = document.createElement("code");
      line.className = "node-line";
      line.textContent = getNodeLine(node);

      row.append(top, line);
      return row;
    }

    function renderEditorState() {
      const changed = isDirty();
      fields.editorMeta.textContent = configInput.value.length + " chars";
      fields.dirtyState.className = "dirty" + (changed ? " changed" : "");
      fields.dirtyState.textContent = changed ? "有未保存更改" : savedSnapshot ? "已保存" : "未加载";
    }

    function setBusy(isBusy) {
      busy = isBusy;
      buttons.load.disabled = isBusy;
      buttons.format.disabled = isBusy;
      renderAll();
    }

    function setStatus(message, tone) {
      statusEl.textContent = message;
      statusEl.className = "status-pill" + (tone ? " " + tone : "");
    }

    function getProfiles(config) {
      if (!isPlainObject(config)) return [];
      if (Array.isArray(config.profiles)) return config.profiles;
      if (config.subscribeToken != null || config.nodes != null) {
        return [{
          id: "default",
          name: "Default",
          subscribeToken: config.subscribeToken,
          nodes: config.nodes,
        }];
      }
      return [];
    }

    function countGroups(nodes) {
      const counts = new Map();
      for (const node of nodes) {
        const group = node && typeof node.group === "string" && node.group.trim() ? node.group.trim() : "missing group";
        counts.set(group, (counts.get(group) || 0) + 1);
      }
      return [...counts.entries()].map(([name, count]) => ({ name, count }));
    }

    function getNodeName(node) {
      if (!node || typeof node !== "object") return "";
      if (typeof node.line === "string") {
        const separator = node.line.indexOf("=");
        return separator > 0 ? node.line.slice(0, separator).trim() : "";
      }
      return typeof node.name === "string" ? node.name.trim() : "";
    }

    function getNodeLine(node) {
      if (!node || typeof node !== "object") return "";
      if (typeof node.line === "string") return node.line;
      if (typeof node.name === "string" && typeof node.value === "string") {
        return node.name + " = " + node.value;
      }
      return "";
    }

    function checkRequiredString(value, message, errors) {
      if (typeof value !== "string" || value.trim() === "") errors.push(message);
    }

    function maskSecret(value) {
      if (typeof value !== "string" || value.length === 0) return "--";
      if (value.length <= 8) return "••••";
      return value.slice(0, 4) + "••••" + value.slice(-4);
    }

    function isDirty() {
      return savedSnapshot !== "" && configInput.value !== savedSnapshot;
    }

    function isPlainObject(value) {
      return value != null && typeof value === "object" && !Array.isArray(value);
    }

    function emptyState(message) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = message;
      return empty;
    }

    async function copyText(value) {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        return;
      }
      const helper = document.createElement("textarea");
      helper.value = value;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.top = "-1000px";
      document.body.append(helper);
      helper.select();
      const ok = document.execCommand("copy");
      helper.remove();
      if (!ok) throw new Error("复制失败，请手动复制 JSON 中的 subscribeToken");
    }
  </script>
</body>
</html>`;
}
