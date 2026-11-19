import { ACCOUNT_PROFILE_PATH, ACCOUNT_TOKEN_PATH, API_PATH, DEV_API_PATH } from "./routes.js";
import { pagePreviewProfile } from "./page-preview.js";

const ICONS = {
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.36 6.36L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.36-6.36L21 8"/><path d="M21 3v5h-5"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
};

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

function page(title, panels, isAdmin, preview = null, development = false) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#ffffff">
  <title>${title} · AtlasRouter</title>
  <style id="page-styles">${styles}</style>
</head>
<body>
<header class="topbar"><div class="wrap topbar-inner">
  <div class="brand"><span class="logo">${icon("route")}</span>AtlasRouter</div>
  <nav class="nav">${isAdmin ? `<a href="#account-panel">我的订阅</a><a href="#pool-panel">节点池管理</a>` : ""}<a class="logout" href="/cdn-cgi/access/logout" aria-label="退出登录">${icon("logout")}<span>退出登录</span></a></nav>
</div></header>
<main class="wrap">
  <div class="page-head"><h1>${title}</h1><p>${isAdmin ? "管理个人订阅、节点池与用户分配。" : "选择客户端并复制专属订阅链接。"}</p></div>
  <aside id="development-notice" class="preview-notice" role="note"${development ? "" : " hidden"}><strong>Dev · 开发环境</strong> · 当前订阅、节点和管理操作均使用独立测试数据。</aside>
  ${preview ? `<aside class="preview-notice" role="note"><strong>页面预览</strong> · ${preview.nodeSource === "database" ? "只读展示当前启用的真实节点，刷新页面获取最新数据。主备顺序仅供预览，不参与分配和统计，操作不保存。" : "模拟数据仅保留在当前页面内存中，刷新即重置，不保存账号、节点或操作记录。"}</aside>` : ""}
  ${panels.map(({ id, body }) => `<div id="${id}" class="panel">${body}</div>`).join("\n")}
