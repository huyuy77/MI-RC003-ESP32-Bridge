/* MIRC003 Bridge - WebUSB configuration client */

const VID = 0x303a;
const PID = 0x8302;

const CMD = {
  DEVICE_INFO: 0x50,
  STATUS: 0x01,
  LOGS_GET: 0x02,
  LOGS_CLEAR: 0x03,
  KEYMAP_GET: 0x10,
  KEYMAP_SAVE: 0x11,
  KEYMAP_RESET: 0x12,
  KEYMAP_TELEMETRY: 0x13,
  BLE_SCAN: 0x20,
  BLE_CONNECT: 0x21,
  BLE_UNPAIR: 0x22,
  BLE_INFO: 0x23,
  BLE_RECONNECT: 0x24,
  NVS_RESET: 0x31,
  SYSTEM_RESTART: 0x40,
};

const SOF0 = 0x4d;
const SOF1 = 0x52;
const CHUNK = 64;

const ACTION = {
  0: "无", 1: "键盘-单击", 2: "键盘-按住", 3: "键盘-释放",
  4: "多媒体-单击", 5: "多媒体-按住", 6: "多媒体-释放",
  7: "语音", 8: "语音释放", 9: "切换层级", 10: "穿透继承",
};

const PHYSICAL_KEYS = [
  { vk: 0x66, name: "电源键" },
  { vk: 0x04, name: "语音键" },
  { vk: 0x52, name: "方向上" },
  { vk: 0x51, name: "方向下" },
  { vk: 0x50, name: "方向左" },
  { vk: 0x4f, name: "方向右" },
  { vk: 0x28, name: "确定键" },
  { vk: 0xf1, name: "返回键" },
  { vk: 0x24, name: "主页键" },
  { vk: 0x5d, name: "菜单键" },
  { vk: 0x80, name: "音量+" },
  { vk: 0x81, name: "音量-" },
  { vk: 0xc0, name: "电视键" },
];

const HID_USAGES = [
  [0x28, "Enter 回车"], [0x29, "Esc"], [0x2a, "Backspace"], [0x2b, "Tab"],
  [0x2c, "Space 空格"], [0x4f, "→"], [0x50, "←"], [0x51, "↓"], [0x52, "↑"],
  [0x3e, "F5"], [0x41, "F8"], [0x07, "D"], [0x0b, "H"], [0x36, "逗号 ,"],
];

const CONSUMER_USAGES = [
  [0x0032, "休眠"], [0x00cd, "播放/暂停"], [0x00e2, "静音"],
  [0x00e9, "音量+"], [0x00ea, "音量-"], [0x00b5, "下一曲"],
  [0x00b6, "上一曲"], [0x0223, "浏览器主页"], [0x0224, "浏览器返回"],
];

let device = null;
let outEndpoint = null;
let inEndpoint = null;
let rxBuffer = new Uint8Array(0);
let keymap = null;
let activeLayer = 0;
let logTimer = null;
let statusTimer = null;

const $ = (id) => document.getElementById(id);

/* ------------------------- WebUSB plumbing ------------------------- */

function setConnected(on) {
  $("conn-dot").classList.toggle("on", on);
  $("conn-text").textContent = on ? "已连接" : "未连接";
  $("btn-connect").disabled = on;
  $("btn-disconnect").disabled = !on;
}

async function connect() {
  if (!navigator.usb) {
    toast("当前浏览器不支持 WebUSB", true);
    return;
  }
  try {
    device = await navigator.usb.requestDevice({ filters: [{ vendorId: VID, productId: PID }] });
    await device.open();
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }
    // Locate the vendor-specific (0xFF) interface and its bulk endpoints.
    let claimed = false;
    for (const itf of device.configuration.interfaces) {
      for (const alt of itf.alternates) {
        if (alt.interfaceClass === 0xff) {
          await device.claimInterface(itf.interfaceNumber);
          outEndpoint = alt.endpoints.find((e) => e.direction === "out");
          inEndpoint = alt.endpoints.find((e) => e.direction === "in");
          claimed = true;
        }
      }
    }
    if (!claimed || !outEndpoint || !inEndpoint) {
      throw new Error("未找到 WebUSB 厂商接口");
    }
    console.log("[WebUSB] claimed interface, OUT ep=0x" + outEndpoint.endpointNumber.toString(16) +
                ", IN ep=0x" + inEndpoint.endpointNumber.toString(16));
    setConnected(true);
    toast("设备已连接");
    await loadDeviceInfo();
    await refreshStatus();
    await loadKeymap();
    await refreshBleInfo();
    startAutoRefresh();
  } catch (err) {
    console.error(err);
    toast("连接失败: " + err.message, true);
  }
}

