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
      --bg: #f7f9fd;
      --surface: #ffffff;
      --surface-muted: #f8fbff;
      --surface-soft: #fbfcff;
      --border: #e0e7f2;
      --border-strong: #cdd8ea;
      --text: #0f172a;
      --muted: #64728a;
      --muted-soft: #8ea0ba;
      --primary: #2563eb;
      --primary-strong: #1e55d6;
      --primary-soft: #eef4ff;
      --primary-border: #b9cdfc;
      --danger: #ef1b2d;
      --danger-soft: #fff2f4;
      --success: #16a34a;
      --success-soft: #eafaf0;
      --success-border: #bdeccc;
      --warning: #f59e0b;
      --warning-soft: #fff7e7;
      --warning-border: #fed99c;
      --purple: #6d5dfc;
      --purple-soft: #f0efff;
      --focus: rgba(37, 99, 235, .18);
      --shadow: 0 10px 26px rgba(15, 23, 42, .06);
      --shadow-soft: 0 8px 18px rgba(15, 23, 42, .045);
      background: var(--bg);
      color: var(--text);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, .86) 0%, rgba(247, 249, 253, .96) 40%, #f7f9fd 100%);
      color: var(--text);
    }
    button, input, textarea { font: inherit; }
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 36px;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0 14px;
      background: var(--surface);
      color: var(--text);
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      box-shadow: 0 1px 0 rgba(15, 23, 42, .02);
    }
    button:hover:not(:disabled) { background: var(--primary-soft); border-color: var(--primary-border); color: var(--primary-strong); }
    button:focus-visible, input:focus-visible, textarea:focus-visible {
      outline: 3px solid var(--focus);
      outline-offset: 1px;
    }
    button:disabled { opacity: .55; cursor: not-allowed; }
    button.primary { background: var(--primary); border-color: var(--primary); color: #fff; box-shadow: 0 8px 18px rgba(37, 99, 235, .22); }
    button.primary:hover:not(:disabled) { background: var(--primary-strong); border-color: var(--primary-strong); color: #fff; }
    button.danger { background: #fff; color: var(--danger); border-color: #ffb8c0; }
    button.danger:hover:not(:disabled) { background: var(--danger-soft); border-color: #ff8a98; color: #cf1124; }
    button.subtle { color: var(--primary); border-color: var(--primary-border); background: #fff; }
    button.ghost { border-color: transparent; background: transparent; box-shadow: none; }
    button.ghost:hover:not(:disabled) { background: var(--primary-soft); border-color: var(--border); }
    button.icon-only {
      width: 34px;
      min-width: 34px;
      padding: 0;
      color: #51617a;
    }
    button.icon-only .button-label { display: none; }
    button::before {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      font-size: 16px;
      line-height: 1;
      color: currentColor;
    }
    button[data-action="save"]::before { content: "▣"; }
    button[data-action="load"]::before { content: "↻"; }
    button[data-action="add-profile"]::before,
    button[data-action="add-group"]::before,
    button[data-action="add-node"]::before { content: "+"; font-size: 18px; font-weight: 500; }
    button[data-action="copy-url"]::before,
    button[data-action="copy-profile-url"]::before,
    button[data-action="copy-id"]::before,
    button[data-action="copy-ca"]::before,
    button[data-action="copy-node"]::before { content: "▣"; font-size: 13px; }
    button[data-action="regenerate-ca"]::before { content: "↻"; }
    button[data-action="delete-profile"]::before,
    button[data-action="delete-group"]::before,
    button[data-action="delete-node"]::before { content: "⌫"; font-size: 14px; }
    button[data-action="focus-profile-fields"]::before { content: "✎"; }
    button[data-page-action]::before { content: none; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: .95em;
    }
    .shell {
      width: min(1480px, calc(100% - 24px));
      min-height: calc(100vh - 24px);
      margin: 12px auto;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(255, 255, 255, .72);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .app-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      min-height: 76px;
      border-bottom: 1px solid var(--border);
      padding: 18px 28px;
      background: rgba(255, 255, 255, .9);
      backdrop-filter: blur(18px);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
    }
    .brand-mark {
      position: relative;
      width: 34px;
      height: 34px;
      color: var(--primary);
      flex: 0 0 auto;
    }
    .brand-mark::before {
      content: "";
      position: absolute;
      inset: 1px 2px;
      background: currentColor;
      clip-path: polygon(50% 0, 100% 100%, 74% 100%, 62% 75%, 37% 75%, 25% 100%, 0 100%);
    }
    .brand-mark::after {
      content: "";
      position: absolute;
      left: 12px;
      right: 12px;
      bottom: 8px;
      height: 5px;
      background: #fff;
      border-radius: 999px;
    }
    .brand-title {
      display: flex;
      align-items: baseline;
      gap: 28px;
      min-width: 0;
    }
    h1, h2, h3, p { margin-top: 0; }
    h1 { margin-bottom: 0; font-size: 22px; line-height: 1.2; letter-spacing: 0; }
    h2 { margin-bottom: 0; font-size: 20px; line-height: 1.25; letter-spacing: 0; }
    h3 { margin-bottom: 0; font-size: 15px; line-height: 1.35; letter-spacing: 0; }
    .brand-subtitle {
      color: #50617a;
      font-size: 14px;
      font-weight: 600;
      white-space: nowrap;
    }
    .app-actions,
    .top-actions,
    .editor-actions,
    .button-row,
    .node-actions,
    .pager {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .app-actions { justify-content: flex-end; flex-wrap: wrap; }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      min-height: 40px;
      max-width: 260px;
      border: 1px solid var(--border);
      border-radius: 9px;
      padding: 0 14px;
      background: #fff;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
      box-shadow: 0 1px 0 rgba(15, 23, 42, .02);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .status-pill::before,
    .dirty::before,
    .ca-state::before {
      content: "";
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--warning);
      box-shadow: 0 0 0 7px var(--warning-soft);
    }
    .status-pill.error { border-color: #ffc0c8; background: var(--danger-soft); color: var(--danger); }
    .status-pill.error::before { background: var(--danger); box-shadow: 0 0 0 7px #ffe5e9; }
    .status-pill.success { border-color: var(--success-border); background: var(--success-soft); color: #13843f; }
    .status-pill.success::before { background: var(--success); box-shadow: 0 0 0 7px #dff8e8; }
    .content { padding: 24px; }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 24px;
      margin-bottom: 18px;
    }
    .metric {
      display: flex;
      align-items: center;
      gap: 18px;
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
      padding: 18px 20px;
      box-shadow: var(--shadow-soft);
    }
    .metric-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 54px;
      height: 54px;
      border-radius: 999px;
      background: var(--primary-soft);
      color: var(--primary);
      flex: 0 0 auto;
    }
    .metric-icon svg { width: 27px; height: 27px; stroke: currentColor; stroke-width: 2.3; fill: none; }
    .metric.ca .metric-icon { background: var(--success-soft); color: var(--success); }
    .metric.groups .metric-icon { background: var(--purple-soft); color: var(--purple); }
    .metric.nodes .metric-icon { background: #eef4ff; color: var(--primary); }
    .metric span {
      display: block;
      margin-bottom: 5px;
      color: #64728a;
      font-size: 13px;
      font-weight: 700;
    }
    .metric strong {
      display: block;
      color: #111827;
      font-size: 26px;
      line-height: 1;
      letter-spacing: 0;
    }
    .workspace {
      display: grid;
      grid-template-columns: 414px minmax(0, 1fr);
      gap: 20px;
      align-items: start;
    }
    .panel {
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
      overflow: hidden;
      box-shadow: var(--shadow-soft);
    }
    .panel-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 22px 22px 12px;
      background: #fff;
    }
    .panel-heading p { margin: 4px 0 0; color: var(--muted); font-size: 13px; line-height: 1.4; }
    .panel-body { padding: 0 24px 18px; }
    .user-tools {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 16px;
      padding: 0 22px 16px;
    }
    .search-box {
      position: relative;
      display: block;
      min-width: 0;
    }
    .search-box::before {
      content: "⌕";
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: #708096;
      font-size: 18px;
      line-height: 1;
      pointer-events: none;
    }
    .search-box input { padding-left: 36px; }
    .profile-list {
      display: grid;
      grid-auto-rows: 84px;
      align-content: start;
      border-top: 1px solid var(--border);
      min-height: 480px;
    }
    .profile-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 40px;
      align-items: center;
      gap: 10px;
      min-height: 0;
      border-bottom: 1px solid var(--border);
      background: #fff;
      padding: 0 12px 0 24px;
    }
    .profile-item.active {
      background: #f5f9ff;
      box-shadow: inset 4px 0 0 var(--primary);
    }
    .profile-main {
      display: block;
      width: 100%;
      height: auto;
      border-color: transparent;
      border-radius: 8px;
      background: transparent;
      padding: 0;
      text-align: left;
      white-space: normal;
      box-shadow: none;
    }
    .profile-main::before { content: none; }
    .profile-main:hover:not(:disabled) { background: transparent; color: var(--text); }
    .profile-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
    }
    .profile-name {
      flex: 1 1 auto;
      overflow: hidden;
      color: var(--text);
      font-size: 15px;
      font-weight: 800;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .profile-count {
      color: #5d6d85;
      font-size: 13px;
      font-weight: 700;
      white-space: nowrap;
    }
    .profile-meta {
      margin-top: 6px;
      overflow: hidden;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.35;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .profile-badge {
      display: inline-flex;
      align-items: center;
      min-height: 26px;
      border: 1px solid var(--success-border);
      border-radius: 6px;
      padding: 0 9px;
      background: var(--success-soft);
      color: #15803d;
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
    }
    .profile-badge.missing {
      border-color: var(--warning-border);
      background: var(--warning-soft);
      color: #c55d00;
    }
    .profile-badge,
    .profile-count { flex: 0 0 auto; }
    .profile-pager {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      min-height: 72px;
      padding: 14px;
    }
    .profile-pager button {
      width: 32px;
      min-width: 32px;
      min-height: 32px;
      padding: 0;
      border-radius: 7px;
    }
    .profile-pager button.active {
      border-color: var(--primary);
      color: var(--primary);
      background: #fff;
      box-shadow: 0 4px 12px rgba(37, 99, 235, .12);
    }
    .editor-panel { min-height: 760px; }
    .editor-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      padding: 22px 24px 12px;
      background: #fff;
    }
    .profile-title-line {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .profile-title-line h2 {
      overflow: hidden;
      font-size: 26px;
      font-weight: 850;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .id-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
    }
    .id-chip {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      border: 1px solid var(--border);
      border-radius: 7px;
      padding: 0 10px;
      background: var(--surface-soft);
      color: #64728a;
      font-size: 13px;
      font-weight: 700;
    }
    .editor-actions { flex-wrap: wrap; justify-content: flex-end; }
    .validation {
      display: none;
      margin-bottom: 14px;
      border: 1px solid var(--border);
      border-left: 3px solid var(--border-strong);
      border-radius: 9px;
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
    .account-card,
    .mitm-card {
      border: 1px solid var(--border);
      border-radius: 9px;
      background: #fff;
      margin-bottom: 20px;
    }
    .account-card { padding: 14px; }
    .account-card .button-row { margin-top: 14px; }
    .mitm-card {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 16px;
      align-items: center;
      padding: 14px 18px;
    }
    .mitm-main {
      display: flex;
      align-items: center;
      gap: 16px;
      min-width: 0;
      flex-wrap: wrap;
    }
    .mitm-main strong {
      font-size: 16px;
      font-weight: 850;
    }
    .ca-state {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: #36445a;
      font-size: 13px;
      font-weight: 700;
    }
    .ca-state.missing::before { background: var(--warning); box-shadow: 0 0 0 0 transparent; }
    .ca-state.ready::before { background: var(--success); box-shadow: 0 0 0 0 transparent; }
    .mitm-fields {
      display: grid;
      grid-template-columns: 180px minmax(0, 1fr);
      gap: 12px 16px;
      align-items: end;
      margin-top: 10px;
    }
    .card-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px 16px;
    }
    .field { min-width: 0; }
    .field.full { grid-column: 1 / -1; }
    label {
      display: block;
      margin-bottom: 6px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
    }
    input, textarea {
      width: 100%;
      border: 1px solid var(--border-strong);
      border-radius: 7px;
      background: var(--surface);
      color: var(--text);
    }
    input { min-height: 34px; padding: 0 10px; }
    input[type="checkbox"] { width: 16px; min-height: 0; height: 16px; padding: 0; }
    textarea {
      min-height: 34px;
      resize: vertical;
      padding: 8px 10px;
      font: 13px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
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
    .button-row { flex-wrap: wrap; margin-top: 0; }
    .section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 6px 0 10px;
      color: var(--text);
      font-size: 16px;
      font-weight: 850;
    }
    .group-stack { display: grid; gap: 14px; border: 0; border-radius: 0; }
    .group-card {
      border: 1px solid var(--border);
      border-radius: 9px;
      overflow: hidden;
      background: var(--surface);
    }
    .group-heading {
      display: grid;
      grid-template-columns: minmax(220px, .36fr) minmax(90px, 1fr) auto;
      gap: 16px;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding: 10px 12px;
      background: var(--surface-soft);
    }
    .group-title-row {
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr);
      gap: 10px;
      align-items: center;
    }
    .drag-handle {
      color: var(--muted);
      font-size: 18px;
      line-height: 1;
      text-align: center;
      cursor: default;
      user-select: none;
    }
    .group-count {
      color: #718096;
      font-size: 13px;
      font-weight: 700;
    }
    .node-table { display: grid; }
    .node-head,
    .node-card {
      display: grid;
      grid-template-columns: minmax(160px, .3fr) minmax(260px, 1fr) 108px;
      gap: 28px;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding: 7px 18px;
    }
    .node-head {
      min-height: 36px;
      background: #fbfcff;
      color: #485a73;
      font-size: 13px;
      font-weight: 800;
    }
    .node-card { min-height: 39px; background: #fff; }
    .node-card .field label { display: none; }
    .node-card textarea { resize: none; }
    .node-actions { justify-content: flex-start; gap: 8px; }
    .add-node-row {
      padding: 8px 16px;
      background: #fff;
    }
    .add-node-row button {
      width: 100%;
      border-style: dashed;
      color: var(--primary);
      background: #fff;
    }
    .empty {
      border: 1px dashed var(--border-strong);
      border-radius: 9px;
      padding: 18px;
      color: var(--muted);
      font-size: 14px;
      text-align: center;
      background: #fff;
    }
    .dirty {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      min-height: 40px;
      border: 1px solid var(--border);
      border-radius: 9px;
      padding: 0 14px;
      background: #fff;
      color: var(--muted);
      font-size: 13px;
      font-weight: 800;
    }
    .dirty::before { width: 10px; height: 10px; }
    .dirty.changed { border-color: var(--warning-border); color: #9a5a00; background: var(--warning-soft); }
    @media (max-width: 1180px) {
      .workspace { grid-template-columns: 1fr; }
      .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .profile-list { min-height: auto; }
    }
    @media (max-width: 760px) {
      .shell { width: 100%; min-height: 100vh; margin: 0; border-radius: 0; border-left: 0; border-right: 0; }
      .app-bar, .editor-head, .panel-heading { align-items: stretch; flex-direction: column; }
      .brand-title { align-items: flex-start; flex-direction: column; gap: 2px; }
      .content { padding: 16px; }
      .app-actions, .top-actions, .editor-actions { justify-content: stretch; }
      .app-actions > *, .top-actions button, .editor-actions button { flex: 1 1 130px; }
      .summary-grid, .card-grid, .mitm-card, .mitm-fields, .group-heading, .node-head, .node-card, .user-tools { grid-template-columns: 1fr; }
      .node-head { display: none; }
      .node-card { gap: 8px; padding: 12px; }
      .profile-title-line h2 { white-space: normal; }
    }
  </style>
</head>
<body>
  <main class="shell" id="admin-root">
    <header class="app-bar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <div class="brand-title">
          <h1>AtlasRouter Admin</h1>
          <span class="brand-subtitle">用户配置管理</span>
        </div>
      </div>
      <div class="app-actions">
        <div class="dirty" id="dirty-state">未加载</div>
        <button type="button" data-action="load">重新加载</button>
        <button type="button" data-action="save" class="primary" disabled>保存更改</button>
        <div class="status-pill" id="status" role="status">准备加载配置</div>
      </div>
    </header>

    <div class="content">
      <section class="summary-grid" aria-label="配置摘要">
        <article class="metric users">
          <span class="metric-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M16 19v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 19v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </span>
          <div>
            <span>用户数</span>
            <strong id="profile-count">--</strong>
          </div>
        </article>
        <article class="metric ca">
          <span class="metric-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8Z"/><path d="m9 12 2 2 4-5"/></svg>
          </span>
          <div>
            <span>已配置 CA</span>
            <strong id="check-count">--</strong>
          </div>
        </article>
        <article class="metric groups">
          <span class="metric-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>
          </span>
          <div>
            <span>节点组</span>
            <strong id="group-count">--</strong>
          </div>
        </article>
        <article class="metric nodes">
          <span class="metric-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><path d="M12 8v4"/><path d="m8 16 4-4 4 4"/></svg>
          </span>
          <div>
            <span>节点</span>
            <strong id="node-count">--</strong>
          </div>
        </article>
      </section>

      <section class="workspace">
        <aside class="panel" aria-label="用户列表">
          <div class="panel-heading">
            <h2>用户</h2>
          </div>
          <div class="user-tools">
            <label class="search-box">
              <input id="profile-search" type="search" data-profile-filter placeholder="搜索用户名或 ID" autocomplete="off">
            </label>
            <button type="button" data-action="add-profile">新建用户</button>
          </div>
          <div class="profile-list" id="profile-list">
            <div class="empty">尚未加载配置</div>
          </div>
          <div class="profile-pager" id="profile-pager"></div>
        </aside>

        <section class="panel editor-panel" aria-label="用户配置">
          <div class="editor-head">
            <div>
              <div class="profile-title-line">
                <h2 id="profile-title">用户配置</h2>
                <button type="button" class="icon-only" data-action="focus-profile-fields" aria-label="编辑用户信息" title="编辑用户信息"></button>
              </div>
              <div class="id-row">
                <span class="id-chip" id="profile-subtitle">加载后选择一个用户。</span>
                <button type="button" class="icon-only" data-action="copy-id" aria-label="复制用户 ID" title="复制用户 ID" disabled></button>
              </div>
            </div>
            <div class="editor-actions">
              <button type="button" data-action="copy-url" class="subtle" disabled>复制订阅链接</button>
            </div>
          </div>
          <div class="panel-body">
            <div class="validation" id="validation"></div>
            <div id="profile-editor">
              <div class="empty">尚未加载配置</div>
            </div>
          </div>
        </section>
      </section>
    </div>
  </main>

  <script>
    const ADMIN_CERTIFICATE_PATH = ${JSON.stringify(ADMIN_CERTIFICATE_PATH)};
    const ADMIN_CONFIG_PATH = ${JSON.stringify(ADMIN_CONFIG_PATH)};
    const SUBSCRIPTION_PATH = ${JSON.stringify(SUBSCRIPTION_PATH)};
    const DEFAULT_GROUPS = ["🇺🇸 US", "🇯🇵 JP", "🇺🇸 US Home"];
    const rootEl = document.getElementById("admin-root");
    const statusEl = document.getElementById("status");
    const profileListEl = document.getElementById("profile-list");
    const profilePagerEl = document.getElementById("profile-pager");
    const profileSearchEl = document.getElementById("profile-search");
    const profileEditorEl = document.getElementById("profile-editor");
    const validationEl = document.getElementById("validation");
    const saveButton = document.querySelector('[data-action="save"]');
    const PROFILE_PAGE_SIZE = 6;
    const fields = {
      profileCount: document.getElementById("profile-count"),
      nodeCount: document.getElementById("node-count"),
      groupCount: document.getElementById("group-count"),
      checkCount: document.getElementById("check-count"),
      title: document.getElementById("profile-title"),
      subtitle: document.getElementById("profile-subtitle"),
      dirtyState: document.getElementById("dirty-state"),
      copyUrlButton: document.querySelector('[data-action="copy-url"]'),
      copyIdButton: document.querySelector('[data-action="copy-id"]'),
      editButton: document.querySelector('[data-action="focus-profile-fields"]'),
    };

    let state = {
      profiles: [],
      selectedProfileIndex: 0,
      savedSnapshot: "",
      busy: false,
      errors: ["尚未加载配置"],
      warnings: [],
      profileSearch: "",
      profilePage: 0,
      showProfileFields: false,
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
        if (!response.ok) throw new Error(responseErrorMessage(response, text));
        state.profiles = normalizeProfiles(JSON.parse(text));
        state.selectedProfileIndex = 0;
        state.showProfileFields = false;
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
        if (!response.ok) throw new Error(responseErrorMessage(response, text));
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
      if (action === "profile-page") return setProfilePage(Number(target.dataset.page));
      if (action === "duplicate-profile") return duplicateProfile();
      if (action === "delete-profile") return deleteProfile();
      if (action === "copy-url") return copySelectedUrl();
      if (action === "copy-profile-url") return copyProfileUrl(Number(target.dataset.profileIndex));
      if (action === "copy-id") return copySelectedId();
      if (action === "copy-ca") return copySelectedCertificate();
      if (action === "copy-node") return copyNode(Number(target.dataset.nodeIndex));
      if (action === "focus-profile-fields") return focusProfileFields();
      if (action === "regenerate-ca") return regenerateSelectedCertificate();
      if (action === "add-group") return addGroup();
      if (action === "add-node") return addNode(target.dataset.group);
      if (action === "delete-group") return deleteGroup(target.dataset.group);
      if (action === "delete-node") return deleteNode(Number(target.dataset.nodeIndex));
    }

    function handleInput(event) {
      const target = event.target;
      if (target.matches("[data-profile-filter]")) {
        state.profileSearch = target.value;
        state.profilePage = 0;
        renderProfiles();
        return;
      }
      if (target.matches("[data-profile-field]")) {
        const profile = selectedProfile();
        if (!profile) return;
        profile[target.dataset.profileField] = target.value;
        refreshDerived();
        fields.title.textContent = profile.name || profile.id || "Unnamed";
        fields.subtitle.textContent = "ID: " + (profile.id || "missing-id");
        renderProfiles();
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
      state.showProfileFields = true;
      refreshValidation();
      renderAll();
      setBusy(false);
      setStatus("已新增用户并生成 CA", "success");
    }

    function selectProfile(index) {
      state.selectedProfileIndex = index;
      state.showProfileFields = false;
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
      state.showProfileFields = true;
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
      state.showProfileFields = false;
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
      return copyProfileUrl(state.selectedProfileIndex);
    }

    async function copyProfileUrl(index) {
      const profile = state.profiles[index];
      if (!profile || !profile.subscribeToken.trim()) return;
      try {
        await copyText(subscriptionUrl(profile));
        setStatus("订阅地址已复制", "success");
      } catch (error) {
        setStatus(error.message, "error");
      }
    }

    async function copySelectedId() {
      const profile = selectedProfile();
      if (!profile || !profile.id.trim()) return;
      try {
        await copyText(profile.id.trim());
        setStatus("用户 ID 已复制", "success");
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

    async function copyNode(index) {
      const profile = selectedProfile();
      const node = profile && profile.nodes[index];
      if (!node) return;
      try {
        await copyText((node.name.trim() ? node.name.trim() + " = " : "") + node.value.trim());
        setStatus("节点信息已复制", "success");
      } catch (error) {
        setStatus(error.message, "error");
      }
    }

    function focusProfileFields() {
      state.showProfileFields = true;
      renderProfileEditor();
      updateStaticActionState();
      const firstField = profileEditorEl.querySelector("[data-profile-field]");
      if (firstField) firstField.focus();
    }

    function setProfilePage(page) {
      state.profilePage = Math.max(0, page);
      renderProfiles();
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
      if (!response.ok) throw new Error(responseErrorMessage(response, text));
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
      updateStaticActionState();
    }

    function renderSummary() {
      let nodeCount = 0;
      let groupCount = 0;
      let caCount = 0;
      for (const profile of state.profiles) {
        nodeCount += profile.nodes.length;
        groupCount += groupedNodes(profile).filter((group) => group.name.trim()).length;
        if (profileHasCa(profile)) caCount += 1;
      }
      fields.profileCount.textContent = String(state.profiles.length);
      fields.nodeCount.textContent = String(nodeCount);
      fields.groupCount.textContent = String(groupCount);
      fields.checkCount.textContent = String(caCount);
    }

    function renderProfiles() {
      profileListEl.replaceChildren();
      profilePagerEl.replaceChildren();
      if (profileSearchEl.value !== state.profileSearch) profileSearchEl.value = state.profileSearch;
      if (state.profiles.length === 0) {
        profileListEl.append(emptyState("没有用户"));
        return;
      }

      const query = state.profileSearch.trim().toLowerCase();
      const filtered = state.profiles
        .map((profile, index) => ({ profile, index }))
        .filter(({ profile }) => {
          if (!query) return true;
          return (profile.name || "").toLowerCase().includes(query)
            || (profile.id || "").toLowerCase().includes(query);
        });

      if (filtered.length === 0) {
        profileListEl.append(emptyState("没有匹配的用户"));
        return;
      }

      const totalPages = Math.max(1, Math.ceil(filtered.length / PROFILE_PAGE_SIZE));
      if (state.profilePage >= totalPages) state.profilePage = totalPages - 1;
      const start = state.profilePage * PROFILE_PAGE_SIZE;
      const pageItems = filtered.slice(start, start + PROFILE_PAGE_SIZE);

      for (const { profile, index } of pageItems) {
        const item = el("article", "profile-item" + (index === state.selectedProfileIndex ? " active" : ""));
        const main = document.createElement("button");
        main.type = "button";
        main.className = "profile-main";
        main.dataset.action = "select-profile";
        main.dataset.profileIndex = String(index);

        const row = el("div", "profile-row");
        row.append(textEl("span", "profile-name", profile.name || profile.id || "Unnamed"));
        row.append(textEl("span", "profile-badge" + (profileHasCa(profile) ? "" : " missing"), profileHasCa(profile) ? "CA 已配置" : "CA 未配置"));
        row.append(textEl("span", "profile-count", String(profile.nodes.length) + " 个节点"));

        const meta = textEl("div", "profile-meta", "ID: " + (profile.id || "missing-id"));
        main.append(row, meta);
        item.append(main, actionButton("复制订阅链接", "copy-profile-url", !profile.subscribeToken.trim(), "icon-only", { profileIndex: index }));
        profileListEl.append(item);
      }

      renderProfilePager(totalPages);
    }

    function renderProfilePager(totalPages) {
      profilePagerEl.replaceChildren();
      if (totalPages <= 0) return;
      profilePagerEl.append(pagerButton("‹", state.profilePage - 1, state.profilePage === 0));
      for (let page = 0; page < totalPages; page += 1) {
        const button = pagerButton(String(page + 1), page, false);
        if (page === state.profilePage) button.classList.add("active");
        profilePagerEl.append(button);
      }
      profilePagerEl.append(pagerButton("›", state.profilePage + 1, state.profilePage >= totalPages - 1));
    }

    function pagerButton(label, page, disabled) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.action = "profile-page";
      button.dataset.page = String(page);
      button.dataset.pageAction = "true";
      button.disabled = state.busy || disabled;
      return button;
    }

    function renderValidation() {
      validationEl.replaceChildren();
      validationEl.className = "validation";
      if (state.errors.length === 0 && state.warnings.length === 0) {
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
      fields.subtitle.textContent = "ID: " + (profile.id || "missing-id");

      if (state.showProfileFields) {
        const account = el("section", "account-card");
        const form = el("div", "card-grid");
        form.append(field("用户 ID", input("text", profile.id, "profile-field", "id", { autocomplete: "off" })));
        form.append(field("显示名称", input("text", profile.name, "profile-field", "name", { autocomplete: "off" })));
        form.append(field("订阅 Token", input("password", profile.subscribeToken, "profile-field", "subscribeToken", { autocomplete: "new-password" })));
        form.append(field("订阅路径", readonlyInput(subscriptionPath(profile)), "full"));
        account.append(form);

        const profileActions = el("div", "button-row");
        profileActions.append(actionButton("复制用户", "duplicate-profile"));
        profileActions.append(actionButton("删除用户", "delete-profile", state.profiles.length <= 1, "danger"));
        account.append(profileActions);
        profileEditorEl.append(account);
      }

      const mitmCard = el("section", "mitm-card");
      const mitmContent = el("div", "");
      const mitmMain = el("div", "mitm-main");
      mitmMain.append(textEl("strong", "", "MitM CA"));
      mitmMain.append(textEl("span", "ca-state " + (profileHasCa(profile) ? "ready" : "missing"), caStatusText(profile.mitm)));
      const mitmForm = el("div", "mitm-fields");
      mitmForm.append(field("启用", checkbox("随订阅输出 MitM CA", profile.mitm.enabled)));
      mitmForm.append(field("解密域名", input("text", profile.mitm.hostname, "mitm-field", "hostname", { autocomplete: "off" })));
      mitmContent.append(mitmMain, mitmForm);
      const mitmActions = el("div", "button-row");
      mitmActions.append(actionButton("重新生成证书", "regenerate-ca", false, "subtle"));
      mitmActions.append(actionButton("复制 CA", "copy-ca", !profile.mitm.caCertificate.trim(), "subtle"));
      mitmCard.append(mitmContent, mitmActions);
      profileEditorEl.append(mitmCard);

      const groupsTitle = el("div", "section-title");
      groupsTitle.append(textEl("span", "", "节点组"));
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
      titleRow.append(textEl("span", "drag-handle", "⋮"));
      const groupInput = document.createElement("input");
      groupInput.value = group.name;
      groupInput.dataset.groupField = "name";
      groupInput.dataset.group = group.name;
      groupInput.setAttribute("list", "known-groups");
      titleRow.append(groupInput);

      const actions = el("div", "top-actions");
      actions.append(actionButton("删除分组", "delete-group", false, "danger icon-only", { group: group.name }));
      heading.append(titleRow, textEl("span", "group-count", String(group.nodes.length) + " 个节点"), actions);
      card.append(heading);

      const nodes = el("div", "node-table");
      const tableHead = el("div", "node-head");
      tableHead.append(textEl("span", "", "节点名称"));
      tableHead.append(textEl("span", "", "节点信息"));
      tableHead.append(textEl("span", "", "操作"));
      nodes.append(tableHead);
      for (const nodeRef of group.nodes) {
        nodes.append(renderNode(nodeRef.node, nodeRef.index));
      }
      card.append(nodes);
      const addRow = el("div", "add-node-row");
      addRow.append(actionButton("添加节点", "add-node", false, "", { group: group.name }));
      card.append(addRow);

      return card;
    }

    function renderNode(node, index) {
      const card = el("div", "node-card");
      card.append(field("节点名", input("text", node.name, "node-field", "name", { nodeIndex: index, autocomplete: "off" })));
      card.append(field("Surge 参数", textarea(node.value, "node-field", "value", { nodeIndex: index })));
      const actions = el("div", "node-actions");
      actions.append(textEl("span", "drag-handle", "⋮"));
      actions.append(actionButton("复制节点", "copy-node", false, "icon-only", { nodeIndex: index }));
      actions.append(actionButton("删除节点", "delete-node", false, "danger icon-only", { nodeIndex: index }));
      card.append(actions);
      return card;
    }

    function refreshDerived() {
      refreshValidation();
      renderSummary();
      renderValidation();
      renderDirtyState();
      updateSaveState();
      updateStaticActionState();
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
        caId: stringValue(mitm.caId),
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
              caId: profile.mitm.caId.trim(),
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
        || mitm.caId.trim()
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
        caId: "",
        caP12: "",
        caPassphrase: "",
        caCertificate: "",
      };
    }

    function caDisplayName(mitm) {
      if (!mitm.caP12) return "未生成";
      return mitm.caId ? "AtlasRouter CA " + mitm.caId : "已生成";
    }

    function caStatusText(mitm) {
      const name = caDisplayName(mitm);
      if (name === "未生成") return "未配置";
      return mitm.enabled ? name + "，自动启用" : name + "，未启用";
    }

    function profileHasCa(profile) {
      return !!profile && !!profile.mitm.caP12.trim();
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

    function updateStaticActionState() {
      const profile = selectedProfile();
      if (fields.copyUrlButton) fields.copyUrlButton.disabled = state.busy || !profile || !profile.subscribeToken.trim();
      if (fields.copyIdButton) fields.copyIdButton.disabled = state.busy || !profile || !profile.id.trim();
      if (fields.editButton) fields.editButton.disabled = state.busy || !profile;
      document.querySelector('[data-action="load"]').disabled = state.busy;
      document.querySelector('[data-action="add-profile"]').disabled = state.busy;
    }

    function setBusy(isBusy) {
      state.busy = isBusy;
      renderAll();
      updateSaveState();
      updateStaticActionState();
    }

    function setStatus(message, tone) {
      statusEl.textContent = message;
      statusEl.className = "status-pill" + (tone ? " " + tone : "");
    }

    function responseErrorMessage(response, text) {
      const title = text.match(/<title>([^<]+)<\\/title>/i);
      if (title) return title[1].replace(/\\s+/g, " ").trim();
      return text || response.statusText || "HTTP " + response.status;
    }

    function isDirty() {
      return state.savedSnapshot !== "" && snapshotConfig() !== state.savedSnapshot;
    }

    function subscriptionPath(profile) {
      if (!profile.subscribeToken.trim()) return "";
      return SUBSCRIPTION_PATH + "?token=" + maskSecret(profile.subscribeToken.trim());
    }

    function subscriptionUrl(profile) {
      const url = new URL(SUBSCRIPTION_PATH, window.location.href);
      url.searchParams.set("token", profile.subscribeToken.trim());
      return url.toString();
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
      button.dataset.action = action;
      if (tone) button.className = tone;
      button.append(textEl("span", "button-label", label));
      if (button.classList.contains("icon-only")) {
        button.title = label;
        button.setAttribute("aria-label", label);
      }
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
