/*
 * MI-RC003 Bridge - default WebUSB configuration UI.
 *
 * This file is only the presentation layer. All device communication goes
 * through the reusable `MiRC003` client (assets/mi-rc003.js). Third parties can
 * replace this file entirely and build their own UI on the same API; see
 * doc.md for the reference.
 */
(function () {
  "use strict";

  // WebUI version (independent of the firmware version). Bump on UI changes.
  const WEBUI_VERSION = "1.2";

  const dev = new MiRC003();
  const ACTION = MiRC003.ACTION;
  const PHYSICAL_KEYS = MiRC003.PHYSICAL_KEYS;
  const MOD_BITS = MiRC003.MOD_BITS;
  const MOUSE_BUTTONS = MiRC003.MOUSE_BUTTONS;
  const HID_GROUPS = MiRC003.HID_GROUPS;
  const CONSUMER_GROUPS = MiRC003.CONSUMER_GROUPS;

  const ICON = {
    power: '<svg viewBox="0 0 24 24"><path d="M12 3v9M7.05 5.93a8 8 0 1 0 9.9 0"/></svg>',
    voice: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
    home: '<svg viewBox="0 0 24 24"><path d="M4 11.2 12 4l8 7.2V20H4z"/></svg>',
    menu: '<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h14"/></svg>',
  };
  const DPAD_ICON = {
    up: '<svg viewBox="0 0 24 24"><path d="M12 6.5l6 11h-12z"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M12 17.5l-6-11h12z"/></svg>',
    left: '<svg viewBox="0 0 24 24"><path d="M6.5 12l11-6v12z"/></svg>',
    right: '<svg viewBox="0 0 24 24"><path d="M17.5 12l-11 6v-12z"/></svg>',
  };

  let keymap = null;
  let activeLayer = 0;          // configuration currently being edited
  let deviceActiveLayer = 0;    // configuration currently active on the device
  let dirty = false;            // unsaved keymap edits
  let logTimer = null;
  let statusTimer = null;
  let telemetryTimer = null;
  let savingKeymap = false;

  const $ = (id) => document.getElementById(id);

  /* ------------------------- helpers ------------------------- */

  function setConnected(on) {
    $("conn-dot").classList.toggle("on", on);
    $("conn-text").textContent = on ? "已连接" : "未连接";
    $("btn-connect").disabled = on;
    $("btn-disconnect").disabled = !on;
  }

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

  function updateDirtyIndicator() {
    const btn = $("btn-keymap-save");
    if (btn) btn.classList.toggle("dirty", dirty);
  }

  /* ------------------------- connection ------------------------- */

  async function connect() {
    try {
      await dev.connect();
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
    await dev.disconnect();
    setConnected(false);
    toast("已断开");
  }

  /* ------------------------- data ------------------------- */

  async function loadDeviceInfo() {
    try {
      $("device-info").textContent = JSON.stringify(await dev.deviceInfo(), null, 2);
    } catch (e) { /* ignore */ }
  }

  async function refreshStatus() {
    try {
      const s = await dev.status();
      $("st-firmware").textContent = s.firmware || "-";
      $("st-version").textContent = s.version || "-";
      $("st-build").textContent = s.build || "-";
      $("st-uptime").textContent = formatUptime(s.uptime_sec || 0);
      $("st-ble").textContent = ["未连接", "扫描中", "连接中", "已连接", "语音中"][s.ble_state] || s.ble_state;
      $("st-battery").textContent = (typeof s.battery === "number" && s.battery >= 0) ? s.battery + "%" : "未知";
      const devLayer = s.active_layer ?? 0;
      const activeMode = getLayer(devLayer);
      $("st-layer").textContent = activeMode ? configLabel(activeMode) : ("配置" + devLayer);
      if (devLayer !== deviceActiveLayer) {
        deviceActiveLayer = devLayer;
        if (keymap) renderLayerTabs();
      }
      $("st-frames").textContent = s.frames_decoded ?? 0;
      $("st-heap").textContent = formatBytes(s.free_heap);
      $("st-psram").textContent = formatBytes(s.free_psram);
      if (s.version) {
        $("hdr-version").textContent = "固件 v" + s.version + (s.build ? " (" + s.build + ")" : "");
      }
    } catch (e) { /* ignore */ }
  }

  async function refreshTelemetry() {
    try {
      const t = await dev.telemetry();
      const pk = PHYSICAL_KEYS.find((k) => k.vk === t.pressed_vk);
      const nameEl = $("live-key-name");
      nameEl.textContent = pk ? pk.name : "—";
      nameEl.classList.toggle("active", !!pk);

      // Highlight the pressed key on the remote image (keymap tab).
      document.querySelectorAll(".remote .pressed").forEach((el) => el.classList.remove("pressed"));
      if (pk) {
        const el = document.querySelector(`.remote [data-vk="${pk.vk}"]`);
        if (el) el.classList.add("pressed");
      }

      const layer = getLayer(t.active_layer ?? 0);
      $("live-layer").textContent = layer ? configLabel(layer) : ("配置" + (t.active_layer ?? 0));
      const at = t.action_type ?? 0;
      $("live-action").textContent = ACTION[at] || ("类型" + at);
      $("live-codes").textContent = formatTelemetryCodes(t);
      $("live-duration").textContent = (t.duration_ms || 0) + " ms";
      $("telemetry").textContent = JSON.stringify(t, null, 2);
    } catch (e) { /* ignore */ }
  }

  function formatTelemetryCodes(t) {
    const mod = t.modifier || 0, key = t.key_code || 0, cons = t.consumer_code || 0;
    const parts = [];
    if (mod) parts.push("mod 0x" + mod.toString(16));
    if (key) parts.push("key 0x" + key.toString(16));
    if (cons) parts.push("cons 0x" + cons.toString(16));
    return parts.length ? parts.join(" ") : "—";
  }

  async function refreshBleInfo() {
    try {
      $("ble-info").textContent = JSON.stringify(await dev.bleInfo(), null, 2);
    } catch (e) { /* ignore */ }
  }

  async function scanBle() {
    const tbody = $("ble-table").querySelector("tbody");
    tbody.innerHTML = "<tr><td colspan='4'>扫描中...</td></tr>";
    try {
      const res = await dev.bleScan();
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
            await dev.bleConnect({ mac: d.mac, type: d.type, name: d.name });
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

  async function refreshLogs() {
    try {
      const res = await dev.getLogs();
      $("log-view").textContent = (res.logs || []).join("\n");
      $("log-view").scrollTop = $("log-view").scrollHeight;
    } catch (e) { /* ignore */ }
  }

  /* ------------------------- keymap ------------------------- */

  async function loadKeymap(preserveLayer) {
    try {
      keymap = await dev.getKeymap();
      deviceActiveLayer = keymap.active_layer || 0;
      if (!preserveLayer || !(keymap.layers || []).some((l) => l.id === activeLayer)) {
        activeLayer = deviceActiveLayer;
      }
      dirty = false;
      updateDirtyIndicator();
      renderLayerTabs();
      renderKeymapGrid();
      $("raw-json").value = JSON.stringify(keymap, null, 2);
    } catch (e) {
      toast("读取按键配置失败: " + e.message, true);
    }
  }

  async function saveKeymap() {
    if (savingKeymap) return;
    savingKeymap = true;
    const btn = $("btn-keymap-save");
    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "保存中...";
    try {
      const res = await dev.saveKeymap(keymap);
      if (res && res.error) {
        toast("保存失败: " + res.error, true);
        return;
      }
      toast("按键配置已保存");
      dirty = false;
      if (dev.isConnected()) {
        try { await dev.setLayer(activeLayer); } catch (e) { /* ignore */ }
      }
      await loadKeymap(true);
    } catch (e) {
      console.error(e);
      toast("保存失败: " + e.message, true);
    } finally {
      savingKeymap = false;
      btn.disabled = false;
      btn.textContent = oldText;
      updateDirtyIndicator();
    }
  }

  async function resetKeymap() {
    if (!confirm("确定恢复出厂按键配置？")) return;
    try {
      await dev.resetKeymap();
      toast("已恢复出厂配置");
      await loadKeymap();
    } catch (e) {
      toast(e.message, true);
    }
  }

  function getLayer(idx) {
    return keymap && keymap.layers ? keymap.layers.find((l) => l.id === idx) : null;
  }
  // Display label for a configuration slot. Normalizes legacy "层N" / "模式N"
  // names to "配置N" and strips any stray leading/trailing whitespace.
  function configLabel(layer) {
    const raw = String((layer && layer.name) || "").trim();
    if (!raw) return "配置" + (layer ? layer.id : 0);
    return raw
      .replace(/默认层/g, "默认配置")
      .replace(/默认模式/g, "默认配置")
      .replace(/^层\s*(\d+)$/, "配置$1")
      .replace(/^模式\s*(\d+)$/, "配置$1");
  }
  function getBinding(layer, vk) {
    if (!layer || !layer.bindings) return null;
    return layer.bindings.find((b) => b.source_vk === vk) || null;
  }
  function ensureBinding(layer, vk) {
    if (!layer.bindings) layer.bindings = [];
    let b = getBinding(layer, vk);
    if (!b) { b = { source_vk: vk }; layer.bindings.push(b); }
    return b;
  }

  function renderLayerTabs() {
    const host = $("layer-tabs");
    host.innerHTML = "";
    (keymap.layers || []).forEach((layer) => {
      const btn = document.createElement("button");
      let cls = "layer-tab";
      if (layer.id === activeLayer) cls += " active";
      if (layer.id === deviceActiveLayer) cls += " device-active";
      btn.className = cls;
      btn.textContent = configLabel(layer);
      btn.title = layer.id === deviceActiveLayer ? "设备当前生效的配置" : "点击切换到该配置";
      btn.onclick = () => {
        activeLayer = layer.id;
        renderLayerTabs();
        renderKeymapGrid();
        // Selecting a configuration also makes it active on the device.
        if (dev.isConnected()) {
          dev.setLayer(layer.id).then(() => {
            deviceActiveLayer = layer.id;
            renderLayerTabs();
            refreshStatus();
          }).catch(() => {});
        }
      };
      host.appendChild(btn);
    });
  }

  function actionSummary(b, prefix) {
    const type = b["has_" + prefix] ? (b[prefix + "_type"] ?? 0) : 0;
    if (!type) return null;
    let text = ACTION[type] || ("类型" + type);
    if (type === 1 || type === 2) {
      return `${text} (mod 0x${(b[prefix + "_mod"] || 0).toString(16)} key 0x${(b[prefix + "_key"] || 0).toString(16)})`;
    }
    if (type === 4) return `${text} (0x${(b[prefix + "_cons"] || 0).toString(16)})`;
    if (type === 7) return `${text} (0x${(b[prefix + "_mod"] || 0).toString(16)}, 0x${(b[prefix + "_key"] || 0).toString(16)})`;
    if (type === 9) return `${text} → 配置 ${b[prefix + "_layer"] ?? 0}`;
    if (type === 11 || type === 12 || type === 13) {
      const btn = MOUSE_BUTTONS.find(([v]) => v === (b[prefix + "_key"] || 0));
      return `${text} (${btn ? btn[1] : "0x" + (b[prefix + "_key"] || 0).toString(16)})`;
    }
    if (type === 14) {
      const dx = b[prefix + "_dx"] || 0, dy = b[prefix + "_dy"] || 0;
      const dir = dx < 0 ? "左" : dx > 0 ? "右" : dy < 0 ? "上" : dy > 0 ? "下" : "—";
      const spd = Math.max(Math.abs(dx), Math.abs(dy));
      return `${text} (${dir}${spd ? " 速度" + spd : ""})`;
    }
    if (type === 15) return `${text} (${b[prefix + "_wheel"] || 0})`;
    return text;
  }

  function pkOf(vk) {
    return PHYSICAL_KEYS.find((k) => k.vk === vk);
  }
  function keyAction(layer, vk) {
    const b = getBinding(layer, vk);
    if (!b) return "未配置";
    const parts = [];
    const c = actionSummary(b, "click");
    const l = actionSummary(b, "long");
    const d = actionSummary(b, "double");
    if (c) parts.push(c);
    if (l) parts.push("长按 " + l);
    if (d) parts.push("双击 " + d);
    if (b.has_repeat) parts.push("连发");
    return parts.length ? parts.join(" · ") : "未配置";
  }
  function bindBtn(btn, layer, vk) {
    const pk = pkOf(vk);
    const b = getBinding(layer, vk);
    btn.dataset.vk = String(vk);
    btn.classList.toggle("key-configured", !!(b && (b.has_click || b.has_long || b.has_double)));
    const show = () => {
      const el = $("remote-info");
      if (el) el.innerHTML = `<b>${pk.name}</b> · ${keyAction(layer, vk)}`;
    };
    const reset = () => {
      const el = $("remote-info");
      if (el) el.textContent = "将鼠标移到按键上查看映射";
    };
    btn.title = `${pk.name}：${keyAction(layer, vk)}`;
    btn.onclick = () => openEditor(pk);
    btn.addEventListener("mouseenter", show);
    btn.addEventListener("focus", show);
    btn.addEventListener("mouseleave", reset);
    btn.addEventListener("blur", reset);
    return btn;
  }

  function renderKeymapGrid() {
    const host = $("keymap-grid");
    host.innerHTML = "";
    const layer = getLayer(activeLayer);
    if (!layer) return;
    host.className = "remote";

    // Top: power (left) / voice (right)
    const top = document.createElement("div");
    top.className = "remote-top";
    [[0x66, ICON.power], [0x04, ICON.voice]].forEach(([vk, icon]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "utility";
      btn.innerHTML = icon;
      top.appendChild(bindBtn(btn, layer, vk));
    });
    host.appendChild(top);

    // D-pad: four quarter-ring direction keys around a filled center OK
    const dpad = document.createElement("div");
    dpad.className = "dpad";
    [
      ["up", 0x52, DPAD_ICON.up],
      ["right", 0x4f, DPAD_ICON.right],
      ["down", 0x51, DPAD_ICON.down],
      ["left", 0x50, DPAD_ICON.left],
    ].forEach(([cls, vk, icon]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "arc " + cls;
      btn.innerHTML = icon;
      dpad.appendChild(bindBtn(btn, layer, vk));
    });
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "dp ok";
    dpad.appendChild(bindBtn(ok, layer, 0x28));
    host.appendChild(dpad);

    // Controls: back | volume (2 rows) / home / menu | TV
    const controls = document.createElement("div");
    controls.className = "remote-controls";
    const round = (vk, cls, inner) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = cls;
      btn.innerHTML = inner;
      return bindBtn(btn, layer, vk);
    };
    const volume = document.createElement("div");
    volume.className = "volume";
    [["＋", 0x80], ["−", 0x81]].forEach(([glyph, vk]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = glyph;
      volume.appendChild(bindBtn(btn, layer, vk));
    });
    controls.append(
      round(0xf1, "round back", ICON.back),
      volume,
      round(0x24, "round home", ICON.home),
      round(0x5d, "round menu", ICON.menu),
      round(0xc0, "round tv", "<span>TV</span>")
    );
    host.appendChild(controls);
  }

  /* ------------------------- action editor ------------------------- */

  let editingKey = null;
  let editingGesture = 0;   // 0=click 1=long 2=double 3=repeat

  // One-click presets applied to the currently selected gesture.
  const PRESETS = [
    { g: "键盘", items: [
      { label: "Enter", type: 1, key: 0x28 },
      { label: "Esc", type: 1, key: 0x29 },
      { label: "Tab", type: 1, key: 0x2b },
      { label: "空格", type: 1, key: 0x2c },
      { label: "↑", type: 1, key: 0x52 },
      { label: "↓", type: 1, key: 0x51 },
      { label: "←", type: 1, key: 0x50 },
      { label: "→", type: 1, key: 0x4f },
      { label: "Win+D", type: 1, key: 0x07, mod: 0x08 },
    ]},
    { g: "多媒体", items: [
      { label: "返回", type: 4, cons: 0x224 },
      { label: "主页", type: 4, cons: 0x223 },
      { label: "音量+", type: 4, cons: 0xe9 },
      { label: "音量-", type: 4, cons: 0xea },
      { label: "静音", type: 4, cons: 0xe2 },
      { label: "播放/暂停", type: 4, cons: 0xcd },
      { label: "上一曲", type: 4, cons: 0xb6 },
      { label: "下一曲", type: 4, cons: 0xb5 },
    ]},
    { g: "鼠标", items: [
      { label: "左键", type: 11, mouseBtn: 1 },
      { label: "右键", type: 11, mouseBtn: 2 },
      { label: "中键", type: 11, mouseBtn: 4 },
      { label: "移动↑", type: 14, dir: "up", speed: 8 },
      { label: "移动↓", type: 14, dir: "down", speed: 8 },
      { label: "移动←", type: 14, dir: "left", speed: 8 },
      { label: "移动→", type: 14, dir: "right", speed: 8 },
      { label: "滚轮↑", type: 15, wheel: 3 },
      { label: "滚轮↓", type: 15, wheel: -3 },
    ]},
  ];

  function setGesture(idx) {
    editingGesture = idx;
    document.querySelectorAll("#gesture-tabs .gesture-tab").forEach((t) => {
      t.classList.toggle("active", parseInt(t.dataset.gesture, 10) === idx);
    });
    document.querySelectorAll("#modal-body .action-block").forEach((blk, i) => {
      blk.classList.toggle("hidden", i !== idx);
    });
    const bar = $("preset-bar");
    if (bar) bar.classList.toggle("hidden", idx === 3);
  }

  function renderPresets() {
    const host = $("preset-bar");
    if (!host) return;
    host.innerHTML = PRESETS.map((grp) =>
      `<div class="preset-group"><span class="preset-label">${grp.g}</span>` +
      grp.items.map((p, i) => `<button type="button" class="preset" data-g="${grp.g}" data-i="${i}">${p.label}</button>`).join("") +
      `</div>`
    ).join("");
    host.querySelectorAll(".preset").forEach((btn) => {
      const grp = PRESETS.find((g) => g.g === btn.dataset.g);
      const p = grp && grp.items[parseInt(btn.dataset.i, 10)];
      if (p) btn.onclick = () => applyPreset(p);
    });
  }

  function applyPreset(p) {
    const block = document.querySelectorAll("#modal-body .action-block")[editingGesture];
    if (!block) return;
    const set = (sel, val) => { const el = block.querySelector(sel); if (el) el.value = String(val); };
    set(".f-type", p.type);
    if (p.key != null) { set(".f-key", p.key); set(".f-keynum", p.key); }
    if (p.cons != null) { set(".f-cons", p.cons); set(".f-consnum", p.cons); }
    if (p.layer != null) set("input.f-layer", p.layer);
    if (p.mouseBtn != null) set(".f-mousebtn", p.mouseBtn);
    if (p.dir != null) { set(".f-move-dir", p.dir); set(".f-move-speed", p.speed ?? 8); }
    if (p.wheel != null) set("input.f-wheel", p.wheel);
    block.querySelectorAll(".f-mod").forEach((c) => {
      c.checked = p.mod != null && (parseInt(c.value, 10) & p.mod) !== 0;
    });
    if (editingGesture !== 0) {
      const has = block.querySelector(".f-has");
      if (has) has.checked = true;
    }
    refreshFieldVisibility();
  }

  function actionTypeOptions(selected) {
    const allowed = [0, 1, 2, 4, 7, 9, 10, 11, 12, 13, 14, 15];
    return allowed.map((t) => `<option value="${t}" ${t === selected ? "selected" : ""}>${ACTION[t]}</option>`).join("");
  }

  function renderActionFields(prefix, b) {
    const has = b["has_" + prefix] ? "checked" : "";
    const type = b[prefix + "_type"] ?? 0;
    const mod = b[prefix + "_mod"] ?? 0;
    const key = b[prefix + "_key"] ?? 0;
    const cons = b[prefix + "_cons"] ?? 0;
    const layer = b[prefix + "_layer"] ?? 0;
    const wheel = b[prefix + "_wheel"] ?? 0;
    const mdx = b[prefix + "_dx"] ?? 0;
    const mdy = b[prefix + "_dy"] ?? 0;
    let moveDir = "up";
    if (mdx < 0) moveDir = "left";
    else if (mdx > 0) moveDir = "right";
    else if (mdy < 0) moveDir = "up";
    else if (mdy > 0) moveDir = "down";
    const moveSpeed = Math.max(Math.abs(mdx), Math.abs(mdy)) || 8;
    const ms = b[prefix + "_ms"] ?? (prefix === "long" ? 600 : 250);

    const usageOptions = HID_GROUPS.map(([g, items]) =>
      `<optgroup label="${g}">` + items.map(([v, n]) =>
        `<option value="${v}" ${v === key ? "selected" : ""}>${n}</option>`).join("") + `</optgroup>`
    ).join("");
    const consumerOptions = CONSUMER_GROUPS.map(([g, items]) =>
      `<optgroup label="${g}">` + items.map(([v, n]) =>
        `<option value="${v}" ${v === cons ? "selected" : ""}>${n}</option>`).join("") + `</optgroup>`
    ).join("");
    const mouseButtonOptions = MOUSE_BUTTONS.map(([v, n]) =>
      `<option value="${v}" ${v === key ? "selected" : ""}>${n}</option>`).join("");
    const modChecks = MOD_BITS.map(([bit, name]) =>
      `<label class="check"><input type="checkbox" class="f-mod" value="${bit}" ${(mod & bit) ? "checked" : ""}/>${name}</label>`
    ).join("");

    return `
      <div class="action-block" data-prefix="${prefix}">
        <h4>${prefix === "click" ? "单击" : prefix === "long" ? "长按" : "双击"}
          ${prefix !== "click" ? `<label class="check" style="float:right"><input type="checkbox" class="f-has" ${has}/> 启用</label>` : ""}
        </h4>
        <div class="inline">
          <div class="field"><label>动作类型</label><select class="f-type">${actionTypeOptions(type)}</select></div>
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
          <div class="field"><label>目标配置 (1-4)</label><input type="number" class="f-layer" value="${layer}" min="0" max="4"/></div>
        </div>
        <div class="f-mouse">
          <div class="field"><label>鼠标按键</label><select class="f-mousebtn">${mouseButtonOptions}</select></div>
        </div>
        <div class="f-move">
          <div class="inline">
            <div class="field"><label>移动方向</label><select class="f-move-dir">
              <option value="up" ${moveDir === "up" ? "selected" : ""}>上</option>
              <option value="down" ${moveDir === "down" ? "selected" : ""}>下</option>
              <option value="left" ${moveDir === "left" ? "selected" : ""}>左</option>
              <option value="right" ${moveDir === "right" ? "selected" : ""}>右</option>
            </select></div>
            <div class="field"><label>移动速度 (1-127)</label><input type="number" class="f-move-speed" value="${moveSpeed}" min="1" max="127"/></div>
          </div>
          <p class="hint">按住按键时按此方向持续移动，松开即停；速度越大移动越快。</p>
        </div>
        <div class="f-wheel">
          <div class="field"><label>滚轮 (-127 ~ 127，正数向上)</label><input type="number" class="f-wheel" value="${wheel}" min="-127" max="127"/></div>
        </div>
      </div>`;
  }

  function refreshFieldVisibility() {
    document.querySelectorAll(".action-block").forEach((block) => {
      const typeSel = block.querySelector(".f-type");
      if (!typeSel) return;
      const type = parseInt(typeSel.value, 10);
      block.querySelector(".f-keyboard").style.display = (type === 1 || type === 2 || type === 7) ? "block" : "none";
      block.querySelector(".f-consumer").style.display = (type === 4) ? "block" : "none";
      block.querySelector(".f-layer").style.display = (type === 9) ? "block" : "none";
      block.querySelector(".f-mouse").style.display = (type === 11 || type === 12 || type === 13) ? "block" : "none";
      block.querySelector(".f-move").style.display = (type === 14) ? "block" : "none";
      block.querySelector(".f-wheel").style.display = (type === 15) ? "block" : "none";
    });
  }

  function readActionFields(block) {
    const type = parseInt(block.querySelector(".f-type").value, 10);
    const hasBox = block.querySelector(".f-has");
    const has = hasBox ? hasBox.checked : true;
    let mod = 0;
    block.querySelectorAll(".f-mod").forEach((c) => { if (c.checked) mod |= parseInt(c.value, 10); });
    const keyNum = parseInt(block.querySelector(".f-keynum")?.value || "0", 10);
    const keySel = parseInt(block.querySelector(".f-key")?.value || "0", 10);
    const consNum = parseInt(block.querySelector(".f-consnum")?.value || "0", 10);
    const consSel = parseInt(block.querySelector(".f-cons")?.value || "0", 10);
    const moveDir = block.querySelector(".f-move-dir")?.value || "up";
    let moveSpeed = parseInt(block.querySelector(".f-move-speed")?.value || "8", 10);
    if (!(moveSpeed >= 1)) moveSpeed = 8;
    if (moveSpeed > 127) moveSpeed = 127;
    let mdx = 0, mdy = 0;
    if (moveDir === "up") mdy = -moveSpeed;
    else if (moveDir === "down") mdy = moveSpeed;
    else if (moveDir === "left") mdx = -moveSpeed;
    else if (moveDir === "right") mdx = moveSpeed;
    return {
      has,
      type,
      mod,
      key: keyNum || keySel,
      cons: consNum || consSel,
      layer: parseInt(block.querySelector("input.f-layer")?.value || "0", 10),
      mouseBtn: parseInt(block.querySelector(".f-mousebtn")?.value || "0", 10),
      dx: mdx,
      dy: mdy,
      wheel: parseInt(block.querySelector("input.f-wheel")?.value || "0", 10),
      ms: parseInt(block.querySelector(".f-ms")?.value || "0", 10),
    };
  }

  function openEditor(pk) {
    editingKey = pk;
    editingGesture = 0;
    const layer = getLayer(activeLayer);
    const b = getBinding(layer, pk.vk) || { source_vk: pk.vk };
    $("modal-title").textContent = `${pk.name} · ${configLabel(getLayer(activeLayer))}`;
    $("modal-body").innerHTML =
      `<div class="gesture-tabs" id="gesture-tabs">
         <button type="button" class="gesture-tab" data-gesture="0">单击</button>
         <button type="button" class="gesture-tab" data-gesture="1">长按</button>
         <button type="button" class="gesture-tab" data-gesture="2">双击</button>
         <button type="button" class="gesture-tab" data-gesture="3">连发</button>
       </div>
       <div class="preset-bar" id="preset-bar"></div>` +
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
    const configured = [!!b.has_click, !!b.has_long, !!b.has_double, !!b.has_repeat];
    document.querySelectorAll("#gesture-tabs .gesture-tab").forEach((t, i) => {
      if (configured[i]) t.classList.add("has-action");
      t.onclick = () => setGesture(parseInt(t.dataset.gesture, 10));
    });
    renderPresets();
    $("modal").classList.remove("hidden");
    refreshFieldVisibility();
    setGesture(0);
  }

  function applyEditor() {
    const layer = getLayer(activeLayer);
    const b = ensureBinding(layer, editingKey.vk);
    const blocks = document.querySelectorAll("#modal-body .action-block");
    ["click", "long", "double"].forEach((prefix, i) => {
      const cfg = readActionFields(blocks[i]);
      b["has_" + prefix] = cfg.type !== 0;
      b[prefix + "_type"] = cfg.type;
      // Clear every type-specific field so stale values (e.g. a leftover key
      // code) never leak into the new action.
      delete b[prefix + "_mod"];
      delete b[prefix + "_key"];
      delete b[prefix + "_cons"];
      delete b[prefix + "_layer"];
      delete b[prefix + "_dx"];
      delete b[prefix + "_dy"];
      delete b[prefix + "_wheel"];
      if (cfg.type === 1 || cfg.type === 2 || cfg.type === 7) {
        b[prefix + "_mod"] = cfg.mod;
        b[prefix + "_key"] = cfg.key;
      } else if (cfg.type === 4) {
        b[prefix + "_cons"] = cfg.cons;
      } else if (cfg.type === 9) {
        b[prefix + "_layer"] = cfg.layer;
      } else if (cfg.type === 11 || cfg.type === 12 || cfg.type === 13) {
        b[prefix + "_key"] = cfg.mouseBtn;
      } else if (cfg.type === 14) {
        b[prefix + "_dx"] = cfg.dx;
        b[prefix + "_dy"] = cfg.dy;
      } else if (cfg.type === 15) {
        b[prefix + "_wheel"] = cfg.wheel;
      }
      if (prefix !== "click") b[prefix + "_ms"] = cfg.ms;
      if (!b["has_" + prefix]) {
        delete b[prefix + "_type"];
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
      b.repeat_dx = b.click_dx || 0;
      b.repeat_dy = b.click_dy || 0;
      b.repeat_wheel = b.click_wheel || 0;
      b.repeat_delay_ms = parseInt($("rep-delay").value, 10);
      b.repeat_interval_ms = parseInt($("rep-interval").value, 10);
    } else {
      delete b.has_repeat;
      delete b.repeat_type;
      delete b.repeat_cons;
      delete b.repeat_dx;
      delete b.repeat_dy;
      delete b.repeat_wheel;
    }
    layer.bindings = layer.bindings.filter((x) => x.has_click || x.has_long || x.has_double);
    $("modal").classList.add("hidden");
    dirty = true;
    updateDirtyIndicator();
    renderKeymapGrid();
    toast("已修改，点击「保存到设备」生效");
  }

  /* ------------------------- auto refresh ------------------------- */

  function startAutoRefresh() {
    stopAutoRefresh();
    statusTimer = setInterval(refreshStatus, 2000);
    logTimer = setInterval(() => {
      if ($("log-auto").checked) refreshLogs();
    }, 3000);
    telemetryTimer = setInterval(() => {
      if ($("telemetry-live").checked) refreshTelemetry();
    }, 150);
  }
  function stopAutoRefresh() {
    clearInterval(statusTimer);
    clearInterval(logTimer);
    clearInterval(telemetryTimer);
    statusTimer = logTimer = telemetryTimer = null;
    const nameEl = $("live-key-name");
    if (nameEl) { nameEl.textContent = "—"; nameEl.classList.remove("active"); }
    document.querySelectorAll(".remote .pressed").forEach((el) => el.classList.remove("pressed"));
  }

  /* ------------------------- wiring ------------------------- */

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
    const webuiEl = $("webui-version");
    if (webuiEl) webuiEl.textContent = "WebUI v" + WEBUI_VERSION;
    if (!navigator.usb) $("unsupported").classList.remove("hidden");
    initTabs();

    dev.on("disconnect", () => { stopAutoRefresh(); setConnected(false); toast("设备已拔出", true); });

    $("btn-connect").onclick = connect;
    $("btn-disconnect").onclick = disconnect;
    $("btn-keymap-refresh").onclick = () => {
      if (dirty && !confirm("有未保存的修改，确定从设备重新读取？")) return;
      loadKeymap();
    };
    $("btn-keymap-save").onclick = saveKeymap;
    $("btn-keymap-reset").onclick = resetKeymap;
    $("btn-keymap-activate").onclick = async () => {
      try {
        await dev.setLayer(activeLayer);
        toast("已切换为配置 " + activeLayer);
        await refreshStatus();
      } catch (e) { toast(e.message, true); }
    };
    $("btn-ble-scan").onclick = scanBle;
    $("btn-ble-info").onclick = refreshBleInfo;
    $("btn-ble-unpair").onclick = async () => {
      if (!confirm("确定解除遥控器绑定？")) return;
      try { await dev.bleUnpair(); toast("已解除绑定"); refreshBleInfo(); }
      catch (e) { toast(e.message, true); }
    };
    $("btn-ble-reconnect").onclick = async () => {
      try { await dev.bleReconnect(); toast("正在重新连接..."); } catch (e) { toast(e.message, true); }
    };
    $("btn-logs-refresh").onclick = refreshLogs;
    $("btn-logs-clear").onclick = async () => {
      try { await dev.clearLogs(); refreshLogs(); } catch (e) { toast(e.message, true); }
    };
    $("btn-restart").onclick = async () => {
      if (!confirm("确定重启设备？")) return;
      try { await dev.restart(); toast("设备正在重启..."); } catch (e) { toast(e.message, true); }
    };
    $("btn-nvs-reset").onclick = async () => {
      if (!confirm("确定恢复出厂设置？将清除所有配置与绑定。")) return;
      try { await dev.factoryReset(); toast("已恢复出厂，设备重启中..."); } catch (e) { toast(e.message, true); }
    };
    $("btn-json-load").onclick = () => loadKeymap();
    $("btn-json-apply").onclick = async () => {
      try {
        keymap = JSON.parse($("raw-json").value);
        await dev.saveKeymap(keymap);
        toast("JSON 已写入设备");
        await loadKeymap();
      } catch (e) {
        toast("JSON 无效: " + e.message, true);
      }
    };

    $("modal-close").onclick = $("modal-cancel").onclick = () => $("modal").classList.add("hidden");
    $("modal-apply").onclick = applyEditor;
    $("modal-clear").onclick = () => {
      const layer = getLayer(activeLayer);
      if (layer) layer.bindings = (layer.bindings || []).filter((x) => x.source_vk !== editingKey.vk);
      $("modal").classList.add("hidden");
      dirty = true;
      updateDirtyIndicator();
      renderKeymapGrid();
      toast("已清除该按键，点击「保存到设备」生效");
    };
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

    setConnected(false);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