async function disconnect() {
  stopAutoRefresh();
  try {
    if (device) {
      await device.close();
    }
  } catch (e) { /* ignore */ }
  device = null;
  outEndpoint = null;
  inEndpoint = null;
  rxBuffer = new Uint8Array(0);
  setConnected(false);
  toast("已断开");
}

function buildFrame(cmd, payload) {
  const len = payload ? payload.length : 0;
  const frame = new Uint8Array(6 + len);
  frame[0] = SOF0;
  frame[1] = SOF1;
  frame[2] = cmd;
  frame[3] = 0;
  frame[4] = len & 0xff;
  frame[5] = (len >> 8) & 0xff;
  if (len) frame.set(payload, 6);
  return frame;
}

async function readFrame() {
  for (;;) {
    if (rxBuffer.length >= 6) {
      if (rxBuffer[0] === SOF0 && rxBuffer[1] === SOF1) {
        const len = rxBuffer[4] | (rxBuffer[5] << 8);
        if (rxBuffer.length >= 6 + len) {
          const cmd = rxBuffer[2];
          const status = rxBuffer[3];
          const payload = rxBuffer.slice(6, 6 + len);
          rxBuffer = rxBuffer.slice(6 + len);
          return { cmd, status, payload };
        }
      } else {
        rxBuffer = rxBuffer.slice(1);
        continue;
      }
    }
    const result = await device.transferIn(inEndpoint.endpointNumber, CHUNK);
    if (result.status !== "ok" || !result.data) {
      throw new Error("USB 读取失败: " + result.status);
    }
    const chunk = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
    if (chunk.length) console.log("[WebUSB] in " + chunk.length + " bytes");
    const merged = new Uint8Array(rxBuffer.length + chunk.length);
    merged.set(rxBuffer, 0);
    merged.set(chunk, rxBuffer.length);
    rxBuffer = merged;
  }
}

// All USB transfers are serialized through this chain: the status and log
// auto-refresh timers would otherwise run overlapping readFrame() loops and
// corrupt each other's framing.
let cmdChain = Promise.resolve();

function command(cmd, payloadObj) {
  const run = () => commandImpl(cmd, payloadObj);
  const p = cmdChain.then(run, run);
  cmdChain = p.catch(() => {});
  return p;
}

async function commandImpl(cmd, payloadObj) {
  if (!device || !outEndpoint) throw new Error("设备未连接");
  const payload = payloadObj ? new TextEncoder().encode(JSON.stringify(payloadObj)) : new Uint8Array(0);
  await device.transferOut(outEndpoint.endpointNumber, buildFrame(cmd, payload));
  const resp = await readFrame();
  if (resp.status !== 0) {
    throw new Error("设备返回错误 (status=" + resp.status + ")");
  }
  const text = new TextDecoder().decode(resp.payload);
  return text ? JSON.parse(text) : {};
}

/* ------------------------- Device operations ------------------------- */

async function loadDeviceInfo() {
  try {
    const info = await command(CMD.DEVICE_INFO);
    $("device-info").textContent = JSON.stringify(info, null, 2);
  } catch (e) { /* ignore */ }
}

async function refreshStatus() {
  try {
    const s = await command(CMD.STATUS);
    $("st-firmware").textContent = s.firmware || "-";
    $("st-version").textContent = s.version || "-";
    $("st-uptime").textContent = formatUptime(s.uptime_sec || 0);
    $("st-ble").textContent = ["未连接", "扫描中", "连接中", "已连接", "语音中"][s.ble_state] || s.ble_state;
    $("st-layer").textContent = "层 " + (s.active_layer ?? 0);
    $("st-frames").textContent = s.frames_decoded ?? 0;
    $("st-heap").textContent = formatBytes(s.free_heap);
    $("st-psram").textContent = formatBytes(s.free_psram);
  } catch (e) { /* ignore */ }
}

