const byId = (id) => document.getElementById(id);
const goButton = byId("go-button");
const dial = byId("dial");
const dialValue = byId("dial-value");
const dialCaption = byId("dial-caption");
const goCaption = byId("go-caption");
const dialUnder = byId("dial-under");
const gaugeProgress = byId("gauge-progress");
const statusText = byId("status-text");
const copyButton = byId("copy-button");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Fixed samples keep this static demonstration independent of the visitor's network.
const phases = [
  { id: "connect", duration: 1100, status: "正在连接…", caption: "CONNECTING" },
  { id: "latency", duration: 1500, status: "正在测试延迟…", caption: "PING / 延迟", output: "ping-value", target: 14, unit: "ms" },
  { id: "download", duration: 4400, status: "正在测试下载…", caption: "DOWNLOAD / 下载", output: "download-value", target: 286.4, unit: "Mbps" },
  { id: "upload", duration: 3600, status: "正在测试上传…", caption: "UPLOAD / 上传", output: "upload-value", target: 72.8, unit: "Mbps" },
];

let running = false;
let frame = 0;
let startedAt = 0;
let activePhase = -1;
let lastPaint = -Infinity;
let copyVersion = 0;

function format(value, phase) {
  return phase.id === "latency" ? String(Math.round(value)) : value.toFixed(1);
}

function setProgress(value) {
  const progress = Math.min(100, Math.log10(1 + value) / Math.log10(1001) * 100);
  gaugeProgress.setAttribute("stroke-dashoffset", String(100 - progress));
}

function reset() {
  cancelAnimationFrame(frame);
  running = false;
  activePhase = -1;
  lastPaint = -Infinity;
  copyVersion += 1;
  copyButton.hidden = true;
  copyButton.disabled = false;
  copyButton.textContent = "复制测试结果 ↗";
  delete dial.dataset.running;
  goButton.setAttribute("aria-label", "开始测速");
  dialValue.textContent = "GO";
  dialCaption.textContent = "LET’S GO";
  goCaption.textContent = "开始测速";
  dialUnder.textContent = "点击，探索连接的速度";
  setProgress(0);
  for (const phase of phases) {
    const step = byId(`step-${phase.id}`);
    delete step.dataset.active;
    delete step.dataset.done;
    if (phase.output) {
      byId(phase.output).textContent = "—";
      delete byId(`${phase.id}-metric`).dataset.active;
    }
  }
}

function stop() {
  reset();
  statusText.textContent = "测试已停止，可重新开始";
}

function activatePhase(index) {
  activePhase = index;
  for (let i = 0; i < phases.length; i += 1) {
    const phase = phases[i];
    byId(`step-${phase.id}`).toggleAttribute("data-active", i === index);
    byId(`step-${phase.id}`).toggleAttribute("data-done", i < index);
    if (phase.output) {
      byId(`${phase.id}-metric`).toggleAttribute("data-active", i === index);
      if (i < index) byId(phase.output).textContent = format(phase.target, phase);
    }
  }
  const phase = phases[index];
  statusText.textContent = phase.status;
  dialCaption.textContent = phase.caption;
  goCaption.textContent = phase.unit || "连接中";
  dialValue.textContent = "···";
  setProgress(0);
}

function finish() {
  running = false;
  delete dial.dataset.running;
  for (const phase of phases) {
    delete byId(`step-${phase.id}`).dataset.active;
    byId(`step-${phase.id}`).dataset.done = "";
    if (phase.output) {
      byId(phase.output).textContent = format(phase.target, phase);
      delete byId(`${phase.id}-metric`).dataset.active;
    }
  }
  gaugeProgress.setAttribute("stroke-dashoffset", "0");
  dialCaption.textContent = "ALL DONE";
  dialValue.textContent = "GO";
  goCaption.textContent = "再测一次";
  dialUnder.textContent = "每一次连接，都值得了解";
  statusText.textContent = "测试完成";
  goButton.setAttribute("aria-label", "再次测速");
  copyButton.hidden = false;
}

function tick(now) {
  if (!running) return;
  let elapsed = now - startedAt;
  let index = 0;
  while (index < phases.length && elapsed >= phases[index].duration) {
    elapsed -= phases[index].duration;
    index += 1;
  }
  if (index === phases.length) {
    finish();
    return;
  }
  const changed = index !== activePhase;
  if (changed) activatePhase(index);
  const phase = phases[index];
  if (phase.output && (changed || now - lastPaint >= 80)) {
    const progress = Math.min(1, elapsed / phase.duration);
    const value = phase.id === "latency"
      ? phase.target + 18 * (1 - progress)
      : phase.target * (1 - (1 - progress) ** 3) + Math.sin(progress * 28) * 3 * Math.sin(progress * Math.PI);
    // Reduced motion keeps each phase's sample still instead of animating numbers.
    const sample = reducedMotion.matches ? phase.target : value;
    dialValue.textContent = format(sample, phase);
    byId(phase.output).textContent = format(sample, phase);
    if (phase.id !== "latency") setProgress(sample);
    lastPaint = now;
  }
  frame = requestAnimationFrame(tick);
}

goButton.addEventListener("click", () => {
  if (running) {
    stop();
    return;
  }
  reset();
  running = true;
  startedAt = performance.now();
  dial.dataset.running = "";
  goButton.setAttribute("aria-label", "停止测速");
  dialUnder.textContent = "点击圆环，随时停止";
  activatePhase(0);
  frame = requestAnimationFrame(tick);
});

copyButton.addEventListener("click", async () => {
  const version = copyVersion;
  const result = [
    "Pulse 网络测速结果",
    `下载：${byId("download-value").textContent} Mbps`,
    `上传：${byId("upload-value").textContent} Mbps`,
    `延迟：${byId("ping-value").textContent} ms`,
  ].join("\n");
  copyButton.disabled = true;
  try {
    await navigator.clipboard.writeText(result);
    if (version === copyVersion) {
      copyButton.textContent = "已复制 ✓";
      statusText.textContent = "测试结果已复制";
    }
  } catch {
    if (version === copyVersion) statusText.textContent = "复制未获浏览器允许，请手动记录上方测试结果";
  } finally {
    if (version === copyVersion) copyButton.disabled = false;
  }
});

for (const trigger of document.querySelectorAll("[data-dialog]")) {
  trigger.addEventListener("click", () => byId(trigger.dataset.dialog).showModal());
}
for (const button of document.querySelectorAll("[data-close]")) {
  button.addEventListener("click", () => button.closest("dialog").close());
}
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const { left, right, top, bottom } = dialog.getBoundingClientRect();
    if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) dialog.close();
  });
}
window.addEventListener("pagehide", () => { if (running) stop(); });
goButton.disabled = false;
