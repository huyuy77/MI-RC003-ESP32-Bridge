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
  KEYMAP_BEGIN: 0x15,
  KEYMAP_DATA: 0x16,
  KEYMAP_COMMIT: 0x17,
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

const MOD_BITS = [
  [0x01, "左Ctrl"], [0x02, "左Shift"], [0x04, "左Alt"], [0x08, "左Win"],
  [0x10, "右Ctrl"], [0x20, "右Shift"], [0x40, "右Alt"], [0x80, "右Win"],
];

const HID_GROUPS = [
  ["字母", [[0x04,"A"],[0x05,"B"],[0x06,"C"],[0x07,"D"],[0x08,"E"],[0x09,"F"],[0x0a,"G"],[0x0b,"H"],[0x0c,"I"],[0x0d,"J"],[0x0e,"K"],[0x0f,"L"],[0x10,"M"],[0x11,"N"],[0x12,"O"],[0x13,"P"],[0x14,"Q"],[0x15,"R"],[0x16,"S"],[0x17,"T"],[0x18,"U"],[0x19,"V"],[0x1a,"W"],[0x1b,"X"],[0x1c,"Y"],[0x1d,"Z"]]],
  ["数字", [[0x1e,"1 !"],[0x1f,"2 @"],[0x20,"3 #"],[0x21,"4 $"],[0x22,"5 %"],[0x23,"6 ^"],[0x24,"7 &"],[0x25,"8 *"],[0x26,"9 ("],[0x27,"0 )"]]],
  ["常用", [[0x28,"Enter 回车"],[0x29,"Esc"],[0x2a,"Backspace"],[0x2b,"Tab"],[0x2c,"Space 空格"],[0x39,"CapsLock"],[0x65,"Menu 菜单"]]],
  ["符号", [[0x2d,"- _"],[0x2e,"= +"],[0x2f,"[ {"],[0x30,"] }"],[0x31,"\\ |"],[0x33,"; :"],[0x34,"' \""],[0x35,"` ~"],[0x36,", <"],[0x37,". >"],[0x38,"/ ?"]]],
  ["功能键", [[0x3a,"F1"],[0x3b,"F2"],[0x3c,"F3"],[0x3d,"F4"],[0x3e,"F5"],[0x3f,"F6"],[0x40,"F7"],[0x41,"F8"],[0x42,"F9"],[0x43,"F10"],[0x44,"F11"],[0x45,"F12"],[0x68,"F13"],[0x69,"F14"],[0x6a,"F15"],[0x6b,"F16"],[0x6c,"F17"],[0x6d,"F18"],[0x6e,"F19"],[0x6f,"F20"],[0x70,"F21"],[0x71,"F22"],[0x72,"F23"],[0x73,"F24"]]],
  ["导航", [[0x49,"Insert"],[0x4a,"Home"],[0x4b,"PageUp"],[0x4c,"Delete"],[0x4d,"End"],[0x4e,"PageDown"],[0x4f,"方向→"],[0x50,"方向←"],[0x51,"方向↓"],[0x52,"方向↑"],[0x46,"PrintScreen"],[0x47,"ScrollLock"],[0x48,"Pause"]]],
  ["小键盘", [[0x53,"NumLock"],[0x54,"/"],[0x55,"*"],[0x56,"-"],[0x57,"+"],[0x58,"Num Enter"],[0x59,"1"],[0x5a,"2"],[0x5b,"3"],[0x5c,"4"],[0x5d,"5"],[0x5e,"6"],[0x5f,"7"],[0x60,"8"],[0x61,"9"],[0x62,"0"],[0x63,"."]]],
];