async function refreshTelemetry() {
  try {
    const t = await command(CMD.KEYMAP_TELEMETRY);
    $("telemetry").textContent = JSON.stringify(t, null, 2);
  } catch (e) { /* ignore */ }
}

async function refreshBleInfo() {
  try {
    const info = await command(CMD.BLE_INFO);
    $("ble-info").textContent = JSON.stringify(info, null, 2);
  } catch (e) { /* ignore */ }
}

async function scanBle() {
  const tbody = $("ble-table").querySelector("tbody");
  tbody.innerHTML = "<tr><td colspan='4'>扫描中...</td></tr>";
  try {
    const res = await command(CMD.BLE_SCAN);
    const devices = res.devices || [];
    tbody.innerHTML = "";
    if (!devices.length) {
      tbody.innerHTML = "<tr><td colspan='4'>未发现设备，请让遥控器进入配对状态后重试。</td></tr>";
      return;
    }
    for (const d of devices) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(d.name || "Unnamed")}</td><td>${d.mac}</td><td>${d.rssi} dBm</td>`;
      const td = document.createElement("td");
      const btn = document.createElement("button");
      btn.className = "btn small primary";
      btn.textContent = "连接";
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          await command(CMD.BLE_CONNECT, { mac: d.mac, type: d.type, name: d.name });
          toast("已发起连接: " + (d.name || d.mac));
          setTimeout(refreshBleInfo, 1500);
        } catch (e) {
          toast(e.message, true);
        } finally {
          btn.disabled = false;
        }
      };
      td.appendChild(btn);
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan='4'>${escapeHtml(e.message)}</td></tr>`;
  }
}

async function loadKeymap() {
  try {
    keymap = await command(CMD.KEYMAP_GET);
    activeLayer = keymap.active_layer || 0;
    renderLayerTabs();
    renderKeymapGrid();
    $("raw-json").value = JSON.stringify(keymap, null, 2);
  } catch (e) {
    toast("读取按键配置失败: " + e.message, true);
  }
}

async function saveKeymap() {
  try {
    const res = await command(CMD.KEYMAP_SAVE, keymap);
    if (res && res.error) {
      toast("保存失败: " + res.error, true);
      return;
    }
    toast("按键配置已保存");
    await loadKeymap();
  } catch (e) {
    toast("保存失败: " + e.message, true);
  }
}

async function resetKeymap() {
  if (!confirm("确定恢复出厂按键配置？")) return;
  try {
    await command(CMD.KEYMAP_RESET);
    toast("已恢复出厂配置");
    await loadKeymap();
  } catch (e) {
    toast(e.message, true);
  }
}

/* ------------------------- Keymap rendering ------------------------- */

function getLayer(idx) {
  return keymap && keymap.layers ? keymap.layers.find((l) => l.id === idx) : null;
}

function getBinding(layer, vk) {
  if (!layer || !layer.bindings) return null;
  return layer.bindings.find((b) => b.source_vk === vk) || null;
}

function ensureBinding(layer, vk) {
  if (!layer.bindings) layer.bindings = [];
  let b = getBinding(layer, vk);
  if (!b) {
    b = { source_vk: vk };
    layer.bindings.push(b);
  }
  return b;
}

function renderLayerTabs() {
  const host = $("layer-tabs");
  host.innerHTML = "";
  (keymap.layers || []).forEach((layer) => {
    const btn = document.createElement("button");
    btn.className = "layer-tab" + (layer.id === activeLayer ? " active" : "");
    const color = layer.color || "#00ff00";
    btn.innerHTML = `<span class="swatch" style="background:${color}"></span>${escapeHtml(layer.name || "层" + layer.id)}`;
    btn.onclick = () => {
      activeLayer = layer.id;
      renderLayerTabs();
      renderKeymapGrid();
    };
    host.appendChild(btn);
  });
}

function actionSummary(b, prefix) {
  const typeKey = prefix + "_type";
  const type = b["has_" + prefix] ? (b[typeKey] ?? 0) : 0;
  if (!type) return null;
  let text = ACTION[type] || ("类型" + type);
  if (type === 1 || type === 2) {
    const mod = b[prefix + "_mod"] || 0;
    const key = b[prefix + "_key"] || 0;
    return `${text} (mod 0x${mod.toString(16)} key 0x${key.toString(16)})`;
  }
  if (type === 4) {
    return `${text} (0x${(b[prefix + "_cons"] || 0).toString(16)})`;
  }
  if (type === 7) {
    return `${text} (0x${(b[prefix + "_mod"] || 0).toString(16)}, 0x${(b[prefix + "_key"] || 0).toString(16)})`;
  }
  if (type === 9) {
    return `${text} → 层 ${b[prefix + "_layer"] ?? 0}`;
  }
  return text;
}

