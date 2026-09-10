/*
 * MIRC003 Bridge WebUSB client library
 * ------------------------------------
 * A small, dependency-free wrapper around the firmware's WebUSB vendor
 * protocol. Include this file and use the global `Mirc003` class to talk to
 * the device from any custom HTML page.
 *
 *   const dev = new Mirc003();
 *   await dev.connect();                 // user picks the device
 *   const s = await dev.status();
 *   await dev.saveKeymap(keymap);
 *
 * See doc.md for the full API reference.
 */
(function (global) {
  "use strict";

  var DEFAULT_VID = 0x303a;
  var DEFAULT_PID = 0x8302;

  // ---- WebUSB framing -----------------------------------------------------
  var SOF0 = 0x4d; // 'M'
  var SOF1 = 0x52; // 'R'
  var HEADER_LEN = 6;
  var READ_CHUNK = 64;

  // ---- Command opcodes (must match main/webusb/webusb_protocol.h) ---------
  var CMD = {
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

  // ---- Action types (keymap bindings) -------------------------------------
  var ACTION = {
    0: "无",
    1: "键盘-单击",
    2: "键盘-按住",
    3: "键盘-释放",
    4: "多媒体-单击",
    5: "多媒体-按住",
    6: "多媒体-释放",
    7: "语音",
    8: "语音释放",
    9: "切换层级",
    10: "穿透继承",
  };

  // ---- Physical remote keys (canonical source_vk values) ------------------
  var PHYSICAL_KEYS = [
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

  // ---- Modifier bitmasks --------------------------------------------------
  var MOD_BITS = [
    [0x01, "左Ctrl"], [0x02, "左Shift"], [0x04, "左Alt"], [0x08, "左Win"],
    [0x10, "右Ctrl"], [0x20, "右Shift"], [0x40, "右Alt"], [0x80, "右Win"],
  ];

  // ---- Keyboard HID usages (grouped) --------------------------------------
  var HID_GROUPS = [
    ["字母", [[0x04,"A"],[0x05,"B"],[0x06,"C"],[0x07,"D"],[0x08,"E"],[0x09,"F"],[0x0a,"G"],[0x0b,"H"],[0x0c,"I"],[0x0d,"J"],[0x0e,"K"],[0x0f,"L"],[0x10,"M"],[0x11,"N"],[0x12,"O"],[0x13,"P"],[0x14,"Q"],[0x15,"R"],[0x16,"S"],[0x17,"T"],[0x18,"U"],[0x19,"V"],[0x1a,"W"],[0x1b,"X"],[0x1c,"Y"],[0x1d,"Z"]]],
    ["数字", [[0x1e,"1 !"],[0x1f,"2 @"],[0x20,"3 #"],[0x21,"4 $"],[0x22,"5 %"],[0x23,"6 ^"],[0x24,"7 &"],[0x25,"8 *"],[0x26,"9 ("],[0x27,"0 )"]]],
    ["常用", [[0x28,"Enter 回车"],[0x29,"Esc"],[0x2a,"Backspace"],[0x2b,"Tab"],[0x2c,"Space 空格"],[0x39,"CapsLock"],[0x65,"Menu 菜单"]]],
    ["符号", [[0x2d,"- _"],[0x2e,"= +"],[0x2f,"[ {"],[0x30,"] }"],[0x31,"\\ |"],[0x33,"; :"],[0x34,"' \""],[0x35,"` ~"],[0x36,", <"],[0x37,". >"],[0x38,"/ ?"]]],
    ["功能键", [[0x3a,"F1"],[0x3b,"F2"],[0x3c,"F3"],[0x3d,"F4"],[0x3e,"F5"],[0x3f,"F6"],[0x40,"F7"],[0x41,"F8"],[0x42,"F9"],[0x43,"F10"],[0x44,"F11"],[0x45,"F12"],[0x68,"F13"],[0x69,"F14"],[0x6a,"F15"],[0x6b,"F16"],[0x6c,"F17"],[0x6d,"F18"],[0x6e,"F19"],[0x6f,"F20"],[0x70,"F21"],[0x71,"F22"],[0x72,"F23"],[0x73,"F24"]]],
    ["导航", [[0x49,"Insert"],[0x4a,"Home"],[0x4b,"PageUp"],[0x4c,"Delete"],[0x4d,"End"],[0x4e,"PageDown"],[0x4f,"方向→"],[0x50,"方向←"],[0x51,"方向↓"],[0x52,"方向↑"],[0x46,"PrintScreen"],[0x47,"ScrollLock"],[0x48,"Pause"]]],
    ["小键盘", [[0x53,"NumLock"],[0x54,"/"],[0x55,"*"],[0x56,"-"],[0x57,"+"],[0x58,"Num Enter"],[0x59,"1"],[0x5a,"2"],[0x5b,"3"],[0x5c,"4"],[0x5d,"5"],[0x5e,"6"],[0x5f,"7"],[0x60,"8"],[0x61,"9"],[0x62,"0"],[0x63,"."]]],
  ];

  // ---- Consumer (media/system) usages (grouped) ---------------------------
  var CONSUMER_GROUPS = [
    ["媒体", [[0xcd,"播放/暂停"],[0xb5,"下一曲"],[0xb6,"上一曲"],[0xb7,"停止"],[0xb3,"快进"],[0xb4,"快退"]]],
    ["音量", [[0xe9,"音量+"],[0xea,"音量-"],[0xe2,"静音"]]],
    ["系统", [[0x30,"电源"],[0x32,"睡眠"],[0x183,"媒体选择"]]],
    ["浏览器", [[0x223,"浏览器主页"],[0x224,"浏览器返回"],[0x225,"浏览器前进"],[0x227,"浏览器刷新"],[0x221,"浏览器搜索"]]],
  ];

  /**
   * Create a client. Options (all optional):
   *   vendorId, productId  - USB IDs to match (defaults 0x303a / 0x8302)
   *   saveChunk            - bytes per KEYMAP_DATA chunk (default 64)
   */
  function Mirc003(options) {
    options = options || {};
    this.vendorId = options.vendorId != null ? options.vendorId : DEFAULT_VID;
    this.productId = options.productId != null ? options.productId : DEFAULT_PID;
    this.saveChunk = options.saveChunk || 64;

    this._device = null;
    this._out = null;
    this._in = null;
    this._rx = new Uint8Array(0);
    this._chain = Promise.resolve();
    this._handlers = {};
    this._usbDisconnect = null;
  }

  /* ------------------------- events ------------------------- */

  /** Subscribe to an event: "connect" | "disconnect" | "error". */
  Mirc003.prototype.on = function (event, cb) {
    (this._handlers[event] = this._handlers[event] || []).push(cb);
    return this;
  };

  /** Remove a previously added handler. */
  Mirc003.prototype.off = function (event, cb) {
    var list = this._handlers[event];
    if (list) this._handlers[event] = list.filter(function (f) { return f !== cb; });
    return this;
  };

  Mirc003.prototype._emit = function (event, data) {
    var list = this._handlers[event] || [];
    for (var i = 0; i < list.length; i++) {
      try { list[i](data); } catch (e) { console.error(e); }
    }
  };

  /* ------------------------- connection ------------------------- */

  /** True while a device is open and claimed. */
  Mirc003.prototype.isConnected = function () { return !!this._device; };

  /**
   * Ask the user to pick the device (WebUSB permission prompt), open it and
   * claim the vendor interface. Resolves with this client.
   */
  Mirc003.prototype.connect = function () {
    var self = this;
    if (!global.navigator || !navigator.usb) {
      return Promise.reject(new Error("当前浏览器不支持 WebUSB"));
    }
    var out = null, inp = null, vendorItf = -1;

    return navigator.usb
      .requestDevice({ filters: [{ vendorId: self.vendorId, productId: self.productId }] })
      .then(function (device) {
        self._device = device;
        return device.open();
      })
      .then(function () {
        if (self._device.configuration === null) return self._device.selectConfiguration(1);
      })
      .then(function () {
        var itfs = self._device.configuration.interfaces;
        for (var i = 0; i < itfs.length; i++) {
          var alts = itfs[i].alternates;
          for (var j = 0; j < alts.length; j++) {
            if (alts[j].interfaceClass === 0xff) {
              vendorItf = itfs[i].interfaceNumber;
              out = alts[j].endpoints.find(function (e) { return e.direction === "out"; });
              inp = alts[j].endpoints.find(function (e) { return e.direction === "in"; });
              break;
            }
          }
          if (vendorItf >= 0) break;
        }
        if (vendorItf < 0 || !out || !inp) throw new Error("未找到 WebUSB 厂商接口");
        return self._device.claimInterface(vendorItf);
      })
      .then(function () {
        self._out = out;
        self._in = inp;
        self._rx = new Uint8Array(0);
        self._usbDisconnect = function (e) {
          if (e.device === self._device) {
            self._device = null; self._out = null; self._in = null;
            self._emit("disconnect");
          }
        };
        navigator.usb.addEventListener("disconnect", self._usbDisconnect);
        self._emit("connect", {
          outEndpoint: out.endpointNumber,
          inEndpoint: inp.endpointNumber,
        });
        return self;
      })
      .catch(function (err) {
        if (self._device) { try { self._device.close(); } catch (e) {} }
        self._device = null; self._out = null; self._in = null;
        throw err;
      });
  };

  /** Close the device (no-op if not connected). */
  Mirc003.prototype.disconnect = function () {
    var self = this;
    var dev = this._device;
    this._device = null; this._out = null; this._in = null; this._rx = new Uint8Array(0);
    if (dev) {
      return dev.close().catch(function () {}).then(function () { self._emit("disconnect"); });
    }
    return Promise.resolve();
  };

  /* ------------------------- low level ------------------------- */

  Mirc003.prototype._buildFrame = function (cmd, payload) {
    var len = payload ? payload.length : 0;
    var frame = new Uint8Array(HEADER_LEN + len);
    frame[0] = SOF0; frame[1] = SOF1; frame[2] = cmd; frame[3] = 0;
    frame[4] = len & 0xff; frame[5] = (len >> 8) & 0xff;
    if (len) frame.set(payload, HEADER_LEN);
    return frame;
  };

  Mirc003.prototype._readFrame = function () {
    var self = this;
    function pump() {
      if (self._rx.length >= HEADER_LEN) {
        if (self._rx[0] === SOF0 && self._rx[1] === SOF1) {
          var len = self._rx[4] | (self._rx[5] << 8);
          if (self._rx.length >= HEADER_LEN + len) {
            var result = {
              cmd: self._rx[2],
              status: self._rx[3],
              payload: self._rx.slice(HEADER_LEN, HEADER_LEN + len),
            };
            self._rx = self._rx.slice(HEADER_LEN + len);
            return Promise.resolve(result);
          }
        } else {
          self._rx = self._rx.slice(1);
          return pump();
        }
      }
      return self._device.transferIn(self._in.endpointNumber, READ_CHUNK).then(function (r) {
        if (r.status !== "ok" || !r.data) throw new Error("USB 读取失败: " + r.status);
        var chunk = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
        var merged = new Uint8Array(self._rx.length + chunk.length);
        merged.set(self._rx, 0);
        merged.set(chunk, self._rx.length);
        self._rx = merged;
        return pump();
      });
    }
    return pump();
  };

  /**
   * Send a raw command. All calls are serialized (one outstanding request).
   * @param {number} cmd
   * @param {object|null} payloadObj  JSON-serialized payload
   * @param {Uint8Array|null} rawBytes raw payload (takes precedence)
   * @returns {Promise<object>} parsed JSON response
   */
  Mirc003.prototype.send = function (cmd, payloadObj, rawBytes) {
    var self = this;
    function run() { return self._send(cmd, payloadObj, rawBytes); }
    var p = this._chain.then(run, run);
    this._chain = p.catch(function () {});
    return p;
  };

  Mirc003.prototype._send = function (cmd, payloadObj, rawBytes) {
    if (!this._device || !this._out) return Promise.reject(new Error("设备未连接"));
    var payload = rawBytes
      ? rawBytes
      : (payloadObj ? new TextEncoder().encode(JSON.stringify(payloadObj)) : new Uint8Array(0));
    var frame = this._buildFrame(cmd, payload);
    return this._device.transferOut(this._out.endpointNumber, frame).then(this._readFrame.bind(this)).then(function (resp) {
      if (resp.status !== 0) throw new Error("设备返回错误 (status=" + resp.status + ")");
      var text = new TextDecoder().decode(resp.payload);
      return text ? JSON.parse(text) : {};
    });
  };

  /* ------------------------- high level API ------------------------- */

  Mirc003.prototype.deviceInfo = function () { return this.send(CMD.DEVICE_INFO); };
  Mirc003.prototype.status = function () { return this.send(CMD.STATUS); };
  Mirc003.prototype.telemetry = function () { return this.send(CMD.KEYMAP_TELEMETRY); };
  Mirc003.prototype.getKeymap = function () { return this.send(CMD.KEYMAP_GET); };
  Mirc003.prototype.resetKeymap = function () { return this.send(CMD.KEYMAP_RESET); };

  /** Persist a keymap object (the same shape returned by getKeymap()). */
  Mirc003.prototype.saveKeymap = function (keymap) {
    var self = this;
    var json = new TextEncoder().encode(JSON.stringify(keymap));
    var step = this.saveChunk;
    return this.send(CMD.KEYMAP_BEGIN).then(function () {
      function next(off) {
        if (off >= json.length) return self.send(CMD.KEYMAP_COMMIT);
        return self.send(CMD.KEYMAP_DATA, null, json.subarray(off, off + step)).then(function () {
          return next(off + step);
        });
      }
      return next(0);
    });
  };

  Mirc003.prototype.bleScan = function () { return this.send(CMD.BLE_SCAN); };
  Mirc003.prototype.bleConnect = function (target) { return this.send(CMD.BLE_CONNECT, target); };
  Mirc003.prototype.bleUnpair = function () { return this.send(CMD.BLE_UNPAIR); };
  Mirc003.prototype.bleInfo = function () { return this.send(CMD.BLE_INFO); };
  Mirc003.prototype.bleReconnect = function () { return this.send(CMD.BLE_RECONNECT); };

  Mirc003.prototype.getLogs = function () { return this.send(CMD.LOGS_GET); };
  Mirc003.prototype.clearLogs = function () { return this.send(CMD.LOGS_CLEAR); };

  Mirc003.prototype.restart = function () { return this.send(CMD.SYSTEM_RESTART); };
  Mirc003.prototype.factoryReset = function () { return this.send(CMD.NVS_RESET); };

  /* ------------------------- statics ------------------------- */
  Mirc003.CMD = CMD;
  Mirc003.ACTION = ACTION;
  Mirc003.PHYSICAL_KEYS = PHYSICAL_KEYS;
  Mirc003.MOD_BITS = MOD_BITS;
  Mirc003.HID_GROUPS = HID_GROUPS;
  Mirc003.CONSUMER_GROUPS = CONSUMER_GROUPS;

  global.Mirc003 = Mirc003;
})(window);
