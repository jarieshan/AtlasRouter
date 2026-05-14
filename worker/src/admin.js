import { ADMIN_CERTIFICATE_PATH, ADMIN_CONFIG_PATH, SUBSCRIPTION_PATH } from "./routes.js";

export function renderAdminPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AtlasRouter Admin</title>
  <style>
    :root {
      color-scheme: light;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --bg: #f6f9fc;
      --surface: #ffffff;
      --surface-muted: #f0f6ff;
      --surface-soft: #fbfdff;
      --border: #dbe5f0;
      --border-strong: #bfd0e3;
      --text: #172033;
      --muted: #64748b;
      --muted-soft: #94a3b8;
      --primary: #2563eb;
      --primary-strong: #1d4ed8;
      --primary-soft: #e8f0ff;
      --danger: #dc2626;
      --danger-soft: #fff1f2;
      --success: #059669;
      --success-soft: #ecfdf5;
      --warning: #d97706;
      --warning-soft: #fffbeb;
      --focus: rgba(37, 99, 235, .18);
      background: var(--bg);
      color: var(--text);
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--text); }
    button, input, textarea { font: inherit; }
    button {
      min-height: 36px;
      border: 1px solid var(--border-strong);
      border-radius: 9px;
      padding: 0 12px;
      background: var(--surface);
      color: var(--text);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    button:hover:not(:disabled) { background: var(--primary-soft); border-color: #9bb8ec; color: var(--primary-strong); }
    button:focus-visible, input:focus-visible, textarea:focus-visible {
      outline: 3px solid var(--focus);
      outline-offset: 1px;
    }
    button:disabled { opacity: .55; cursor: not-allowed; }
    button.primary { background: var(--primary); border-color: var(--primary); color: #fff; }
    button.primary:hover:not(:disabled) { background: var(--primary-strong); border-color: var(--primary-strong); color: #fff; }
    button.danger { background: var(--danger-soft); color: var(--danger); border-color: #fecdd3; }
    button.danger:hover:not(:disabled) { background: #ffe4e6; border-color: #fda4af; color: #b91c1c; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: .95em;
    }
    .shell { width: min(1260px, 100%); margin: 0 auto; padding: 24px 20px 36px; }
    .masthead {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 18px;
      align-items: end;
      border: 1px solid var(--border);
      border-radius: 16px;
      margin-bottom: 16px;
      padding: 18px;
      background: linear-gradient(135deg, #ffffff 0%, #f3f8ff 100%);
    }
    .eyebrow {
      margin: 0 0 5px;
      color: var(--primary);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    h1, h2, h3, p { margin-top: 0; }
    h1 { margin-bottom: 6px; font-size: 24px; line-height: 1.2; letter-spacing: 0; }
    h2 { margin-bottom: 0; font-size: 15px; line-height: 1.3; letter-spacing: 0; }
    h3 { margin-bottom: 0; font-size: 14px; line-height: 1.3; letter-spacing: 0; }
    .intro { margin-bottom: 0; color: var(--muted); font-size: 14px; line-height: 1.5; }
    .status-pill {
      min-width: 180px;
      max-width: 100%;
      border: 1px solid var(--border);
      border-radius: 10px;
      margin-top: 8px;
      padding: 7px 10px;
      background: rgba(255, 255, 255, .78);
      color: var(--muted);
      font-size: 13px;
      text-align: center;
    }
    .status-pill.error { border-color: #fecdd3; background: var(--danger-soft); color: var(--danger); }
    .status-pill.success { border-color: #bbf7d0; background: var(--success-soft); color: var(--success); }
    .top-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 14px;
    }
    .metric {
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: var(--surface);
      padding: 14px;
    }
    .metric span { display: block; color: var(--muted); font-size: 12px; font-weight: 600; }
    .metric strong { display: block; margin-top: 5px; font-size: 22px; line-height: 1.1; letter-spacing: 0; }
    .workspace {
      display: grid;
      grid-template-columns: 320px minmax(0, 1fr);
      gap: 14px;
      align-items: start;
    }
    .panel {
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: var(--surface);
      overflow: hidden;
    }
    .panel-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--border);
      padding: 14px 16px;
      background: var(--surface-soft);
    }
    .panel-heading p { margin: 3px 0 0; color: var(--muted); font-size: 13px; line-height: 1.4; }
    .panel-body { padding: 16px; }
    .profile-list { display: grid; gap: 8px; padding: 10px; }
    .profile-item {
      display: block;
      width: 100%;
      height: auto;
      border-color: transparent;
      border-radius: 12px;
      background: transparent;
      padding: 10px;
      text-align: left;
      white-space: normal;
    }
    .profile-item:hover:not(:disabled) { background: var(--surface-muted); }
    .profile-item.active {
      border-color: #9bb8ec;
      background: var(--primary-soft);
      color: var(--text);
      box-shadow: inset 4px 0 0 var(--primary);
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
    .validation {
      display: none;
      margin-bottom: 14px;
      border: 1px solid var(--border);
      border-left: 3px solid var(--border-strong);
      border-radius: 12px;
      padding: 10px 12px;
      background: var(--surface-soft);
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }
    .validation.visible { display: block; }
    .validation.error { border-color: #fecdd3; border-left-color: var(--danger); background: var(--danger-soft); color: var(--danger); }
    .validation.warning { border-color: #fde68a; border-left-color: var(--warning); background: var(--warning-soft); color: var(--warning); }
    .validation ul { margin: 6px 0 0 18px; padding: 0; }
    .card-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px 14px;
    }
    .field { min-width: 0; }
    .field.full { grid-column: 1 / -1; }
    label {
      display: block;
      margin-bottom: 7px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
      text-transform: uppercase;
    }
    input, textarea {
      width: 100%;
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      background: var(--surface);
      color: var(--text);
    }
    input { min-height: 38px; padding: 0 11px; }
    input[type="checkbox"] { width: 16px; min-height: 0; height: 16px; padding: 0; }
    textarea {
      min-height: 74px;
      resize: vertical;
      padding: 10px;
      font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      tab-size: 2;
    }
    .check-control {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 38px;
      color: var(--text);
      font-size: 13px;
      font-weight: 600;
    }
    .subtle-input { color: var(--muted); }
    .button-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-top: 1px solid var(--border);
      margin: 20px 0 10px;
      padding-top: 16px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
      text-transform: uppercase;
    }
    .group-stack { display: grid; gap: 14px; border: 0; border-radius: 0; }
    .group-card {
      border: 1px solid var(--border);
      border-radius: 14px;
      overflow: hidden;
      background: var(--surface);
    }
    .group-heading {
      display: grid;
      grid-template-columns: minmax(180px, 1fr) auto;
      gap: 10px;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding: 12px;
      background: var(--surface-soft);
    }
    .group-title-row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 10px;
      align-items: center;
    }
    .group-title-row span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
      text-transform: uppercase;
    }
    .node-stack { display: grid; gap: 10px; padding: 12px; }
    .node-card {
      display: grid;
      grid-template-columns: minmax(160px, .45fr) minmax(0, 1fr) auto;
      gap: 10px;
      align-items: start;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px;
      background: var(--surface);
    }
    .empty {
      border: 1px dashed var(--border-strong);
      border-radius: 12px;
      padding: 18px;
      color: var(--muted);
      font-size: 14px;
      text-align: center;
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
      font-weight: 650;
    }
    .dirty.changed { border-color: #fde68a; color: var(--warning); background: var(--warning-soft); }
    @media (max-width: 1080px) {
      .workspace { grid-template-columns: 1fr; }
      .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 760px) {
      .shell { padding: 18px 12px 28px; }
      .masthead { grid-template-columns: 1fr; align-items: start; }
      .status-pill { width: 100%; text-align: left; }
      .top-actions { justify-content: stretch; }
      .top-actions button { flex: 1 1 120px; }
      .summary-grid, .card-grid { grid-template-columns: 1fr; }
      .group-heading, .node-card { grid-template-columns: 1fr; }
      .panel-heading { align-items: stretch; flex-direction: column; }
    }
  </style>
</head>
<body>
  <main class="shell" id="admin-root">
    <header class="masthead">
      <div>
        <p class="eyebrow">AtlasRouter Admin</p>
        <h1>用户订阅管理</h1>
        <p class="intro">Profiles、订阅 Token 和节点按用户独立配置。</p>
      </div>
      <div>
        <div class="top-actions">
          <button type="button" data-action="load">重新加载</button>
          <button type="button" data-action="save" class="primary" disabled>保存</button>
        </div>
        <div class="status-pill" id="status" role="status">准备加载配置</div>
      </div>
    </header>

    <section class="summary-grid" aria-label="配置摘要">
      <article class="metric">
        <span>Users</span>
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
      <aside class="panel" aria-label="用户列表">
        <div class="panel-heading">
          <div>
            <h2>用户</h2>
            <p id="user-count-text">0 个用户</p>
          </div>
          <button type="button" data-action="add-profile">新增用户</button>
        </div>
        <div class="profile-list" id="profile-list">
          <div class="empty">尚未加载配置</div>
        </div>
      </aside>

      <section class="panel" aria-label="用户配置">
        <div class="panel-heading">
          <div>
            <h2 id="profile-title">用户配置</h2>
            <p id="profile-subtitle">加载后选择一个用户。</p>
          </div>
          <span class="dirty" id="dirty-state">未加载</span>
        </div>
        <div class="panel-body">
          <div class="validation" id="validation"></div>
          <div id="profile-editor">
            <div class="empty">尚未加载配置</div>
          </div>
        </div>
      </section>
    </section>
  </main>

  <script>
    const ADMIN_CERTIFICATE_PATH = ${JSON.stringify(ADMIN_CERTIFICATE_PATH)};
    const ADMIN_CONFIG_PATH = ${JSON.stringify(ADMIN_CONFIG_PATH)};
    const SUBSCRIPTION_PATH = ${JSON.stringify(SUBSCRIPTION_PATH)};
    const DEFAULT_GROUPS = ["🇺🇸 US", "🇯🇵 JP", "🇺🇸 US Home"];
    const rootEl = document.getElementById("admin-root");
    const statusEl = document.getElementById("status");
    const profileListEl = document.getElementById("profile-list");
    const profileEditorEl = document.getElementById("profile-editor");
    const validationEl = document.getElementById("validation");
    const saveButton = document.querySelector('[data-action="save"]');
    const fields = {
      profileCount: document.getElementById("profile-count"),
      nodeCount: document.getElementById("node-count"),
      groupCount: document.getElementById("group-count"),
      checkCount: document.getElementById("check-count"),
      userCountText: document.getElementById("user-count-text"),
      title: document.getElementById("profile-title"),
      subtitle: document.getElementById("profile-subtitle"),
      dirtyState: document.getElementById("dirty-state"),
    };

    let state = {
      profiles: [],
      selectedProfileIndex: 0,
      savedSnapshot: "",
      busy: false,
      errors: ["尚未加载配置"],
      warnings: [],
    };

    rootEl.addEventListener("click", handleClick);
    rootEl.addEventListener("input", handleInput);
    rootEl.addEventListener("change", handleChange);
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
        const response = await fetch(ADMIN_CONFIG_PATH);
        const text = await response.text();
        if (!response.ok) throw new Error(text || response.statusText);
        state.profiles = normalizeProfiles(JSON.parse(text));
        state.selectedProfileIndex = 0;
        state.savedSnapshot = snapshotConfig();
        refreshValidation();
        renderAll();
        setStatus("配置已加载", "success");
      } catch (error) {
        state.errors = [error.message];
        state.warnings = [];
        renderAll();
        setStatus(error.message, "error");
      } finally {
        setBusy(false);
      }
    }

    async function saveConfig() {
      refreshValidation();
      renderValidation();
      updateSaveState();
      if (state.errors.length > 0) {
        setStatus("请先修复当前配置", "error");
        return;
      }

      setBusy(true);
      setStatus("正在保存配置");
      try {
        const response = await fetch(ADMIN_CONFIG_PATH, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(buildConfig()),
        });
        const text = await response.text();
        if (!response.ok) throw new Error(text || response.statusText);
        state.profiles = normalizeProfiles(JSON.parse(text));
        if (state.selectedProfileIndex >= state.profiles.length) {
          state.selectedProfileIndex = Math.max(0, state.profiles.length - 1);
        }
        state.savedSnapshot = snapshotConfig();
        refreshValidation();
        renderAll();
        setStatus("配置已保存", "success");
      } catch (error) {
        setStatus(error.message, "error");
      } finally {
        setBusy(false);
      }
    }

    function handleClick(event) {
      const target = event.target.closest("[data-action]");
      if (!target || state.busy) return;

      const action = target.dataset.action;
      if (action === "load") return loadConfig();
      if (action === "save") return saveConfig();
      if (action === "add-profile") return addProfile();
      if (action === "select-profile") return selectProfile(Number(target.dataset.profileIndex));
      if (action === "duplicate-profile") return duplicateProfile();
      if (action === "delete-profile") return deleteProfile();
      if (action === "copy-url") return copySelectedUrl();
      if (action === "copy-ca") return copySelectedCertificate();
      if (action === "regenerate-ca") return regenerateSelectedCertificate();
      if (action === "add-group") return addGroup();
      if (action === "add-node") return addNode(target.dataset.group);
      if (action === "delete-group") return deleteGroup(target.dataset.group);
      if (action === "delete-node") return deleteNode(Number(target.dataset.nodeIndex));
    }

    function handleInput(event) {
      const target = event.target;
      if (target.matches("[data-profile-field]")) {
        const profile = selectedProfile();
        if (!profile) return;
        profile[target.dataset.profileField] = target.value;
        refreshDerived();
      }
      if (target.matches("[data-mitm-field]")) {
        const profile = selectedProfile();
        if (!profile) return;
        profile.mitm[target.dataset.mitmField] = target.value;
        refreshDerived();
      }
      if (target.matches("[data-node-field]")) {
        const profile = selectedProfile();
        const node = profile && profile.nodes[Number(target.dataset.nodeIndex)];
        if (!node) return;
        node[target.dataset.nodeField] = target.value;
        refreshDerived();
      }
      if (target.matches("[data-group-field]")) {
        const profile = selectedProfile();
        if (!profile) return;
        const previous = target.dataset.group;
        for (const node of profile.nodes) {
          if (node.group === previous) node.group = target.value;
        }
        target.dataset.group = target.value;
        refreshDerived();
      }
    }

    function handleChange(event) {
      if (event.target.matches("[data-mitm-toggle]")) {
        const profile = selectedProfile();
        if (!profile) return;
        profile.mitm.enabled = event.target.checked;
        refreshDerived();
      }
      if (event.target.matches("[data-group-field]")) {
        renderAll();
      }
    }

    async function addProfile() {
      const nextNumber = state.profiles.length + 1;
      const profile = {
        id: uniqueProfileId("user-" + nextNumber),
        name: "User " + nextNumber,
        subscribeToken: "",
        mitm: blankMitm(true),
        nodes: [blankNode(firstAvailableGroup())],
      };
      setBusy(true);
      setStatus("正在生成 MitM CA");
      try {
        profile.mitm = await createMitmCertificate(profile);
      } catch (error) {
        setStatus(error.message, "error");
        setBusy(false);
        return;
      }
      state.profiles.push({
        ...profile,
      });
      state.selectedProfileIndex = state.profiles.length - 1;
      refreshValidation();
      renderAll();
      setBusy(false);
      setStatus("已新增用户并生成 CA", "success");
    }

    function selectProfile(index) {
      state.selectedProfileIndex = index;
      renderAll();
    }

    async function duplicateProfile() {
      const profile = selectedProfile();
      if (!profile) return;
      setBusy(true);
      setStatus("正在生成 MitM CA");
      const copy = {
        id: uniqueProfileId(profile.id + "-copy"),
        name: profile.name + " Copy",
        subscribeToken: "",
        mitm: blankMitm(profile.mitm.enabled),
        nodes: profile.nodes.map((node) => ({ ...node })),
      };
      try {
        copy.mitm = await createMitmCertificate(copy, copy.mitm);
      } catch (error) {
        setStatus(error.message, "error");
        setBusy(false);
        return;
      }
      state.profiles.splice(state.selectedProfileIndex + 1, 0, copy);
      state.selectedProfileIndex += 1;
      refreshValidation();
      renderAll();
      setBusy(false);
      setStatus("已复制用户并生成 CA", "success");
    }

    function deleteProfile() {
      const profile = selectedProfile();
      if (!profile || state.profiles.length <= 1) return;
      if (!confirm("删除用户 " + (profile.name || profile.id) + "？")) return;
      state.profiles.splice(state.selectedProfileIndex, 1);
      state.selectedProfileIndex = Math.min(state.selectedProfileIndex, state.profiles.length - 1);
      refreshValidation();
      renderAll();
      setStatus("已删除用户");
    }

    function addGroup() {
      const profile = selectedProfile();
      if (!profile) return;
      profile.nodes.push(blankNode(firstAvailableGroup(profile)));
      refreshValidation();
      renderAll();
      setStatus("已新增分组");
    }

    function addNode(group) {
      const profile = selectedProfile();
      if (!profile) return;
      profile.nodes.push(blankNode(group || firstAvailableGroup(profile)));
      refreshValidation();
      renderAll();
      setStatus("已新增节点");
    }

    function deleteGroup(group) {
      const profile = selectedProfile();
      if (!profile) return;
      const count = profile.nodes.filter((node) => node.group === group).length;
      if (!confirm("删除分组 " + group + " 及其中 " + count + " 个节点？")) return;
      profile.nodes = profile.nodes.filter((node) => node.group !== group);
      refreshValidation();
      renderAll();
      setStatus("已删除分组");
    }

    function deleteNode(index) {
      const profile = selectedProfile();
      if (!profile || !profile.nodes[index]) return;
      profile.nodes.splice(index, 1);
      refreshValidation();
      renderAll();
      setStatus("已删除节点");
    }

    async function copySelectedUrl() {
      const profile = selectedProfile();
      if (!profile || !profile.subscribeToken.trim()) return;
      const url = new URL(SUBSCRIPTION_PATH, window.location.href);
      url.searchParams.set("token", profile.subscribeToken.trim());
      try {
        await copyText(url.toString());
        setStatus("订阅地址已复制", "success");
      } catch (error) {
        setStatus(error.message, "error");
      }
    }

    async function copySelectedCertificate() {
      const profile = selectedProfile();
      if (!profile || !profile.mitm.caCertificate.trim()) return;
      try {
        await copyText(profile.mitm.caCertificate.trim() + "\\n");
        setStatus("CA 证书已复制", "success");
      } catch (error) {
        setStatus(error.message, "error");
      }
    }

    async function regenerateSelectedCertificate() {
      const profile = selectedProfile();
      if (!profile) return;
      if (profile.mitm.caCertificate && !confirm("重新生成 CA 后，需要在设备上安装并信任新证书。继续？")) return;
      setBusy(true);
      setStatus("正在重新生成 MitM CA");
      try {
        profile.mitm = await createMitmCertificate(profile, profile.mitm);
        refreshValidation();
        renderAll();
        setStatus("MitM CA 已重新生成", "success");
      } catch (error) {
        setStatus(error.message, "error");
      } finally {
        setBusy(false);
      }
    }

    async function createMitmCertificate(profile, previousMitm = blankMitm(true)) {
      const response = await fetch(ADMIN_CERTIFICATE_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: profile.id, name: profile.name }),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(text || response.statusText);
      const data = JSON.parse(text);
      return {
        ...normalizeMitm(data.mitm),
        enabled: previousMitm.enabled !== false,
        hostname: previousMitm.hostname || "",
      };
    }

    function renderAll() {
      renderSummary();
      renderProfiles();
      renderValidation();
      renderProfileEditor();
      renderDirtyState();
      updateSaveState();
    }

    function renderSummary() {
      const groupNames = new Set();
      let nodeCount = 0;
      for (const profile of state.profiles) {
        nodeCount += profile.nodes.length;
        for (const node of profile.nodes) {
          if (node.group.trim()) groupNames.add(node.group.trim());
        }
      }
      fields.profileCount.textContent = String(state.profiles.length);
      fields.nodeCount.textContent = String(nodeCount);
      fields.groupCount.textContent = String(groupNames.size);
      fields.checkCount.textContent = state.errors.length > 0 ? String(state.errors.length) : "OK";
      fields.userCountText.textContent = state.profiles.length + " 个用户";
    }

    function renderProfiles() {
      profileListEl.replaceChildren();
      if (state.profiles.length === 0) {
        profileListEl.append(emptyState("没有用户"));
        return;
      }

      state.profiles.forEach((profile, index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "profile-item" + (index === state.selectedProfileIndex ? " active" : "");
        item.dataset.action = "select-profile";
        item.dataset.profileIndex = String(index);

        const row = el("div", "profile-row");
        row.append(textEl("span", "profile-name", profile.name || profile.id || "Unnamed"));
        row.append(textEl("span", "profile-count", String(profile.nodes.length) + " nodes"));

        const meta = textEl("div", "profile-meta", (profile.id || "missing-id") + " / " + maskSecret(profile.subscribeToken));
        item.append(row, meta);
        profileListEl.append(item);
      });
    }

    function renderValidation() {
      validationEl.replaceChildren();
      validationEl.className = "validation";
      if (state.errors.length === 0 && state.warnings.length === 0) {
        validationEl.classList.add("visible");
        validationEl.textContent = "本地检查通过。";
        return;
      }

      validationEl.classList.add("visible", state.errors.length > 0 ? "error" : "warning");
      const title = document.createElement("strong");
      title.textContent = state.errors.length > 0 ? "需要修复" : "提示";
      const list = document.createElement("ul");
      for (const message of [...state.errors, ...state.warnings].slice(0, 10)) {
        const item = document.createElement("li");
        item.textContent = message;
        list.append(item);
      }
      validationEl.append(title, list);
    }

    function renderProfileEditor() {
      profileEditorEl.replaceChildren();
      const profile = selectedProfile();
      if (!profile) {
        fields.title.textContent = "用户配置";
        fields.subtitle.textContent = "加载后选择一个用户。";
        profileEditorEl.append(emptyState("没有可编辑用户"));
        return;
      }

      fields.title.textContent = profile.name || profile.id || "Unnamed";
      fields.subtitle.textContent = "User " + (state.selectedProfileIndex + 1) + " / " + state.profiles.length;

      const form = el("div", "card-grid");
      form.append(field("用户 ID", input("text", profile.id, "profile-field", "id", { autocomplete: "off" })));
      form.append(field("显示名称", input("text", profile.name, "profile-field", "name", { autocomplete: "off" })));
      form.append(field("订阅 Token", input("password", profile.subscribeToken, "profile-field", "subscribeToken", { autocomplete: "new-password" })));
      form.append(field("订阅路径", readonlyInput(subscriptionPath(profile)), "full"));
      profileEditorEl.append(form);

      const profileActions = el("div", "button-row");
      profileActions.append(actionButton("复制订阅地址", "copy-url", !profile.subscribeToken.trim()));
      profileActions.append(actionButton("复制用户", "duplicate-profile"));
      profileActions.append(actionButton("删除用户", "delete-profile", state.profiles.length <= 1, "danger"));
      profileEditorEl.append(profileActions);

      const mitmTitle = el("div", "section-title");
      mitmTitle.append(textEl("span", "", "MitM CA"));
      mitmTitle.append(actionButton("重新生成 CA", "regenerate-ca"));
      profileEditorEl.append(mitmTitle);

      const mitmForm = el("div", "card-grid");
      mitmForm.append(field("启用", checkbox("随订阅输出 MitM CA", profile.mitm.enabled)));
      mitmForm.append(field("CA 状态", readonlyInput(profile.mitm.caP12 ? "已生成" : "未生成")));
      mitmForm.append(field("解密域名", input("text", profile.mitm.hostname, "mitm-field", "hostname", { autocomplete: "off" }), "full"));
      profileEditorEl.append(mitmForm);

      const mitmActions = el("div", "button-row");
      mitmActions.append(actionButton("复制 CA 证书", "copy-ca", !profile.mitm.caCertificate.trim()));
      profileEditorEl.append(mitmActions);

      const groupsTitle = el("div", "section-title");
      groupsTitle.append(textEl("span", "", "节点分组"));
      groupsTitle.append(actionButton("新增分组", "add-group"));
      profileEditorEl.append(groupsTitle);

      const groups = groupedNodes(profile);
      const stack = el("div", "group-stack");
      if (groups.length === 0) {
        stack.append(emptyState("当前用户没有节点"));
      } else {
        for (const group of groups) {
          stack.append(renderGroup(group));
        }
      }
      profileEditorEl.append(stack);
      profileEditorEl.append(knownGroupsDatalist());
    }

    function renderGroup(group) {
      const card = el("section", "group-card");
      const heading = el("div", "group-heading");
      const titleRow = el("div", "group-title-row");
      titleRow.append(textEl("span", "", "Group"));
      const groupInput = document.createElement("input");
      groupInput.value = group.name;
      groupInput.dataset.groupField = "name";
      groupInput.dataset.group = group.name;
      groupInput.setAttribute("list", "known-groups");
      titleRow.append(groupInput);

      const actions = el("div", "top-actions");
      actions.append(actionButton("新增节点", "add-node", false, "", { group: group.name }));
      actions.append(actionButton("删除分组", "delete-group", false, "danger", { group: group.name }));
      heading.append(titleRow, actions);
      card.append(heading);

      const nodes = el("div", "node-stack");
      for (const nodeRef of group.nodes) {
        nodes.append(renderNode(nodeRef.node, nodeRef.index));
      }
      card.append(nodes);

      return card;
    }

    function renderNode(node, index) {
      const card = el("div", "node-card");
      card.append(field("节点名", input("text", node.name, "node-field", "name", { nodeIndex: index, autocomplete: "off" })));
      card.append(field("Surge 参数", textarea(node.value, "node-field", "value", { nodeIndex: index })));
      card.append(actionButton("删除", "delete-node", false, "danger", { nodeIndex: index }));
      return card;
    }

    function refreshDerived() {
      refreshValidation();
      renderSummary();
      renderValidation();
      renderDirtyState();
      updateSaveState();
    }

    function refreshValidation() {
      const report = validateProfiles(state.profiles);
      state.errors = report.errors;
      state.warnings = report.warnings;
    }

    function validateProfiles(profiles) {
      const errors = [];
      const warnings = [];
      if (profiles.length === 0) errors.push("至少需要一个用户");

      const ids = new Set();
      const tokens = new Set();
      profiles.forEach((profile, profileIndex) => {
        const label = "用户 " + (profile.name || profile.id || "#" + (profileIndex + 1));
        checkSingleLine(profile.id, label + " 的 ID", errors);
        checkSingleLine(profile.name, label + " 的名称", errors);
        checkSingleLine(profile.subscribeToken, label + " 的订阅 Token", errors);
        checkRequired(profile.id, label + " 缺少 ID", errors);
        checkRequired(profile.name, label + " 缺少名称", errors);
        checkRequired(profile.subscribeToken, label + " 缺少订阅 Token", errors);
        if (profile.id.includes(",")) errors.push(label + " 的 ID 不能包含逗号");
        if (profile.id.trim()) {
          if (ids.has(profile.id.trim())) errors.push("重复的用户 ID: " + profile.id.trim());
          ids.add(profile.id.trim());
        }
        if (profile.subscribeToken.trim()) {
          if (tokens.has(profile.subscribeToken.trim())) errors.push(label + " 的订阅 Token 与其他用户重复");
          tokens.add(profile.subscribeToken.trim());
        }
        checkSingleLine(profile.mitm.hostname, label + " 的 MitM 解密域名", errors);
        checkSingleLine(profile.mitm.caP12, label + " 的 MitM caP12", errors);
        checkSingleLine(profile.mitm.caPassphrase, label + " 的 MitM caPassphrase", errors);
        if (profile.mitm.enabled && (!profile.mitm.caP12.trim() || !profile.mitm.caPassphrase.trim())) {
          errors.push(label + " 启用 MitM 时需要 CA 证书");
        }
        if (profile.mitm.caP12.trim() && !/^[A-Za-z0-9+/=]+$/.test(profile.mitm.caP12.trim())) {
          errors.push(label + " 的 MitM caP12 必须是 base64");
        }
        if (profile.nodes.length === 0) {
          errors.push(label + " 至少需要一个节点");
          return;
        }

        const nodeNames = new Set();
        profile.nodes.forEach((node, nodeIndex) => {
          const nodeLabel = label + " 节点 #" + (nodeIndex + 1);
          checkSingleLine(node.group, nodeLabel + " 的分组", errors);
          checkSingleLine(node.name, nodeLabel + " 的节点名", errors);
          checkSingleLine(node.value, nodeLabel + " 的 Surge 参数", errors);
          checkRequired(node.group, nodeLabel + " 缺少分组", errors);
          checkRequired(node.name, nodeLabel + " 缺少节点名", errors);
          checkRequired(node.value, nodeLabel + " 缺少 Surge 参数", errors);
          if (node.group.includes(",")) errors.push(nodeLabel + " 的分组不能包含逗号");
          if (node.group.trim() && !DEFAULT_GROUPS.includes(node.group.trim())) {
            warnings.push(nodeLabel + " 的分组需要确认已在 surge/template.conf 中声明");
          }
          if (node.name.includes(",")) errors.push(nodeLabel + " 的节点名不能包含逗号");
          if (node.name.trim()) {
            if (nodeNames.has(node.name.trim())) errors.push(label + " 存在重复节点名: " + node.name.trim());
            nodeNames.add(node.name.trim());
          }
        });
      });

      return { errors, warnings };
    }

    function normalizeProfiles(config) {
      if (!config || typeof config !== "object" || Array.isArray(config)) return [];
      const profiles = Array.isArray(config.profiles)
        ? config.profiles
        : [{
            id: "default",
            name: "Default",
            subscribeToken: config.subscribeToken,
            nodes: config.nodes,
          }];

      return profiles.map((profile, index) => ({
        id: stringValue(profile && profile.id) || "user-" + (index + 1),
        name: stringValue(profile && profile.name) || "User " + (index + 1),
        subscribeToken: stringValue(profile && profile.subscribeToken),
        mitm: normalizeMitm(profile && profile.mitm),
        nodes: Array.isArray(profile && profile.nodes)
          ? profile.nodes.map(normalizeNode)
          : [],
      }));
    }

    function normalizeMitm(mitm) {
      if (!mitm || typeof mitm !== "object" || Array.isArray(mitm)) return blankMitm();
      return {
        enabled: mitm.enabled === true,
        hostname: stringValue(mitm.hostname),
        caP12: stringValue(mitm.caP12),
        caPassphrase: stringValue(mitm.caPassphrase),
        caCertificate: stringValue(mitm.caCertificate),
      };
    }

    function normalizeNode(node) {
      const group = stringValue(node && node.group);
      if (typeof (node && node.line) === "string") {
        const separator = node.line.indexOf("=");
        if (separator === -1) {
          return { group, name: "", value: node.line };
        }
        return {
          group,
          name: node.line.slice(0, separator).trim(),
          value: node.line.slice(separator + 1).trim(),
        };
      }
      return {
        group,
        name: stringValue(node && node.name),
        value: stringValue(node && node.value),
      };
    }

    function buildConfig() {
      return {
        profiles: state.profiles.map((profile) => ({
          id: profile.id.trim(),
          name: profile.name.trim(),
          subscribeToken: profile.subscribeToken.trim(),
          ...(hasMitm(profile.mitm) ? {
            mitm: {
              enabled: profile.mitm.enabled,
              hostname: profile.mitm.hostname.trim(),
              caP12: profile.mitm.caP12.trim(),
              caPassphrase: profile.mitm.caPassphrase.trim(),
              caCertificate: profile.mitm.caCertificate.trim(),
            },
          } : {}),
          nodes: profile.nodes.map((node) => ({
            group: node.group.trim(),
            line: node.name.trim() + " = " + node.value.trim(),
          })),
        })),
      };
    }

    function hasMitm(mitm) {
      return !!mitm && (
        mitm.enabled
        || mitm.hostname.trim()
        || mitm.caP12.trim()
        || mitm.caPassphrase.trim()
        || mitm.caCertificate.trim()
      );
    }

    function snapshotConfig() {
      return JSON.stringify(buildConfig(), null, 2);
    }

    function selectedProfile() {
      return state.profiles[state.selectedProfileIndex];
    }

    function groupedNodes(profile) {
      const groups = [];
      const byName = new Map();
      profile.nodes.forEach((node, index) => {
        const groupName = node.group || "";
        let group = byName.get(groupName);
        if (!group) {
          group = { name: groupName, nodes: [] };
          byName.set(groupName, group);
          groups.push(group);
        }
        group.nodes.push({ node, index });
      });
      return groups;
    }

    function firstAvailableGroup(profile = selectedProfile()) {
      const used = new Set((profile ? profile.nodes : []).map((node) => node.group));
      for (const group of DEFAULT_GROUPS) {
        if (!used.has(group)) return group;
      }
      let index = 1;
      while (used.has("新分组 " + index)) index += 1;
      return "新分组 " + index;
    }

    function blankNode(group) {
      return { group, name: "", value: "" };
    }

    function blankMitm(enabled = false) {
      return {
        enabled,
        hostname: "",
        caP12: "",
        caPassphrase: "",
        caCertificate: "",
      };
    }

    function uniqueProfileId(base) {
      const cleanBase = (base || "user").trim() || "user";
      const existing = new Set(state.profiles.map((profile) => profile.id.trim()));
      if (!existing.has(cleanBase)) return cleanBase;
      let index = 2;
      while (existing.has(cleanBase + "-" + index)) index += 1;
      return cleanBase + "-" + index;
    }

    function renderDirtyState() {
      const changed = isDirty();
      fields.dirtyState.className = "dirty" + (changed ? " changed" : "");
      fields.dirtyState.textContent = changed ? "有未保存更改" : state.savedSnapshot ? "已保存" : "未加载";
    }

    function updateSaveState() {
      saveButton.disabled = state.busy || state.errors.length > 0 || state.profiles.length === 0;
    }

    function setBusy(isBusy) {
      state.busy = isBusy;
      renderAll();
      document.querySelector('[data-action="load"]').disabled = isBusy;
      document.querySelector('[data-action="add-profile"]').disabled = isBusy;
      updateSaveState();
    }

    function setStatus(message, tone) {
      statusEl.textContent = message;
      statusEl.className = "status-pill" + (tone ? " " + tone : "");
    }

    function isDirty() {
      return state.savedSnapshot !== "" && snapshotConfig() !== state.savedSnapshot;
    }

    function subscriptionPath(profile) {
      if (!profile.subscribeToken.trim()) return "";
      return SUBSCRIPTION_PATH + "?token=" + maskSecret(profile.subscribeToken.trim());
    }

    function checkRequired(value, message, errors) {
      if (typeof value !== "string" || value.trim() === "") errors.push(message);
    }

    function checkSingleLine(value, label, errors) {
      if (typeof value === "string" && /[\\r\\n]/.test(value)) errors.push(label + " 必须是单行");
    }

    function stringValue(value) {
      return typeof value === "string" ? value : "";
    }

    function maskSecret(value) {
      if (typeof value !== "string" || value.length === 0) return "";
      if (value.length <= 8) return "••••";
      return value.slice(0, 4) + "••••" + value.slice(-4);
    }

    function el(tag, className) {
      const element = document.createElement(tag);
      if (className) element.className = className;
      return element;
    }

    function textEl(tag, className, text) {
      const element = el(tag, className);
      element.textContent = text;
      return element;
    }

    function field(labelText, control, variant = "") {
      const wrapper = el("div", "field" + (variant ? " " + variant : ""));
      const label = document.createElement("label");
      label.textContent = labelText;
      wrapper.append(label, control);
      return wrapper;
    }

    function input(type, value, dataKind, dataField, extra = {}) {
      const control = document.createElement("input");
      control.type = type;
      control.value = value;
      control.setAttribute("data-" + dataKind, dataField);
      if (extra.nodeIndex != null) control.dataset.nodeIndex = String(extra.nodeIndex);
      if (extra.autocomplete) control.autocomplete = extra.autocomplete;
      return control;
    }

    function checkbox(labelText, checked) {
      const wrapper = el("label", "check-control");
      const control = document.createElement("input");
      control.type = "checkbox";
      control.checked = checked;
      control.dataset.mitmToggle = "enabled";
      wrapper.append(control, document.createTextNode(labelText));
      return wrapper;
    }

    function readonlyInput(value) {
      const control = document.createElement("input");
      control.value = value;
      control.readOnly = true;
      control.className = "subtle-input";
      return control;
    }

    function textarea(value, dataKind, dataField, extra = {}) {
      const control = document.createElement("textarea");
      control.value = value;
      control.setAttribute("data-" + dataKind, dataField);
      if (extra.nodeIndex != null) control.dataset.nodeIndex = String(extra.nodeIndex);
      return control;
    }

    function knownGroupsDatalist() {
      const datalist = document.createElement("datalist");
      datalist.id = "known-groups";
      for (const groupName of DEFAULT_GROUPS) {
        const option = document.createElement("option");
        option.value = groupName;
        datalist.append(option);
      }
      return datalist;
    }

    function actionButton(label, action, disabled = false, tone = "", extra = {}) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.action = action;
      if (tone) button.className = tone;
      if (state.busy || disabled) button.disabled = true;
      for (const [key, value] of Object.entries(extra)) {
        button.dataset[key] = String(value);
      }
      return button;
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
      if (!ok) throw new Error("复制失败");
    }
  </script>
</body>
</html>`;
}