</main>${panels.map(({ id, script, previewData }) => `<script>(() => { const root = document.getElementById("${id}"); const previewData = ${JSON.stringify(previewData ?? null).replaceAll("<", "\\u003c")}; ${clientHelpers}${script} })();</script>`).join("\n")}</body>
</html>`;
}

const styles = `
    :root {
      color-scheme: light;
      --bg: #f6f7fb; --surface: #fff; --subtle: #f9fafb; --hover: #f4f5f9; --line: #e6e8ef; --line-strong: #d4d8e1;
      --text: #0f172a; --text-2: #334155; --muted: #64748b; --faint: #94a3b8;
      --brand: #4f46e5; --brand-hover: #4338ca; --brand-soft: #eef2ff; --brand-ink: #3730a3; --ring: rgba(79, 70, 229, .18);
      --ok: #047857; --ok-soft: #ecfdf5; --warn: #b45309; --warn-soft: #fffbeb; --danger: #dc2626; --danger-soft: #fef2f2;
      --shadow: 0 1px 2px rgba(16, 24, 40, .04), 0 2px 8px -2px rgba(16, 24, 40, .05);
      --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji";
      color: var(--text); background: var(--bg);
    }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    html { scroll-behavior: smooth; }
    body { margin: 0; min-height: 100vh; font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; background: radial-gradient(1200px 420px at 50% -200px, rgba(99, 102, 241, .14), transparent 70%) no-repeat; }
    h1, h2, h3, p { margin: 0; }
    a { color: inherit; text-decoration: none; }
    :focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
    .icon { flex: none; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .wrap { max-width: 1120px; margin-left: auto; margin-right: auto; padding-left: 24px; padding-right: 24px; }

    .topbar { position: sticky; top: 0; z-index: 10; border-bottom: 1px solid var(--line); background: rgba(255, 255, 255, .82); -webkit-backdrop-filter: saturate(180%) blur(12px); backdrop-filter: saturate(180%) blur(12px); }
    .topbar-inner { display: flex; align-items: center; justify-content: space-between; gap: 16px; height: 60px; }
    .brand { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 700; letter-spacing: -.01em; }
    .logo { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: linear-gradient(135deg, #6366f1, #06b6d4); color: #fff; box-shadow: 0 4px 12px -4px rgba(79, 70, 229, .6), inset 0 1px 0 rgba(255, 255, 255, .3); }
    .logo .icon { width: 16px; height: 16px; stroke-width: 2.25; }
    .nav { display: flex; align-items: center; gap: 2px; }
    .nav a { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border-radius: 8px; color: var(--muted); font-weight: 500; white-space: nowrap; transition: background-color .15s, color .15s; }
    .nav a:hover { background: var(--hover); color: var(--text); }
    .nav .logout { margin-left: 8px; border: 1px solid var(--line); color: var(--text-2); }
    main { padding-top: 36px; padding-bottom: 72px; }
    .page-head { margin-bottom: 24px; }
    .page-head h1 { font-size: 26px; line-height: 1.25; letter-spacing: -.02em; }
    .page-head p { margin-top: 6px; color: var(--muted); font-size: 15px; }
    .panel { scroll-margin-top: 84px; }
    .preview-notice { margin-bottom: 20px; padding: 12px 16px; border: 1px solid #fde68a; border-radius: 12px; background: var(--warn-soft); color: #92400e; font-size: 13px; line-height: 1.6; }

    .card { overflow: hidden; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); box-shadow: var(--shadow); }
    .card + .card { margin-top: 20px; }
    .card-head { padding: 20px 24px 16px; }
    .card-head h2, .card-head h3 { font-size: 15px; font-weight: 600; line-height: 1.4; }
    .card-head p { margin-top: 3px; color: var(--muted); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
    .card-head.split { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .card-head.split > button { flex: none; margin: -3px -10px 0 0; }
    .card-body { padding: 0 24px 24px; }
    .card-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px; padding: 12px 24px; border-top: 1px solid var(--line); background: var(--subtle); }
    .account-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; align-items: start; }
    .account-main { display: grid; gap: 20px; min-width: 0; }
    .account-grid .card + .card { margin-top: 0; }
    .link-card .card-body { padding-bottom: 20px; }

    input, select, textarea { width: 100%; padding: 8px 12px; border: 1px solid var(--line-strong); border-radius: 9px; background: var(--surface); color: var(--text); font: inherit; transition: border-color .15s, box-shadow .15s; }
    input, select { height: 36px; padding-top: 0; padding-bottom: 0; }
    textarea { display: block; padding: 10px 12px; resize: vertical; font: 13px/1.6 var(--mono); }
    input:focus, select:focus, textarea:focus { outline: 0; border-color: var(--brand); box-shadow: 0 0 0 3px var(--ring); }
    ::placeholder { color: var(--faint); }
    select { padding-right: 34px; background: linear-gradient(45deg, transparent 50%, var(--muted) 50%) calc(100% - 18px) 50% / 5px 5px no-repeat, linear-gradient(135deg, var(--muted) 50%, transparent 50%) calc(100% - 13px) 50% / 5px 5px no-repeat, var(--surface); -webkit-appearance: none; appearance: none; cursor: pointer; }
    input[type="checkbox"] { flex: none; width: 40px; height: 22px; margin: 0; padding: 0; border: 0; border-radius: 999px; background: #d4d9e2 radial-gradient(circle closest-side, #fff 88%, rgba(255, 255, 255, 0) 96%) 2px 50% / 18px 18px no-repeat; -webkit-appearance: none; appearance: none; cursor: pointer; transition: background-color .2s, background-position .2s; }
    input[type="checkbox"]:checked { background-color: var(--brand); background-position: 20px 50%; }
    input[type="checkbox"]:disabled { opacity: .45; cursor: not-allowed; }
    input[type="checkbox"]:focus { box-shadow: none; }
    input[type="checkbox"]:focus-visible { box-shadow: 0 0 0 3px var(--ring); }
    button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 36px; padding: 0 14px; border: 1px solid transparent; border-radius: 9px; background: var(--brand); color: #fff; font: inherit; font-weight: 600; white-space: nowrap; cursor: pointer; box-shadow: 0 1px 2px rgba(16, 24, 40, .08), inset 0 1px 0 rgba(255, 255, 255, .12); transition: background-color .15s, border-color .15s, color .15s; }
    button:hover:not(:disabled) { background: var(--brand-hover); }
    button.secondary { border-color: var(--line-strong); background: var(--surface); color: var(--text-2); box-shadow: 0 1px 2px rgba(16, 24, 40, .04); }
    button.secondary:hover:not(:disabled) { border-color: #c4cad6; background: var(--subtle); color: var(--text); }
    button.tonal { background: var(--brand-soft); color: var(--brand-ink); box-shadow: none; }
    button.tonal:hover:not(:disabled) { background: #e0e7ff; }
    button.danger { border-color: #fecaca; background: var(--surface); color: var(--danger); box-shadow: 0 1px 2px rgba(16, 24, 40, .04); }
    button.danger:hover:not(:disabled) { border-color: #fca5a5; background: var(--danger-soft); }
    button.ghost { border-color: transparent; background: transparent; color: var(--muted); box-shadow: none; }
    button.ghost:hover:not(:disabled) { background: var(--hover); color: var(--text); }
    button.ghost.danger:hover:not(:disabled) { background: var(--danger-soft); color: var(--danger); }
    button.small { height: 30px; padding: 0 10px; border-radius: 8px; font-size: 13px; }
    button:disabled { opacity: .5; cursor: not-allowed; box-shadow: none; }
    button.icon-only { width: 30px; padding: 0; }
    .chevron::after { content: ""; flex: none; width: 6px; height: 6px; margin-top: -3px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(45deg); transition: transform .15s, margin-top .15s; }
    .chevron.open::after { margin-top: 3px; transform: rotate(-135deg); }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; }

    .settings { border-top: 1px solid var(--line); }
    .setting { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 16px 24px; transition: background-color .15s; }
    .setting + .setting { border-top: 1px solid var(--line); }
    label.setting { cursor: pointer; }
    label.setting:hover { background: var(--subtle); }
    label.setting:has(:disabled) { background: none; cursor: not-allowed; }
    label.setting:has(:disabled) .setting-text > :first-child { color: var(--muted); }
    .setting-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .setting-text > :first-child { color: var(--text); font-weight: 600; }
    .setting-text > :last-child { color: var(--muted); font-size: 13px; line-height: 1.6; }
    .setting select { flex: none; width: auto; min-width: 168px; }
    .field-label { display: block; margin: 0 0 8px; color: var(--text-2); font-size: 13px; font-weight: 600; }
    .link-field { display: flex; gap: 10px; }
    .link-field input { flex: 1; min-width: 0; height: 44px; padding: 0 14px; background: var(--subtle); font: 13px var(--mono); text-overflow: ellipsis; }
    .link-field button { height: 44px; padding: 0 20px; }
    .status { display: flex; align-items: flex-start; gap: 8px; margin-top: 12px; color: var(--muted); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
    .status::before { content: ""; flex: none; width: 7px; height: 7px; margin-top: 7px; border-radius: 50%; background: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
    .status.error { color: var(--danger); }
    .status.error::before { background: var(--danger); box-shadow: 0 0 0 3px var(--danger-soft); }
    .card-foot .status { flex: 1 1 280px; margin: 0; }
    .hint { margin-top: 8px; color: var(--muted); font-size: 13px; line-height: 1.6; }
    .note { display: flex; flex: 1 1 280px; align-items: flex-start; gap: 8px; color: var(--muted); font-size: 13px; line-height: 1.6; }
    .note .icon { margin-top: 2px; color: var(--faint); }
    code { padding: 1px 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--subtle); color: var(--text-2); font: 12px var(--mono); overflow-wrap: anywhere; }

    .groups > .group { display: grid; grid-template-columns: 7.5em minmax(0, 1fr) 30px; align-items: start; column-gap: 12px; padding: 12px 24px; border-top: 1px solid var(--line); }
    .group-title { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; padding-top: 5px; }
    .group-name { font-weight: 600; overflow-wrap: anywhere; }
    .group-title .muted { font-size: 12px; }
    .group > .muted { padding-top: 5px; font-size: 13px; }
    .chain { margin: 0; padding: 0; list-style: none; }
    .group:not(.open) .chain li + li, .group:not(.open) .chain li::after { display: none; }
    .chain li { position: relative; display: flex; align-items: center; gap: 10px; min-height: 32px; padding-left: 24px; }
    .chain li::before { content: ""; position: absolute; z-index: 1; top: 50%; left: 4px; width: 10px; height: 10px; margin-top: -5px; border: 2px solid var(--line-strong); border-radius: 50%; background: var(--surface); }
    .chain li:not(:last-child)::after { content: ""; position: absolute; top: 50%; left: 8px; width: 2px; height: 100%; background: var(--line); }
    .chain li.primary::before { border-color: var(--brand); background: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
    .step { flex: none; width: 48px; color: var(--faint); font-size: 12px; }
    .primary .step { padding: 0 6px; border-radius: 999px; background: var(--brand-soft); color: var(--brand-ink); font-weight: 600; text-align: center; }
    .primary .node-name { font-weight: 600; }
    .node-name { min-width: 0; overflow-wrap: anywhere; }
    .empty { padding: 32px 24px; color: var(--muted); text-align: center; }
    .groups > .empty { display: block; border-top: 1px solid var(--line); }

    .section-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px 24px; margin: 48px 0 16px; }
    .section-head h2 { font-size: 20px; letter-spacing: -.01em; }
    .section-head p { margin-top: 4px; color: var(--muted); }
    .metrics { display: flex; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); box-shadow: var(--shadow); }
    .metric { min-width: 104px; padding: 8px 18px; }
    .metric + .metric { border-left: 1px solid var(--line); }
    .metric span { display: block; color: var(--muted); font-size: 12px; }
    .metric strong { display: block; font-size: 20px; line-height: 1.4; font-variant-numeric: tabular-nums; }
    .card-body > .actions { margin-top: 16px; }
    .notes { margin: 16px 0 0; padding: 12px 16px 12px 34px; border: 1px solid #fde68a; border-radius: 12px; background: var(--warn-soft); color: #92400e; font-size: 13px; line-height: 1.7; }
    .notes:empty { display: none; }
    .editor { margin-top: 16px; border: 1px solid var(--line); border-radius: 12px; }
    .editor > summary { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-radius: 12px; color: var(--text-2); font-weight: 600; list-style: none; cursor: pointer; }
    .editor > summary:hover { background: var(--subtle); }
    .editor > summary::-webkit-details-marker { display: none; }
    .editor > summary::before { content: ""; width: 6px; height: 6px; border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted); transform: rotate(-45deg); transition: transform .15s; }
    .editor[open] > summary::before { transform: rotate(45deg); }
    .editor-body { padding: 0 16px 16px; }
    .editor-body .hint { margin: 0; }
    .editor-body .field-label { margin-top: 12px; }

    .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; padding: 0 24px 16px; }
    .search { position: relative; flex: 1 1 260px; min-width: 0; }
    .search .icon { position: absolute; top: 50%; left: 12px; margin-top: -8px; color: var(--faint); pointer-events: none; }
    .search input { padding-left: 36px; -webkit-appearance: none; appearance: none; }
    .toolbar select { flex: none; width: auto; min-width: 120px; }
    .toolbar-note { color: var(--muted); font-size: 13px; }
    .toolbar > button { margin-left: auto; }

    .table-wrap { overflow-x: auto; border-top: 1px solid var(--line); }
    table { width: 100%; min-width: 760px; border-collapse: collapse; }
    th { padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--subtle); color: var(--muted); font-size: 12px; font-weight: 500; text-align: left; white-space: nowrap; }
    td { padding: 14px 16px; border-bottom: 1px solid var(--line); vertical-align: top; }
    tbody tr:last-child td { border-bottom: 0; }
    tbody tr:hover td { background: #fafbff; }
    th:first-child, td:first-child { padding-left: 24px; }
    th:last-child, td:last-child { padding-right: 24px; }
    .end { text-align: right; }
    .user-table .badge { margin-top: 5px; }
    .node-table td:first-child { min-width: 220px; }
    .node-table .node-row td:first-child { padding-left: 42px; }
    .node-table .group-row td { padding: 0; background: var(--subtle); }
    .node-table tbody .group-row:hover td { background: var(--hover); }
    .group-toggle { width: 100%; height: auto; min-height: 46px; justify-content: flex-start; flex-wrap: wrap; gap: 4px 10px; padding: 10px 24px; border: 0; border-radius: 0; background: none; color: var(--text-2); font-weight: 500; text-align: left; white-space: normal; box-shadow: none; }
    .group-toggle:hover:not(:disabled) { background: none; }
    .group-toggle:disabled { opacity: 1; cursor: default; }
    .group-toggle.chevron::after { order: -1; margin-right: 2px; }
    .group-toggle .muted { font-size: 13px; font-weight: 400; }
    button.more { height: 22px; margin: 0 6px 6px 0; padding: 0 8px; border-radius: 999px; color: var(--brand); font-size: 12px; vertical-align: top; }
    .assignment { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-height: 30px; }
    .assignment .pending { color: var(--warn); font-size: 13px; }
    .assignment + .orders { margin-top: 10px; }
    td .node-name { display: block; font-weight: 600; }
    td summary { display: inline-flex; align-items: center; gap: 6px; margin-top: 2px; color: var(--brand); font-size: 12px; font-weight: 500; list-style: none; cursor: pointer; }
    td summary::-webkit-details-marker { display: none; }
    td summary::after { content: ""; width: 5px; height: 5px; margin-top: -3px; border-right: 1.5px solid; border-bottom: 1.5px solid; transform: rotate(45deg); transition: transform .15s; }
    td details[open] summary::after { margin-top: 3px; transform: rotate(-135deg); }
    pre { max-width: 440px; margin: 8px 0 0; padding: 10px 12px; border-radius: 10px; background: #0f172a; color: #e2e8f0; font: 12px/1.6 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 999px; background: #f1f5f9; color: #475569; font-size: 12px; font-weight: 600; line-height: 1.6; white-space: nowrap; }
    .badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .badge.ok { background: var(--ok-soft); color: var(--ok); }
    .badge.warn { background: var(--warn-soft); color: var(--warn); }
    .chip { display: inline-block; padding: 1px 8px; border-radius: 6px; background: var(--brand-soft); color: var(--brand-ink); font-size: 12px; font-weight: 600; line-height: 1.6; white-space: nowrap; }
    .owner { display: inline-block; max-width: 100%; margin: 0 6px 6px 0; padding: 1px 8px; overflow: hidden; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--text-2); font-size: 12px; line-height: 1.6; text-overflow: ellipsis; white-space: nowrap; vertical-align: top; }
    .muted { color: var(--muted); }
    .count { display: block; font-weight: 600; }
    .count + .muted { font-size: 12px; }
    .person { display: flex; align-items: center; gap: 10px; font-weight: 500; white-space: nowrap; }
    .avatar { display: grid; flex: none; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg, #e0e7ff, #cffafe); color: var(--brand-ink); font-size: 12px; font-weight: 700; }
    .orders { display: grid; grid-template-columns: minmax(100px, max-content) minmax(0, 1fr); align-items: center; gap: 6px 10px; }
    .orders > * { justify-self: start; }
    .hops { display: flex; flex-wrap: wrap; column-gap: 6px; }
    .hops > span { white-space: nowrap; }
    .hops > :first-child { font-weight: 600; }

    @media (max-width: 960px) { .account-grid { grid-template-columns: minmax(0, 1fr); } }
    @media (max-width: 640px) {
      .wrap { padding-left: 16px; padding-right: 16px; }
      .topbar-inner { gap: 8px; height: 56px; }
      .nav a { padding: 0 8px; font-size: 13px; }
      .nav a + .logout { width: 34px; padding: 0; justify-content: center; }
      .nav a + .logout span { display: none; }
      main { padding-top: 24px; }
      .page-head h1 { font-size: 22px; }
      .page-head p { font-size: 14px; }
      .card-head { padding: 16px 16px 12px; }
      .card-body { padding: 0 16px 16px; }
      .card-foot, .setting, .groups > .group, .toolbar { padding-left: 16px; padding-right: 16px; }
      th:first-child, td:first-child { padding-left: 16px; }
      .card-head.split > button { margin-right: -6px; }
      .groups > .group { grid-template-columns: minmax(0, 1fr) 30px; row-gap: 2px; }
      .group-title { flex-direction: row; flex-wrap: wrap; align-items: baseline; column-gap: 8px; }
      .group > .chain, .group > .muted { grid-row: 2; grid-column: 1 / -1; }
      .group-toggle { padding-left: 16px; padding-right: 16px; }
      .node-table .node-row td:first-child { padding-left: 34px; }
      .search { flex-basis: 100%; }
      .setting:not(label) { flex-direction: column; align-items: stretch; gap: 10px; }
      .setting select { width: 100%; }
      .link-field { flex-wrap: wrap; }
      .link-field input { flex-basis: 100%; }
      .link-field button, .card-foot > button, .card-foot .actions button { flex: 1; }
      .card-foot > button, .card-foot .actions { width: 100%; }
      .section-head { margin-top: 36px; }
      .metrics { width: 100%; }
      .metric { flex: 1; min-width: 0; padding: 8px 14px; }
      input, select, textarea, .link-field input { font-size: 16px; }
    }
`;

const clientHelpers = String.raw`
  const pageState = document.atlasrouterEnvironment ??= {
    development: !previewData && new URL(location.href).searchParams.get("environment") === "development",
    pending: 0, changing: false, panels: [], cleanup: [],
  };
  const status = root.querySelector(".status");
  function message(text, error = false) {
    status.textContent = text;
    status.className = error ? "status error" : "status";
  }
  async function api(path, method = "GET", body) {
    if (previewData) {
      if (path === ${JSON.stringify(ACCOUNT_PROFILE_PATH)} && method === "GET") return previewData;
      if (path === ${JSON.stringify(ACCOUNT_TOKEN_PATH)} && method === "POST") {
        previewData.subscriptionUrl = "https://preview.invalid/AtlasRouter?token=preview-" + crypto.randomUUID();
        return previewData;
      }
      throw new Error("页面预览不调用正式数据接口。");
    }
    if (pageState.changing) throw new Error("正在切换环境，请稍候。");
    const url = new URL(path, location.href);
    if (pageState.development) url.pathname = ${JSON.stringify(DEV_API_PATH)} + url.pathname.slice(${API_PATH.length});
    pageState.pending += 1;
    try {
      const response = await fetch(url.pathname + url.search, {
        method, credentials: "same-origin", cache: "no-store",
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await response.text());
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("登录已失效，请刷新页面重新登录。");
      }
      return await response.json();
    } finally {
      pageState.pending -= 1;
    }
  }
  function element(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function cell(row, text) { const node = element("td", text); row.append(node); return node; }
  function span(text, className) {
    const node = element("span", text);
    if (className) node.className = className;
    return node;
  }
`;

export function renderAccountPage({ isAdmin = false, adminRoutes = null, preview = false, previewProfile = null,
  development = false, developmentAvailable = false } = {}) {
  if (preview) isAdmin = false;
  const previewData = preview ? previewProfile ?? pagePreviewProfile() : null;
  const panels = [accountPanel(previewData, { development, developmentAvailable: !preview && developmentAvailable })];
  if (isAdmin) panels.push(poolPanel(adminRoutes));
  return page(preview ? "页面预览" : isAdmin ? "管理控制台" : "我的订阅", panels, isAdmin, previewData, !preview && development);
}

function accountPanel(preview, { development, developmentAvailable }) {
  const linkTitle = preview ? "示例订阅链接" : "专属订阅链接";
  return { id: "account-panel", previewData: preview, body: `
  <div class="account-grid">
    <div class="account-main">
      <article class="card">
        <header class="card-head"><h2>自定义选项</h2><p>修改选项后，请复制新的订阅链接到客户端。</p></header>
        <div class="settings">
          <div class="setting">
            <div class="setting-text"><label for="subscription-client">Client</label><p id="client-help">在 Surge 中通过 URL 安装配置。</p></div>
            <select id="subscription-client"><option value="surge" selected>Surge（默认）</option><option value="clash">Clash</option></select>
          </div>
          <label class="setting" for="enable-doh">
            <span class="setting-text"><span>启用 DoH</span><span>加密 DNS 查询，降低窃听和篡改风险；可能增加解析延迟。</span></span>
            <input id="enable-doh" type="checkbox" role="switch" checked>
          </label>
          <label class="setting" for="enable-vless">
            <span class="setting-text"><span>包含 VLESS 节点</span><span>比 VMess 更快、更难被识别和封锁：少了一层重复加密，REALITY 让流量看起来像在访问普通网站。Surge 6 及以上版本才支持（iOS 6.0.0+ / Mac 6.12.0+）。</span></span>
            <input id="enable-vless" type="checkbox" role="switch">
          </label>
          <label class="setting" for="enable-wifi-assist">
            <span class="setting-text"><span>Wi-Fi Assist</span><span id="wifi-assist-help">Wi-Fi 网络不佳时，Surge iOS 同时通过蜂窝网络并行请求，会消耗更多移动数据流量。</span></span>
            <input id="enable-wifi-assist" type="checkbox" role="switch" aria-describedby="wifi-assist-help">
          </label>
          <label class="setting" for="enable-tencent-oa">
            <span class="setting-text"><span>Tencent OA Compatibility</span><span id="tencent-oa-help">腾讯公司内网用：Surge Mac 仅开启系统代理、关闭增强模式时使用；iOA 需设置为全局模式。</span></span>
            <input id="enable-tencent-oa" type="checkbox" role="switch" aria-describedby="tencent-oa-help">
          </label>
          ${developmentAvailable ? `<label class="setting" for="enable-dev">
            <span class="setting-text"><span>Dev</span><span>原地加载开发版界面，使用独立测试节点和配置。切换后请更新客户端中的订阅链接。</span></span>
            <input id="enable-dev" type="checkbox" role="switch"${development ? " checked" : ""}>
          </label>` : ""}
        </div>
      </article>
      <article class="card link-card">
        <header class="card-head"><h2>${linkTitle}</h2><p id="identity">正在验证登录账号…</p></header>
        <div class="card-body">
          <div class="link-field">
            <input id="subscription" readonly autocomplete="off" spellcheck="false" placeholder="登录验证后显示" aria-label="${linkTitle}">
            <button id="copy" disabled>${icon("copy")}复制链接</button>
          </div>
          <p class="status" role="status" aria-live="polite">正在加载…</p>
        </div>
        <footer class="card-foot">
          <p class="note">${icon("lock")}${preview ? "示例链接仅用于页面测试，无法用于代理连接。复制和重置只操作当前页面中的示例链接。" : "链接包含个人访问凭据，请妥善保管；重置后需要在所有设备上更新。"}</p>
          <button id="rotate" class="danger small" disabled>${icon("key")}重置订阅链接</button>
        </footer>
      </article>
    </div>
    <article class="card">
      <header class="card-head split">
        <div><h2>${preview?.nodeSource === "database" ? "节点池预览" : "我的节点与备份顺序"}</h2><p>${preview?.nodeSource === "database" ? "当前启用节点；主备顺序仅用于页面展示。" : "每组首个为主节点，其余为备份；展开分组查看完整顺序。"}</p></div>
        <button id="groups-toggle" class="ghost small" hidden>全部展开</button>
      </header>
      <div id="groups" class="groups"><span class="empty">正在加载…</span></div>
    </article>
  </div>`, script: String.raw`
    const subscription = root.querySelector("#subscription");
    const copy = root.querySelector("#copy");
    const rotate = root.querySelector("#rotate");
    const client = root.querySelector("#subscription-client");
    const doh = root.querySelector("#enable-doh");
    const vless = root.querySelector("#enable-vless");
    const tencentOa = root.querySelector("#enable-tencent-oa");
    const wifiAssist = root.querySelector("#enable-wifi-assist");
    const development = root.querySelector("#enable-dev");
    const groupsToggle = root.querySelector("#groups-toggle");
    const openGroups = new Set();
    let collapsible = [];
    let baseSubscriptionUrl;
    if (!previewData) {
      const params = new URL(location.href).searchParams;
      if (["surge", "clash"].includes(params.get("client"))) client.value = params.get("client");
      doh.checked = params.get("doh") !== "0";
      vless.checked = params.get("vless") === "1";
      tencentOa.checked = params.get("tencent_oa") === "1";
      wifiAssist.checked = params.get("wifi_assist") === "1";
    }
    function updateSubscription() {
      root.querySelector("#client-help").textContent = client.value === "clash"
        ? "在使用 Mihomo（Clash Meta）内核的客户端中添加订阅。不兼容的 Surge 配置项会被跳过。"
        : "在 Surge 中通过 URL 安装配置。";
      root.querySelector("#wifi-assist-help").textContent = client.value === "clash"
        ? "需要支持 network-strategy 的 ProjectClash；默认网络连接不佳时同时通过蜂窝网络并行请求，会消耗更多移动数据流量。"
        : "Wi-Fi 网络不佳时，Surge iOS 同时通过蜂窝网络并行请求，会消耗更多移动数据流量。";
      tencentOa.disabled = client.value !== "surge";
      root.querySelector("#tencent-oa-help").textContent = tencentOa.disabled
        ? "仅适用于 Surge；切回 Surge 后可启用腾讯公司内网兼容。"
        : "腾讯公司内网用：Surge Mac 仅开启系统代理、关闭增强模式时使用；iOA 需设置为全局模式。";
      if (!baseSubscriptionUrl) return;
      const url = new URL(baseSubscriptionUrl);
      url.searchParams.delete("client");
      url.searchParams.delete("doh");
      url.searchParams.delete("tencent_oa");
      url.searchParams.delete("wifi_assist");
      url.searchParams.delete("vless");
      if (client.value === "clash") url.searchParams.set("client", "clash");
      if (!doh.checked) url.searchParams.set("doh", "0");
      if (tencentOa.checked && !tencentOa.disabled) url.searchParams.set("tencent_oa", "1");
      if (wifiAssist.checked) url.searchParams.set("wifi_assist", "1");
      if (vless.checked) url.searchParams.set("vless", "1");
      subscription.value = url.toString();
    }
    client.onchange = updateSubscription;
    doh.onchange = updateSubscription;
    vless.onchange = updateSubscription;
    tencentOa.onchange = updateSubscription;
    wifiAssist.onchange = updateSubscription;
    if (development) development.onchange = async () => {
      const previous = pageState.development;
      const selected = development.checked;
      if (pageState.changing || pageState.pending) {
        development.checked = previous;
        message("请等待当前操作完成后再切换环境。", true);
        return;
      }
      if (selected === previous) return;
      if (pageState.panels.some((panel) => panel.canSwitch && !panel.canSwitch())) {
        development.checked = previous;
        return;
      }
      pageState.changing = true;
      development.disabled = true;
      pageState.panels.forEach((panel) => panel.lock(true));
      message("正在加载" + (selected ? "开发" : "正式") + "环境…");
      try {
        const url = new URL(location.href);
        url.searchParams.delete("dev");
        url.searchParams.delete("environment");
        url.searchParams.delete("client");
        url.searchParams.delete("doh");
        url.searchParams.delete("tencent_oa");
        url.searchParams.delete("wifi_assist");
        url.searchParams.delete("vless");
        if (selected) url.searchParams.set("environment", "development");
        if (client.value === "clash") url.searchParams.set("client", "clash");
        if (!doh.checked) url.searchParams.set("doh", "0");
        if (tencentOa.checked) url.searchParams.set("tencent_oa", "1");
        if (wifiAssist.checked) url.searchParams.set("wifi_assist", "1");
        if (vless.checked) url.searchParams.set("vless", "1");
        const response = await fetch(url.pathname + url.search, {
          credentials: "same-origin", cache: "no-store", redirect: "error",
        });
        if (!response.ok) throw new Error(await response.text());
        const expected = selected ? "development" : "production";
        if (!response.headers.get("content-type")?.includes("text/html")
          || response.headers.get("x-atlasrouter-page-environment") !== expected) {
          throw new Error("登录已失效或页面版本不可用，请刷新页面后重试。");
        }
        const next = new DOMParser().parseFromString(await response.text(), "text/html");
        const nextStyles = next.getElementById("page-styles");
        const scripts = [...next.querySelectorAll("script")];
        if (!nextStyles || !next.getElementById("account-panel") || !scripts.length) {
          throw new Error("页面内容不完整，请稍后重试。");
        }
        scripts.forEach((script) => script.remove());
        pageState.cleanup.forEach((cleanup) => cleanup());
        delete document.atlasrouterEnvironment;
        history.replaceState(null, "", url);
        document.title = next.title;
        document.getElementById("page-styles").replaceWith(nextStyles);
        document.body.replaceChildren(...next.body.childNodes);
        for (const source of scripts) {
          const script = document.createElement("script");
          for (const attribute of source.attributes) script.setAttribute(attribute.name, attribute.value);
          script.async = false;
          script.textContent = source.textContent;
          document.body.append(script);
        }
        document.getElementById("enable-dev")?.focus({ preventScroll: true });
      } catch (error) {
        development.checked = previous;
        message("切换失败，仍使用" + (previous ? "开发" : "正式") + "环境：" + error.message, true);
        pageState.changing = false;
        development.disabled = false;
        pageState.panels.forEach((panel) => panel.lock(false));
      }
    };
    function showGroups() {
      for (const { name, entry, toggle, backups } of collapsible) {
        const open = openGroups.has(name);
        entry.className = open ? "group open" : "group";
        toggle.className = open ? "ghost small icon-only chevron open" : "ghost small icon-only chevron";
        toggle.title = (open ? "收起 " : "展开 ") + name + " 的 " + backups + " 个备份节点";
        toggle.ariaExpanded = String(open);
      }
      groupsToggle.hidden = !collapsible.length;
      groupsToggle.textContent = collapsible.every(({ name }) => openGroups.has(name)) ? "全部收起" : "全部展开";
    }
    groupsToggle.onclick = () => {
      const allOpen = collapsible.every(({ name }) => openGroups.has(name));
      for (const { name } of collapsible) {
        if (allOpen) openGroups.delete(name);
        else openGroups.add(name);
      }
      showGroups();
    };
    function render(profile) {
      root.querySelector("#identity").textContent = profile.email;
      baseSubscriptionUrl = profile.subscriptionUrl;
      updateSubscription();
      copy.disabled = false;
      rotate.disabled = false;
      const groups = root.querySelector("#groups");
      groups.replaceChildren();
      collapsible = [];
      for (const group of profile.groups) {
        const entry = element("div");
        entry.className = "group";
        const title = element("div");
        title.className = "group-title";
        title.append(span(group.group, "group-name"), group.primaryId ? span(group.nodes.length + " 个节点", "muted") : span("待分配", "badge warn"));
        entry.append(title);
        if (group.primaryId) {
          const chain = element("ol");
          chain.className = "chain";
          group.nodes.forEach((node, index) => {
            const item = element("li");
            if (!index) item.className = "primary";
            item.append(span(index ? "备份 " + index : "主节点", "step"), span(node.name, "node-name"));
            chain.append(item);
          });
          entry.append(chain);
          if (group.nodes.length > 1) {
            const toggle = element("button");
            toggle.onclick = () => {
              if (!openGroups.delete(group.group)) openGroups.add(group.group);
              showGroups();
            };
            entry.append(toggle);
            collapsible.push({ name: group.group, entry, toggle, backups: group.nodes.length - 1 });
          }
        } else entry.append(span("该组暂无启用节点", "muted"));
        groups.append(entry);
      }
      if (!profile.groups.length) groups.append(span(previewData?.nodeSource === "database" ? "当前没有启用节点。" : "等待管理员录入节点。", "empty"));
      showGroups();
      message(previewData ? (previewData.nodeSource === "database" ? "已加载当前启用的真实节点。主备顺序仅供预览，不参与分配和统计。" : "当前为页面预览：所有节点均为模拟数据，操作不会保存。")
        : profile.status === "active" ? "配置已就绪。每组第一个节点为你的主节点，其余为公共备份；节点不足时主节点会共享。"
        : profile.status === "partial" ? "部分节点组待分配，订阅已包含可用的节点组。"
        : "正在等待管理员启用节点。链接已生成，完成分配后即可订阅。");
    }
    async function load() {
      try { render(await api(${JSON.stringify(ACCOUNT_PROFILE_PATH)})); }
      catch (error) { message(error.message, true); }
    }
    if (!previewData) pageState.panels.push({
      lock: (locked) => {
        copy.disabled = rotate.disabled = locked || !baseSubscriptionUrl;
        client.disabled = doh.disabled = vless.disabled = wifiAssist.disabled = locked;
        tencentOa.disabled = locked || client.value !== "surge";
      },
    });
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(subscription.value); message(previewData ? "示例链接已复制。" : "订阅链接已复制。"); }
      catch { subscription.focus(); subscription.select(); message("请手动复制已选中的链接。"); }
    };
    rotate.onclick = async () => {
      if (!confirm(previewData ? "仅重置当前页面中的示例链接，继续？" : "重置后旧订阅链接立即失效，继续？")) return;
      rotate.disabled = true;
      try { render(await api(${JSON.stringify(ACCOUNT_TOKEN_PATH)}, "POST", {})); message(previewData ? "示例链接已重置，刷新页面后恢复初始数据。" : "已生成新的订阅链接，请更新所有设备。"); }
      catch (error) { message(error.message, true); }
      finally { rotate.disabled = false; }
    };
    if (!previewData) {
      document.addEventListener("atlasrouter:inventory", load);
      pageState.cleanup.push(() => document.removeEventListener("atlasrouter:inventory", load));
    }
    load();
  ` };
}

function poolPanel(adminRoutes) {
  return { id: "pool-panel", body: `
  <div class="section-head">
    <div><h2>节点池管理</h2><p>录入并保存节点后，系统按地区和 IP 类型为每位用户分配主节点与备份顺序。</p></div>
    <div id="counts" class="metrics">
      <div class="metric"><span>启用节点</span><strong>–</strong></div>
      <div class="metric"><span>空闲节点</span><strong>–</strong></div>
      <div class="metric"><span>用户</span><strong>–</strong></div>
    </div>
  </div>
  <article class="card">
    <header class="card-head"><h3>录入节点</h3><p>可整段粘贴 3x-ui 导出的订阅清单，也可逐行粘贴 HTTPS 订阅链接、vmess://、vless://、hy2://、hysteria2:// 链接或完整 Surge 节点。VLESS 链接支持 TCP + REALITY + Vision。每批最多 20 个不同的订阅链接，重复连接会自动跳过。</p></header>
    <div class="card-body">
      <label class="field-label" for="import">节点链接或 Surge 节点清单</label>
      <textarea id="import" rows="5" spellcheck="false" autocomplete="off" placeholder="ISP-1&#9;https://subscription.example.com/isp-1"></textarea>
      <p class="hint">导入时把类型关键词前的横杠换成空格；客户端名带出口国家代码的中转节点改用出口国家命名，例如 <code>🇭🇰 HK-Hy2-ISP-AU</code> → <code>🇦🇺 AU-Hy2 ISP</code>，无法识别的代码会弹窗请你填写。节点按地区旗帜和 IDC / ISP / WARP 关键词分组，可用 <code>节点名 = 链接</code> 指定名称。替换以本次导入为准：连接相同的已有节点保留 ID 和启停状态，其余已有节点移除。</p>
      <div class="actions"><button id="append" class="tonal" disabled>${icon("plus")}转换并追加到待保存清单</button><button id="replace" class="secondary" disabled>${icon("repeat")}转换并替换已有节点</button></div>
      <ul id="import-notes" class="notes" aria-live="polite"></ul>
      <details class="editor"><summary>编辑完整清单 / 停用或移除节点</summary>
        <div class="editor-body">
          <p class="hint">编辑已有节点时保留 id，可维持归属与顺序。将 enabled 改为 false 可停用并保留历史。删除记录会移除该连接，用户重新分配到剩余启用节点。同一节点的另一协议连接会接续分配历史。</p>
          <label class="field-label" for="inventory">节点 JSON</label>
          <textarea id="inventory" rows="14" spellcheck="false" autocomplete="off"></textarea>
        </div>
      </details>
    </div>
    <footer class="card-foot">
      <p class="status" role="status" aria-live="polite">正在加载…</p>
      <div class="actions">
        <button id="pool-reload" class="secondary">${icon("refresh")}重新加载</button>
        <button id="save" disabled>${icon("save")}保存并分配</button>
      </div>
    </footer>
  </article>
  <article class="card">
    <header class="card-head"><h3>节点归属</h3><p>按分组折叠，点击分组查看连接；搜索或筛选时自动展开有结果的分组。累计分配包含初次分配与重新分配，不代表连接次数。</p></header>
    <div class="toolbar">
      <label class="search">${icon("search")}<input id="node-search" type="search" placeholder="搜索节点、分组或用户邮箱" aria-label="搜索节点、分组或用户邮箱" autocomplete="off" spellcheck="false"></label>
      <select id="node-status" aria-label="按状态筛选连接"><option value="" selected>全部状态</option><option value="enabled">启用</option><option value="disabled">停用</option><option value="idle">空闲（无人分配）</option></select>
      <span id="node-summary" class="toolbar-note"></span>
      <button id="nodes-toggle" class="secondary small" disabled>全部展开</button>
    </div>
    <div class="table-wrap"><table class="node-table"><thead><tr><th>节点 / 配置详情</th><th>已分配用户</th><th>当前人数 / 累计分配</th><th>状态</th><th class="end">操作</th></tr></thead><tbody id="nodes"></tbody></table></div>
  </article>
  <article class="card">
    <header class="card-head"><h3>用户与回退顺序</h3><p>用户通过 Google 登录后自动加入。停用用户将撤销订阅链接并释放主节点；重新启用后需获取新链接。</p></header>
    <div class="toolbar">
      <label class="search">${icon("search")}<input id="user-search" type="search" placeholder="搜索用户邮箱" aria-label="搜索用户邮箱" autocomplete="off" spellcheck="false"></label>
      <span id="user-summary" class="toolbar-note"></span>
    </div>
    <div class="table-wrap"><table class="user-table"><thead><tr><th>用户</th><th>节点分配 / 回退顺序</th><th>状态</th><th class="end">操作</th></tr></thead><tbody id="users"></tbody></table></div>
  </article>`, script: String.raw`
    let state;
    let editorRevision;
    let busy = false;
    let nodeGroups = [];
    let userRows = [];
    let noNodeMatch;
    let noUserMatch;
    const openNodeGroups = new Set();
    const openUsers = new Set();
    const editor = root.querySelector("#inventory");
    const importer = root.querySelector("#import");
    const importNotes = root.querySelector("#import-notes");
    const save = root.querySelector("#save");
    const append = root.querySelector("#append");
    const replace = root.querySelector("#replace");
    const nodeSearch = root.querySelector("#node-search");
    const nodeStatus = root.querySelector("#node-status");
    const nodeSummary = root.querySelector("#node-summary");
    const nodesToggle = root.querySelector("#nodes-toggle");
    const userSearch = root.querySelector("#user-search");
    const userSummary = root.querySelector("#user-summary");
    function emptyRow(columns, text) {
      const row = element("tr");
      const node = cell(row, text);
      node.colSpan = columns;
      node.className = "empty";
      return row;
    }
    function metric(text, value) {
      const node = element("div");
      node.className = "metric";
      node.append(element("span", text), element("strong", String(value)));
      return node;
    }
    function nodeFilter() {
      const terms = nodeSearch.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const status = nodeStatus.value;
      return {
        terms,
        active: Boolean(terms.length || status),
        matches: ({ node, text }) => terms.every((term) => text.includes(term))
          && (!status || (status === "disabled" ? !node.enabled : node.enabled && (status === "enabled" || !node.ownerIds.length))),
      };
    }
    function showNodes() {
      const filter = nodeFilter();
      let matched = 0;
      for (const group of nodeGroups) {
        const open = filter.active || openNodeGroups.has(group.name);
        let visible = 0;
        for (const entry of group.rows) {
          const match = filter.matches(entry);
          entry.row.hidden = !match || !open;
          if (match) visible += 1;
          if (match && entry.reveal && filter.terms.some((term) => entry.overflow.includes(term))) entry.reveal();
        }
        matched += visible;
        group.header.hidden = !visible;
        group.header.className = open ? "group-row open" : "group-row";
        group.toggle.className = open ? "group-toggle chevron open" : "group-toggle chevron";
        group.toggle.ariaExpanded = String(open);
        group.toggle.disabled = busy || filter.active;
      }
      if (noNodeMatch) noNodeMatch.hidden = Boolean(matched);
      const total = state ? state.nodes.length : 0;
      nodeSummary.textContent = !state ? "" : filter.active ? "匹配 " + matched + " / " + total + " 个连接"
        : "共 " + total + " 个连接 · " + nodeGroups.length + " 个分组";
      nodesToggle.textContent = nodeGroups.length && nodeGroups.every((group) => openNodeGroups.has(group.name)) ? "全部收起" : "全部展开";
      nodesToggle.disabled = busy || filter.active || !nodeGroups.length;
    }
    function showUsers() {
      const query = userSearch.value.trim().toLowerCase();
      let matched = 0;
      for (const { row, email } of userRows) {
        row.hidden = !email.includes(query);
        if (!row.hidden) matched += 1;
      }
      if (noUserMatch) noUserMatch.hidden = Boolean(matched);
      userSummary.textContent = !state ? "" : query ? "匹配 " + matched + " / " + userRows.length + " 位用户" : "共 " + userRows.length + " 位用户";
    }
    nodesToggle.onclick = () => {
      const allOpen = nodeGroups.every((group) => openNodeGroups.has(group.name));
      for (const group of nodeGroups) {
        if (allOpen) openNodeGroups.delete(group.name);
        else openNodeGroups.add(group.name);
      }
      showNodes();
    };
    nodeSearch.oninput = showNodes;
    nodeStatus.onchange = showNodes;
    userSearch.oninput = showUsers;
    function nodeGroup(name, rows) {
      const header = element("tr");
      const members = rows.map(({ node }) => node);
      const enabled = members.filter((node) => node.enabled);
      const logical = (list) => new Set(list.map((node) => node.allocationId || node.id)).size;
      const stats = [members.length + " 个连接", logical(enabled) + " 个启用节点", new Set(members.flatMap((node) => node.ownerIds)).size + " 位用户"];
      const idle = logical(enabled.filter((node) => !node.ownerIds.length));
      if (idle) stats.push(idle + " 个空闲");
      if (members.length > enabled.length) stats.push(members.length - enabled.length + " 个连接停用");
      const toggle = element("button");
      toggle.append(span(name, "chip"), span(stats.join(" · "), "muted"));
      toggle.onclick = () => {
        if (!openNodeGroups.delete(name)) openNodeGroups.add(name);
        showNodes();
      };
      const heading = cell(header);
      heading.colSpan = 5;
      heading.append(toggle);
      return { name, header, toggle, rows };
    }
    function render(data, updateEditor = true) {
      state = data;
      if (updateEditor) {
        editor.value = JSON.stringify(state.nodes.map(({ id, line, enabled }) => ({ id, line, enabled })), null, 2);
        editorRevision = state.revision;
      }
      const usersById = new Map(state.users.map((user) => [user.id, user.email]));
      const nodes = root.querySelector("#nodes");
      nodes.replaceChildren();
      const groups = new Map();
      for (const node of state.nodes) {
        const row = element("tr");
        row.className = "node-row";
        const details = element("details");
        details.append(element("summary", "查看配置"), element("pre", node.line));
        cell(row).append(span(node.name, "node-name"), details);
        const owners = cell(row);
        const emails = node.ownerIds.map((id) => usersById.get(id));
        const overflow = emails.slice(4).map((email) => span(email, "owner"));
        let reveal;
        for (const email of emails.slice(0, 4)) owners.append(span(email, "owner"));
        if (overflow.length) {
          const more = element("button", "+" + overflow.length + " 人");
          more.className = "ghost small more";
          more.title = "显示全部 " + emails.length + " 位用户";
          reveal = more.onclick = () => {
            for (const owner of overflow) owner.hidden = false;
            more.hidden = true;
          };
          for (const owner of overflow) owner.hidden = true;
          owners.append(...overflow, more);
        }
        if (!emails.length) owners.append(span("未分配", "muted"));
        cell(row).append(span(node.ownerIds.length + " 人", "count"), span(node.assignmentCount ? "累计 " + node.assignmentCount + " 次" : "从未分配", "muted"));
        cell(row).append(span(node.enabled ? "启用" : "停用", node.enabled ? "badge ok" : "badge"));
        const button = element("button", "删除");
        button.className = "ghost danger small";
        button.title = "删除 " + node.name;
        button.onclick = () => run(async () => {
          let draft;
          try { draft = JSON.parse(editor.value); } catch { throw new Error("完整清单的 JSON 有误，请先修正后再删除。"); }
          if (!Array.isArray(draft)) throw new Error("完整清单必须为 JSON 数组，请先修正后再删除。");
          const impact = node.allocationId ? "其分配和历史统计将保留在同一节点的另一协议连接上，并重新计算主备顺序。"
            : "该节点当前分配给 " + node.ownerIds.length + " 位用户，历史统计也会删除。用户将重新分配到同组剩余节点；同组无可用节点时移除该组。";
          if (!confirm("确定永久删除「" + node.name + "」？\n" + impact)) return;
          const data = await api(${JSON.stringify(adminRoutes.nodes)}, "PUT", {
            revision: editorRevision,
            nodes: state.nodes.filter((candidate) => candidate.id !== node.id).map(({ id, line, enabled }) => ({ id, line, enabled })),
          });
          editor.value = JSON.stringify(draft.filter((candidate) => candidate?.id !== node.id), null, 2);
          editorRevision = data.revision;
          render(data, false);
          message("节点已删除，主节点与备份顺序已更新。其他未保存的清单编辑已保留。");
        });
        const action = cell(row);
        action.className = "end";
        action.append(button);
        if (!groups.has(node.group)) groups.set(node.group, []);
        groups.get(node.group).push({ row, node, reveal, text: [node.name, node.group, ...emails].join("\n").toLowerCase(),
          overflow: emails.slice(4).join("\n").toLowerCase() });
      }
      nodeGroups = [...groups].map(([name, rows]) => nodeGroup(name, rows));
      for (const group of nodeGroups) nodes.append(group.header, ...group.rows.map(({ row }) => row));
      noNodeMatch = emptyRow(5, state.nodes.length ? "没有符合条件的连接。" : "暂无节点，请先在上方录入。");
      nodes.append(noNodeMatch);
      const users = root.querySelector("#users");
      users.replaceChildren();
      userRows = [];
      for (const user of state.users) {
        const row = element("tr");
        const person = element("div");
        person.className = "person";
        person.append(span(user.email.slice(0, 1).toUpperCase(), "avatar"), span(user.email));
        cell(row).append(person);
        const assignment = cell(row);
        const summary = element("div");
        summary.className = "assignment";
        assignment.append(summary);
        const allocated = user.groups.filter((group) => group.primaryId);
        const pending = user.groups.filter((group) => !group.primaryId).map((group) => group.group);
        if (!user.enabled) summary.append(span("已停用，不分配节点", "muted"));
        else if (!user.groups.length) summary.append(span("暂无可分配的节点组", "muted"));
        else summary.append(span("已分配 " + allocated.length + " / " + user.groups.length + " 组", "muted"));
        if (user.enabled && pending.length) summary.append(span("待分配：" + pending.join("、"), "pending"));
        if (user.enabled && allocated.length) {
          const orders = element("div");
          orders.className = "orders";
          for (const group of allocated) {
            const hops = span(undefined, "hops");
            for (const [index, node] of group.nodes.entries()) {
              if (index) hops.append(span("→", "muted"));
              hops.append(span(node.name));
            }
            orders.append(span(group.group, "chip"), hops);
          }
          const toggle = element("button");
          const show = () => {
            const open = openUsers.has(user.id);
            orders.hidden = !open;
            toggle.textContent = open ? "收起回退顺序" : "查看回退顺序";
            toggle.className = open ? "ghost small chevron open" : "ghost small chevron";
            toggle.ariaExpanded = String(open);
          };
          toggle.onclick = () => {
            if (!openUsers.delete(user.id)) openUsers.add(user.id);
            show();
          };
          show();
          summary.append(toggle);
          assignment.append(orders);
        }
        cell(row).append(span(user.enabled ? ({ active: "已分配", partial: "部分待分配", pending: "待分配" }[user.status]) : "已停用",
          !user.enabled ? "badge" : user.status === "active" ? "badge ok" : "badge warn"));
        const button = element("button", user.enabled ? "停用" : "启用");
        button.className = user.enabled ? "ghost danger small" : "tonal small";
        button.onclick = () => run(async () => {
          const data = await api(${JSON.stringify(adminRoutes.users)}, "PATCH", { id: user.id, enabled: !user.enabled });
          render(data, false); message("用户状态已更新。");
        });
        const action = cell(row);
        action.className = "end";
        action.append(button);
        users.append(row);
        userRows.push({ row, email: user.email.toLowerCase() });
      }
      noUserMatch = emptyRow(4, state.users.length ? "没有匹配的用户。" : "暂无用户。");
      users.append(noUserMatch);
      const enabled = [...new Map(state.nodes.filter((node) => node.enabled).map((node) => [node.allocationId || node.id, node])).values()];
      root.querySelector("#counts").replaceChildren(metric("启用节点", enabled.length), metric("空闲节点", enabled.filter((node) => !node.ownerIds.length).length), metric("用户", state.users.length));
      showNodes();
      showUsers();
    }
    async function run(action) {
      if (busy || pageState.changing) return;
      lock(true);
      try { await action(); }
      catch (error) { message(error.message, true); }
      finally {
        lock(false);
      }
    }
    function lock(locked) {
      busy = locked;
      editor.readOnly = locked; importer.readOnly = locked;
      root.querySelectorAll("button").forEach((button) => { button.disabled = locked; });
      save.disabled = append.disabled = replace.disabled = locked || !state;
      showNodes();
    }
    pageState.panels.push({
      lock,
      canSwitch: () => {
        if (busy) return false;
        const saved = state ? JSON.stringify(state.nodes.map(({ id, line, enabled }) => ({ id, line, enabled })), null, 2) : "";
        return (editor.value === saved && !importer.value.trim()) || confirm("切换环境将丢弃尚未保存的节点编辑和导入内容，继续？");
      },
    });
    function load() { return run(async () => { render(await api(${JSON.stringify(adminRoutes.state)})); message("节点池已加载。"); }); }
    root.querySelector("#pool-reload").onclick = () => {
      if (state && !confirm("重新加载将丢弃尚未保存的清单编辑，继续？")) return;
      load();
    };
    const convert = (replacing) => run(async () => {
      const nodes = JSON.parse(editor.value);
      if (!Array.isArray(nodes) || !importer.value.trim()) throw new Error("请填写节点清单，并确保 JSON 为数组。");
      importNotes.replaceChildren();
      message("正在解析并转换节点…");
      const input = { text: importer.value, nodes, ...(replacing ? { replace: true } : {}) };
      let result = await api(${JSON.stringify(adminRoutes.import)}, "POST", input);
      if (replacing && result.removed === undefined) throw new Error("导入接口尚未支持替换，请合并到 master 并部署后再试。");
      const exits = {};
      for (const exit of result.unknownExits) {
        const answer = prompt("无法识别中转出口 " + exit.code + "（" + exit.name + "）。\n请填写旗帜代码、简称和全称，用空格分隔，例如 DE DE Germany。\n取消则新节点去掉入口旗帜，需在清单中补全名称后保存。", exit.code + " " + exit.code + " ");
        if (!answer?.trim()) continue;
        const [flag, code, name, ...extra] = answer.trim().split(/\s+/);
        if (!name || extra.length) throw new Error("请按“旗帜代码 简称 全称”填写 " + exit.code + "，各项不含空格。");
        exits[exit.code] = { flag, code, name };
      }
      if (Object.keys(exits).length) {
        message("正在按填写的出口国家重新转换…");
        result = await api(${JSON.stringify(adminRoutes.import)}, "POST", { ...input, exits });
      }
      if (result.removed && !confirm("替换后将移除 " + result.removed + " 个未出现在本次导入中的已有节点，保存并分配后生效。继续？")) {
        message("已取消替换，待保存清单未改变。");
        return;
      }
      editor.value = JSON.stringify(result.nodes, null, 2);
      importer.value = "";
      for (const warning of result.warnings) importNotes.append(element("li", warning));
      if (result.added || replacing) editor.closest("details").open = true;
      message(replacing
        ? "已替换待保存清单：保留 " + (result.nodes.length - result.added) + " 个已有节点的 ID 和启停状态，新增 " + result.added + " 条，移除 " + result.removed + " 条，跳过 " + result.duplicates + " 条重复节点。核对名称后点击保存并分配。"
        : "已加入 " + result.added + " 条节点，跳过 " + result.duplicates + " 条重复节点。核对名称后点击保存并分配。");
    });
    append.onclick = () => convert(false);
    replace.onclick = () => convert(true);
    save.onclick = () => run(async () => {
      const nodes = JSON.parse(editor.value);
      render(await api(${JSON.stringify(adminRoutes.nodes)}, "PUT", { revision: editorRevision, nodes }));
      message("节点清单已保存，主节点与备份顺序已更新。");
    });
    load();
  ` };
}
