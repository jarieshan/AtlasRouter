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
      background: #f6f7f9;
      color: #181b20;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #f6f7f9; }
    main { max-width: 1120px; margin: 0 auto; padding: 28px 20px 36px; }
    header { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
    h1 { margin: 0; font-size: 24px; line-height: 1.2; letter-spacing: 0; }
    .status { min-height: 20px; font-size: 14px; color: #586174; }
    .panel { background: #fff; border: 1px solid #dce1e8; border-radius: 8px; padding: 16px; }
    .toolbar { display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 14px; }
    label { display: block; font-size: 13px; font-weight: 650; color: #303642; margin-bottom: 6px; }
    input, textarea {
      width: 100%;
      border: 1px solid #cbd3df;
      border-radius: 6px;
      background: #fff;
      color: #181b20;
      font: inherit;
    }
    input { height: 38px; padding: 0 10px; }
    textarea {
      min-height: 68vh;
      resize: vertical;
      padding: 12px;
      font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      tab-size: 2;
    }
    button {
      height: 38px;
      align-self: end;
      border: 1px solid #b8c1cf;
      border-radius: 6px;
      padding: 0 14px;
      background: #fff;
      color: #172033;
      font-weight: 650;
      cursor: pointer;
    }
    button.primary { background: #1f6feb; border-color: #1f6feb; color: #fff; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .meta { display: flex; justify-content: space-between; gap: 12px; margin-top: 10px; color: #586174; font-size: 13px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
    @media (max-width: 760px) {
      main { padding: 18px 12px 24px; }
      header { display: block; }
      .toolbar { justify-content: stretch; }
      .toolbar button { flex: 1; }
      textarea { min-height: 64vh; }
    }
    @media (prefers-color-scheme: dark) {
      :root, body { background: #0f1218; color: #e7ebf3; }
      .panel, input, textarea, button { background: #161b24; color: #e7ebf3; border-color: #313a49; }
      .status, .meta, label { color: #aeb7c6; }
      button.primary { background: #2f81f7; border-color: #2f81f7; color: #fff; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>AtlasRouter Admin</h1>
      <div class="status" id="status"></div>
    </header>
    <section class="panel">
      <div class="toolbar">
        <button id="load">Load</button>
        <button id="format">Format</button>
        <button id="save" class="primary">Save</button>
      </div>
      <label for="config">router-config</label>
      <textarea id="config" spellcheck="false"></textarea>
      <div class="meta">
        <span>KV key: <code>router-config</code></span>
        <span>Binding: <code>ATLAS_ROUTER</code></span>
      </div>
    </section>
  </main>
  <script>
    const configInput = document.getElementById("config");
    const statusEl = document.getElementById("status");
    const buttons = [...document.querySelectorAll("button")];

    document.getElementById("load").addEventListener("click", loadConfig);
    document.getElementById("save").addEventListener("click", saveConfig);
    document.getElementById("format").addEventListener("click", formatConfig);

    function setStatus(message, isError = false) {
      statusEl.textContent = message;
      statusEl.style.color = isError ? "#b42318" : "";
    }

    function setBusy(isBusy) {
      for (const button of buttons) button.disabled = isBusy;
    }

    async function loadConfig() {
      setBusy(true);
      setStatus("Loading...");
      try {
        const response = await fetch("/admin/config");
        const text = await response.text();
        if (!response.ok) throw new Error(text || response.statusText);
        configInput.value = JSON.stringify(JSON.parse(text), null, 2);
        setStatus("Loaded");
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        setBusy(false);
      }
    }

    async function saveConfig() {
      setBusy(true);
      setStatus("Saving...");
      try {
        const parsed = JSON.parse(configInput.value);
        const response = await fetch("/admin/config", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(parsed),
        });
        const text = await response.text();
        if (!response.ok) throw new Error(text || response.statusText);
        configInput.value = JSON.stringify(JSON.parse(text), null, 2);
        setStatus("Saved");
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        setBusy(false);
      }
    }

    function formatConfig() {
      try {
        configInput.value = JSON.stringify(JSON.parse(configInput.value), null, 2);
        setStatus("Formatted");
      } catch (error) {
        setStatus(error.message, true);
      }
    }
  </script>
</body>
</html>`;
}