const CONSUMER_GROUPS = [
  ["媒体", [[0xcd,"播放/暂停"],[0xb5,"下一曲"],[0xb6,"上一曲"],[0xb7,"停止"],[0xb3,"快进"],[0xb4,"快退"]]],
  ["音量", [[0xe9,"音量+"],[0xea,"音量-"],[0xe2,"静音"]]],
  ["系统", [[0x30,"电源"],[0x32,"睡眠"],[0x183,"媒体选择"]]],
  ["浏览器", [[0x223,"浏览器主页"],[0x224,"浏览器返回"],[0x225,"浏览器前进"],[0x227,"浏览器刷新"],[0x221,"浏览器搜索"]]],
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

function command(cmd, payloadObj, rawBytes) {
  const run = () => commandImpl(cmd, payloadObj, rawBytes);
  const p = cmdChain.then(run, run);
  cmdChain = p.catch(() => {});
  return p;
}

async function commandImpl(cmd, payloadObj, rawBytes) {
  if (!device || !outEndpoint) throw new Error("设备未连接");
  const payload = rawBytes
    ? rawBytes
    : (payloadObj ? new TextEncoder().encode(JSON.stringify(payloadObj)) : new Uint8Array(0));
  const frame = buildFrame(cmd, payload);
  if (frame.length <= 512) {
    await device.transferOut(outEndpoint.endpointNumber, frame);
  } else {
    // Large frames (legacy save) go out in small chunks.
    for (let off = 0; off < frame.length; off += 256) {
      await device.transferOut(outEndpoint.endpointNumber, frame.subarray(off, off + 256));
    }
  }
  console.log("[WebUSB] send cmd=0x" + cmd.toString(16) + " len=" + payload.length);
  const resp = await readFrame();
  console.log("[WebUSB] cmd=0x" + cmd.toString(16) + " status=" + resp.status + " len=" + resp.payload.length);
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
    $("st-build").textContent = s.build || "-";
    if (s.version) {
      $("hdr-version").textContent = "固件 v" + s.version + (s.build ? " (" + s.build + ")" : "");
    }
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

let savingKeymap = false;

async function saveKeymap() {
  // Guard against rapid repeated clicks: each save triggers an NVS flash
  // write, and several in a row can disrupt the USB link.
  if (savingKeymap) return;
  savingKeymap = true;
  const btn = $("btn-keymap-save");
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "保存中...";
  try {
    // Chunked upload: many small commands instead of one large bulk OUT
    // transfer (large transfers could stall the vendor endpoint).
    const json = new TextEncoder().encode(JSON.stringify(keymap));
    await command(CMD.KEYMAP_BEGIN);
    for (let off = 0; off < json.length; off += 64) {
      await command(CMD.KEYMAP_DATA, null, json.subarray(off, off + 64));
    }
    const res = await command(CMD.KEYMAP_COMMIT);
    if (res && res.error) {
      toast("保存失败: " + res.error, true);
      return;
    }
    toast("按键配置已保存");
    await loadKeymap();
  } catch (e) {
    console.log("[WebUSB] save error:", e && e.message ? e.message : e);
    toast("保存失败: " + e.message, true);
  } finally {
    savingKeymap = false;
    btn.disabled = false;
    btn.textContent = oldText;
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

  const usageOptions = HID_GROUPS.map(([g, items]) =>
    `<optgroup label="${g}">` + items.map(([v, n]) =>
      `<option value="${v}" ${v === key ? "selected" : ""}>${n}</option>`).join("") + `</optgroup>`
  ).join("");
  const consumerOptions = CONSUMER_GROUPS.map(([g, items]) =>
    `<optgroup label="${g}">` + items.map(([v, n]) =>
      `<option value="${v}" ${v === cons ? "selected" : ""}>${n}</option>`).join("") + `</optgroup>`
  ).join("");
  const modChecks = MOD_BITS.map(([bit, name]) =>
    `<label class="check"><input type="checkbox" class="f-mod" value="${bit}" ${(mod & bit) ? "checked" : ""}/>${name}</label>`
  ).join("");

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
      <div class="f-keyboard">
        <div class="field"><label>修饰键（可多选）</label><div class="mods">${modChecks}</div></div>
        <div class="inline">
          <div class="field"><label>按键</label><select class="f-key">${usageOptions}</select></div>
          <div class="field"><label>自定义按键码（0 = 用下拉选择）</label><input type="number" class="f-keynum" value="${key}" min="0" max="255"/></div>
        </div>
      </div>
      <div class="f-consumer">
        <div class="inline">
          <div class="field"><label>多媒体键</label><select class="f-cons">${consumerOptions}</select></div>
          <div class="field"><label>自定义多媒体码（0 = 用下拉选择）</label><input type="number" class="f-consnum" value="${cons}" min="0" max="65535"/></div>
        </div>
      </div>
      <div class="f-layer">
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
    block.querySelector(".f-keyboard").style.display = (type === 1 || type === 2 || type === 7) ? "block" : "none";
    block.querySelector(".f-consumer").style.display = (type === 4) ? "block" : "none";
    block.querySelector(".f-layer").style.display = (type === 9) ? "block" : "none";
  });
}

function readActionFields(block) {
  const type = parseInt(block.querySelector(".f-type").value, 10);
  const hasBox = block.querySelector(".f-has");
  const has = hasBox ? hasBox.checked : true;
  let mod = 0;
  block.querySelectorAll(".f-mod").forEach((c) => { if (c.checked) mod |= parseInt(c.value, 10); });
  // Prefer the custom number only if it is non-zero, otherwise use the
  // dropdown selection (the number input defaults to 0).
  const keyNum = parseInt(block.querySelector(".f-keynum")?.value || "0", 10);
  const keySel = parseInt(block.querySelector(".f-key")?.value || "0", 10);
  const consNum = parseInt(block.querySelector(".f-consnum")?.value || "0", 10);
  const consSel = parseInt(block.querySelector(".f-cons")?.value || "0", 10);
  return {
    has,
    type,
    mod,
    key: keyNum || keySel,
    cons: consNum || consSel,
    layer: parseInt(block.querySelector(".f-layer")?.value || "0", 10),
    ms: parseInt(block.querySelector(".f-ms")?.value || "0", 10),
  };
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
    if (e.target.classList.contains("f-key")) {
      const num = e.target.closest(".f-keyboard")?.querySelector(".f-keynum");
      if (num) num.value = e.target.value;
    }
    if (e.target.classList.contains("f-cons")) {
      const num = e.target.closest(".f-consumer")?.querySelector(".f-consnum");
      if (num) num.value = e.target.value;
    }
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