function renderKeymapGrid() {
  const host = $("keymap-grid");
  host.innerHTML = "";
  const layer = getLayer(activeLayer);
  if (!layer) return;

  PHYSICAL_KEYS.forEach((pk) => {
    const b = getBinding(layer, pk.vk);
    const card = document.createElement("div");
    card.className = "key-card";
    const click = b ? actionSummary(b, "click") : null;
    const long = b ? actionSummary(b, "long") : null;
    const dbl = b ? actionSummary(b, "double") : null;
    card.innerHTML = `
      <div class="key-name">${pk.name}</div>
      <div class="key-code">0x${pk.vk.toString(16).toUpperCase().padStart(2, "0")}</div>
      <div class="action ${click ? "" : "dim"}">单击: ${click || "无"}</div>
      <div class="action ${long ? "" : "dim"}">长按: ${long || "无"}</div>
      <div class="action ${dbl ? "" : "dim"}">双击: ${dbl || "无"}</div>`;
    card.onclick = () => openEditor(pk);
    host.appendChild(card);
  });
}

/* ------------------------- Action editor ------------------------- */

let editingKey = null;

function actionTypeOptions(selected) {
  const allowed = [0, 1, 2, 4, 7, 9, 10];
  return allowed.map((t) => `<option value="${t}" ${t === selected ? "selected" : ""}>${ACTION[t]}</option>`).join("");
}

function renderActionFields(prefix, b) {
  const has = b["has_" + prefix] ? "checked" : "";
  const type = b[prefix + "_type"] ?? 0;
  const mod = b[prefix + "_mod"] ?? 0;
  const key = b[prefix + "_key"] ?? 0;
  const cons = b[prefix + "_cons"] ?? 0;
  const layer = b[prefix + "_layer"] ?? 0;
  const ms = b[prefix + "_ms"] ?? (prefix === "long" ? 600 : 250);
  const disabled = prefix === "click" ? "disabled" : "";

  const usageOptions = HID_USAGES.map(([v, n]) => `<option value="${v}" ${v === key ? "selected" : ""}>${n} (0x${v.toString(16)})</option>`).join("");
  const consumerOptions = CONSUMER_USAGES.map(([v, n]) => `<option value="${v}" ${v === cons ? "selected" : ""}>${n} (0x${v.toString(16)})</option>`).join("");

  return `
    <div class="action-block" data-prefix="${prefix}">
      <h4>${prefix === "click" ? "单击" : prefix === "long" ? "长按" : "双击"}
        ${prefix !== "click" ? `<label class="check" style="float:right"><input type="checkbox" class="f-has" ${has}/> 启用</label>` : ""}
      </h4>
      <div class="inline">
        <div class="field">
          <label>动作类型</label>
          <select class="f-type">${actionTypeOptions(type)}</select>
        </div>
        ${prefix !== "click" ? `<div class="field"><label>触发时间 (ms)</label><input type="number" class="f-ms" value="${ms}" min="50" max="3000"/></div>` : ""}
      </div>
      <div class="inline f-keyboard">
        <div class="field"><label>修饰键 (0x00-0xFF)</label><input type="number" class="f-mod" value="${mod}" min="0" max="255"/></div>
        <div class="field"><label>按键 HID 码</label>
          <select class="f-key">${usageOptions}</select>
        </div>
        <div class="field"><label>自定义按键码</label><input type="number" class="f-keynum" value="${key}" min="0" max="255"/></div>
      </div>
      <div class="inline f-consumer">
        <div class="field"><label>多媒体码</label><select class="f-cons">${consumerOptions}</select></div>
        <div class="field"><label>自定义多媒体码</label><input type="number" class="f-consnum" value="${cons}" min="0" max="65535"/></div>
      </div>
      <div class="inline f-layer">
        <div class="field"><label>目标层级 (1-4)</label><input type="number" class="f-layer" value="${layer}" min="0" max="4"/></div>
      </div>
    </div>`;
}

function openEditor(pk) {
  editingKey = pk;
  const layer = getLayer(activeLayer);
  const b = getBinding(layer, pk.vk) || { source_vk: pk.vk };
  $("modal-title").textContent = `${pk.name} (层 ${activeLayer})`;
  $("modal-body").innerHTML =
    renderActionFields("click", b) +
    renderActionFields("long", b) +
    renderActionFields("double", b) +
    `<div class="action-block">
       <h4>连发 <label class="check" style="float:right"><input type="checkbox" class="f-has" data-prefix="repeat" ${b.has_repeat ? "checked" : ""}/> 启用</label></h4>
       <div class="inline">
         <div class="field"><label>起始延迟 (ms)</label><input type="number" id="rep-delay" value="${b.repeat_delay_ms ?? 350}"/></div>
         <div class="field"><label>连发间隔 (ms)</label><input type="number" id="rep-interval" value="${b.repeat_interval_ms ?? 70}"/></div>
       </div>
     </div>`;
  $("modal").classList.remove("hidden");
  refreshFieldVisibility();
}

function refreshFieldVisibility() {
  document.querySelectorAll(".action-block").forEach((block) => {
    const typeSel = block.querySelector(".f-type");
    if (!typeSel) return;
    const type = parseInt(typeSel.value, 10);
    block.querySelector(".f-keyboard").style.display = (type === 1 || type === 2 || type === 7) ? "flex" : "none";
    block.querySelector(".f-consumer").style.display = (type === 4) ? "flex" : "none";
    block.querySelector(".f-layer").style.display = (type === 9) ? "flex" : "none";
  });
}

function readActionFields(block) {
  const type = parseInt(block.querySelector(".f-type").value, 10);
  const hasBox = block.querySelector(".f-has");
  const has = hasBox ? hasBox.checked : true;
  const out = {
    has,
    type,
    mod: parseInt(block.querySelector(".f-mod")?.value || "0", 10),
    key: parseInt(block.querySelector(".f-keynum")?.value || block.querySelector(".f-key")?.value || "0", 10),
    cons: parseInt(block.querySelector(".f-consnum")?.value || block.querySelector(".f-cons")?.value || "0", 10),
    layer: parseInt(block.querySelector(".f-layer")?.value || "0", 10),
    ms: parseInt(block.querySelector(".f-ms")?.value || "0", 10),
  };
  return out;
}

function applyEditor() {
  const layer = getLayer(activeLayer);
  const b = ensureBinding(layer, editingKey.vk);
  const blocks = document.querySelectorAll("#modal-body .action-block");
  // click, long, double
  ["click", "long", "double"].forEach((prefix, i) => {
    const cfg = readActionFields(blocks[i]);
    b["has_" + prefix] = cfg.type !== 0;
    b[prefix + "_type"] = cfg.type;
    if (cfg.type === 1 || cfg.type === 2 || cfg.type === 7) {
      b[prefix + "_mod"] = cfg.mod;
      b[prefix + "_key"] = cfg.key;
    } else if (cfg.type === 4) {
      b[prefix + "_cons"] = cfg.cons;
    } else if (cfg.type === 9) {
      b[prefix + "_layer"] = cfg.layer;
    }
    if (prefix !== "click") b[prefix + "_ms"] = cfg.ms;
    if (!b["has_" + prefix]) {
      delete b[prefix + "_type"];
      delete b[prefix + "_mod"];
      delete b[prefix + "_key"];
      delete b[prefix + "_cons"];
      delete b[prefix + "_layer"];
    }
  });
  const repBlock = blocks[3];
  const repEnabled = repBlock.querySelector(".f-has").checked;
  if (repEnabled) {
    b.has_repeat = true;
    b.repeat_type = b.click_type || 4;
    b.repeat_mod = b.click_mod || 0;
    b.repeat_key = b.click_key || 0;
    b.repeat_cons = b.click_cons || 0;
    b.repeat_delay_ms = parseInt($("rep-delay").value, 10);
    b.repeat_interval_ms = parseInt($("rep-interval").value, 10);
  } else {
    delete b.has_repeat;
    delete b.repeat_type;
    delete b.repeat_cons;
  }

  // Drop empty bindings
  layer.bindings = layer.bindings.filter((x) => x.has_click || x.has_long || x.has_double);
  if (!layer.bindings.some((x) => x.source_vk === editingKey.vk)) {
    // nothing configured, leave it out
  }

  $("modal").classList.add("hidden");
  renderKeymapGrid();
  toast("已修改，点击「保存到设备」生效");
}

/* ------------------------- Utilities ------------------------- */

function formatUptime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}时${m}分${s}秒`;
}
function formatBytes(n) {
  if (n === undefined || n === null) return "-";
  return (n / 1024).toFixed(1) + " KB";
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let toastTimer = null;
function toast(msg, isError) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.toggle("error", !!isError);
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

function startAutoRefresh() {
  stopAutoRefresh();
  statusTimer = setInterval(refreshStatus, 2000);
  logTimer = setInterval(() => {
    if ($("log-auto").checked) refreshLogs();
  }, 3000);
}
function stopAutoRefresh() {
  clearInterval(statusTimer);
  clearInterval(logTimer);
  statusTimer = logTimer = null;
}

async function refreshLogs() {
  try {
    const res = await command(CMD.LOGS_GET);
    $("log-view").textContent = (res.logs || []).join("\n");
    $("log-view").scrollTop = $("log-view").scrollHeight;
  } catch (e) { /* ignore */ }
}

/* ------------------------- Wiring ------------------------- */

function initTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      $("panel-" + tab.dataset.tab).classList.add("active");
      if (tab.dataset.tab === "logs") refreshLogs();
      if (tab.dataset.tab === "ble") refreshBleInfo();
    };
  });
}

function init() {
  if (!navigator.usb) {
    $("unsupported").classList.remove("hidden");
  }
  initTabs();
  $("btn-connect").onclick = connect;
  $("btn-disconnect").onclick = disconnect;
  $("btn-telemetry").onclick = refreshTelemetry;
  $("btn-keymap-refresh").onclick = loadKeymap;
  $("btn-keymap-save").onclick = saveKeymap;
  $("btn-keymap-reset").onclick = resetKeymap;
  $("btn-ble-scan").onclick = scanBle;
  $("btn-ble-info").onclick = refreshBleInfo;
  $("btn-ble-unpair").onclick = async () => {
    if (!confirm("确定解除遥控器绑定？")) return;
    try { await command(CMD.BLE_UNPAIR); toast("已解除绑定"); refreshBleInfo(); }
    catch (e) { toast(e.message, true); }
  };
  $("btn-ble-reconnect").onclick = async () => {
    try { await command(CMD.BLE_RECONNECT); toast("正在重新连接..."); } catch (e) { toast(e.message, true); }
  };
  $("btn-logs-refresh").onclick = refreshLogs;
  $("btn-logs-clear").onclick = async () => {
    try { await command(CMD.LOGS_CLEAR); refreshLogs(); } catch (e) { toast(e.message, true); }
  };
  $("btn-restart").onclick = async () => {
    if (!confirm("确定重启设备？")) return;
    try { await command(CMD.SYSTEM_RESTART); toast("设备正在重启..."); } catch (e) { toast(e.message, true); }
  };
  $("btn-nvs-reset").onclick = async () => {
    if (!confirm("确定恢复出厂设置？将清除所有配置与绑定。")) return;
    try { await command(CMD.NVS_RESET); toast("已恢复出厂，设备重启中..."); } catch (e) { toast(e.message, true); }
  };
  $("btn-json-load").onclick = loadKeymap;
  $("btn-json-apply").onclick = async () => {
    try {
      keymap = JSON.parse($("raw-json").value);
      await command(CMD.KEYMAP_SAVE, keymap);
      toast("JSON 已写入设备");
      await loadKeymap();
    } catch (e) {
      toast("JSON 无效: " + e.message, true);
    }
  };

  $("modal-close").onclick = $("modal-cancel").onclick = () => $("modal").classList.add("hidden");
  $("modal-apply").onclick = applyEditor;
  document.addEventListener("change", (e) => {
    if (e.target.classList.contains("f-type")) refreshFieldVisibility();
  });

  navigator.usb?.addEventListener("disconnect", (e) => {
    if (device && e.device === device) {
      toast("设备已拔出", true);
      disconnect();
    }
  });

  setConnected(false);
}

document.addEventListener("DOMContentLoaded", init);
