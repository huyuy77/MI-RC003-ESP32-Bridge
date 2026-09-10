# MIRC003 Bridge · WebUI JavaScript API

`assets/mirc003.js` 是一个无依赖的浏览器端库，封装了与 MIRC003 Bridge 固件之间的
WebUSB 通信协议。第三方可以**只写自己的 HTML/JS**，引入该库后调用其 API，
完全替换默认的 `assets/app.js`。

- 库文件：[`assets/mirc003.js`](./assets/mirc003.js)
- 默认实现示例：[`assets/app.js`](./assets/app.js)
- 本地运行：`python -m http.server 8000`，访问 <http://localhost:8000/>

---

## 1. 引入与快速开始

```html
<script src="assets/mirc003.js"></script>
<script>
  const dev = new Mirc003();

  async function run() {
    await dev.connect();                 // 弹出设备选择框，用户选择 MIRC003 Remote Bridge
    const s = await dev.status();        // 读取状态
    console.log(s.firmware, s.version, s.uptime_sec);

    const keymap = await dev.getKeymap();
    // ...修改 keymap...
    await dev.saveKeymap(keymap);        // 保存（分块上传 + 落盘）
  }
</script>
```

> WebUSB 需要**安全上下文**：`https://` 或 `http://localhost`。
> 桌面版 Chrome / Edge 支持，移动端浏览器不支持。

---

## 2. 常量

所有常量挂在 `Mirc003` 上（如 `Mirc003.CMD`）。

### `Mirc003.CMD` — 命令字

| 键 | 值 | 说明 |
| :--- | :--- | :--- |
| `DEVICE_INFO` | `0x50` | 设备信息 |
| `STATUS` | `0x01` | 运行状态 |
| `LOGS_GET` | `0x02` | 读取日志 |
| `LOGS_CLEAR` | `0x03` | 清空日志 |
| `KEYMAP_GET` | `0x10` | 读取按键映射 |
| `KEYMAP_SAVE` | `0x11` | 单帧保存（兼容旧接口） |
| `KEYMAP_RESET` | `0x12` | 恢复默认按键 |
| `KEYMAP_TELEMETRY` | `0x13` | 最近按键遥测 |
| `KEYMAP_BEGIN` | `0x15` | 分块上传开始 |
| `KEYMAP_DATA` | `0x16` | 分块上传数据 |
| `KEYMAP_COMMIT` | `0x17` | 分块上传提交 |
| `BLE_SCAN` | `0x20` | 扫描蓝牙 |
| `BLE_CONNECT` | `0x21` | 连接指定设备 |
| `BLE_UNPAIR` | `0x22` | 解除绑定 |
| `BLE_INFO` | `0x23` | 已绑定信息 |
| `BLE_RECONNECT` | `0x24` | 重新连接 |
| `NVS_RESET` | `0x31` | 恢复出厂（清空 NVS） |
| `SYSTEM_RESTART` | `0x40` | 重启设备 |

### `Mirc003.ACTION` — 动作类型

```js
{ 0:"无", 1:"键盘-单击", 2:"键盘-按住", 3:"键盘-释放",
  4:"多媒体-单击", 5:"多媒体-按住", 6:"多媒体-释放",
  7:"语音", 8:"语音释放", 9:"切换层级", 10:"穿透继承" }
```

### `Mirc003.PHYSICAL_KEYS` — 遥控器物理按键

```js
[ { vk: 0x66, name: "电源键" }, { vk: 0x04, name: "语音键" }, ... ]
```

`vk` 为绑定中的 `source_vk`（内部规范化键码）。

### `Mirc003.MOD_BITS` — 键盘修饰键位

```js
[ [0x01,"左Ctrl"], [0x02,"左Shift"], [0x04,"左Alt"], [0x08,"左Win"],
  [0x10,"右Ctrl"], [0x20,"右Shift"], [0x40,"右Alt"], [0x80,"右Win"] ]
```

### `Mirc003.HID_GROUPS` / `Mirc003.CONSUMER_GROUPS` — 键码分组

供构建下拉框使用，格式为 `[组名, [[usage, 名称], ...]]`：

```js
Mirc003.HID_GROUPS      // 键盘：字母/数字/常用/符号/F1-F24/导航/小键盘
Mirc003.CONSUMER_GROUPS // 多媒体：媒体/音量/系统/浏览器
```

---

## 3. `Mirc003` 类

### 构造

```js
const dev = new Mirc003(options);
```

| 选项 | 类型 | 默认 | 说明 |
| :--- | :--- | :--- | :--- |
| `vendorId` | number | `0x303A` | 匹配的 USB VID |
| `productId` | number | `0x8302` | 匹配的 USB PID |
| `saveChunk` | number | `64` | 保存时每个分块字节数 |

### 连接

| 方法 | 返回 | 说明 |
| :--- | :--- | :--- |
| `connect()` | `Promise<Mirc003>` | 弹出选择框、打开设备并占用 WebUSB 厂商接口 |
| `disconnect()` | `Promise<void>` | 关闭设备 |
| `isConnected()` | `boolean` | 是否已连接 |

### 事件

```js
dev.on("connect",    (info) => {});  // info = { outEndpoint, inEndpoint }
dev.on("disconnect", ()     => {});
dev.on("error",      (err)  => {});
dev.off("disconnect", handler);
```

> 设备被拔出时会触发 `disconnect`。

### 设备 / 状态

| 方法 | 返回 | 说明 |
| :--- | :--- | :--- |
| `deviceInfo()` | `Promise<object>` | `{ name, version, build, hardware, protocol, capabilities[] }` |
| `status()` | `Promise<object>` | `{ firmware, version, build, uptime_sec, ble_state, active_layer, frames_decoded, samples_pushed, free_heap, free_psram, usb_mounted }` |
| `telemetry()` | `Promise<object>` | 最近一次按键事件 |

`ble_state`：`0` 未连接 / `1` 扫描中 / `2` 连接中 / `3` 已连接 / `4` 语音中。

### 按键映射

| 方法 | 返回 | 说明 |
| :--- | :--- | :--- |
| `getKeymap()` | `Promise<Keymap>` | 读取完整多层配置 |
| `saveKeymap(keymap)` | `Promise<object>` | 保存（内部走 `KEYMAP_BEGIN/DATA/COMMIT` 分块上传） |
| `resetKeymap()` | `Promise<object>` | 恢复出厂按键 |

`Keymap` 结构见第 4 节。

### 蓝牙

| 方法 | 参数 | 返回 |
| :--- | :--- | :--- |
| `bleScan()` | — | `Promise<{ devices: [{ name, mac, rssi, type }] }>` |
| `bleConnect(target)` | `{ mac, type, name }` | `Promise<object>` |
| `bleUnpair()` | — | `Promise<object>` |
| `bleInfo()` | — | `Promise<{ connected, state, name, mac, bound_mac, bound_name }>` |
| `bleReconnect()` | — | `Promise<object>` |

### 日志 / 系统

| 方法 | 返回 | 说明 |
| :--- | :--- | :--- |
| `getLogs()` | `Promise<{ logs: string[] }>` | 最近日志 |
| `clearLogs()` | `Promise<object>` | 清空日志 |
| `restart()` | `Promise<object>` | 重启设备 |
| `factoryReset()` | `Promise<object>` | 清空 NVS 并重启 |

### 底层

```js
dev.send(cmd, payloadObj?, rawBytes?)
```

- `payloadObj` 会被 `JSON.stringify` 后作为负载；
- `rawBytes`（`Uint8Array`）优先，作为原始负载（如 `KEYMAP_DATA`）；
- 所有调用**自动串行化**（同一时刻只有一个请求在途）；
- 返回解析后的 JSON 对象；`status != 0` 时 reject。

---

## 4. 按键映射（Keymap）JSON 结构

```jsonc
{
  "active_layer": 0,
  "layers": [
    {
      "id": 0,                 // 0..4
      "name": "默认层",
      "type": 0,               // 0=永久 1=一次性 2=超时
      "timeout": 15,           // type=2 时的超时秒数
      "color": "0x00FF00",     // 该层指示灯颜色 RGB
      "bindings": [
        {
          "source_vk": 40,     // 物理键码（见 PHYSICAL_KEYS）
          "has_click": true,
          "click_type": 1,     // 动作类型，见 ACTION
          "click_mod": 64,     // 修饰键位（键盘动作）
          "click_key": 54,     // HID 键码（键盘动作）
          "click_cons": 233,   // 多媒体码（多媒体动作）
          "click_layer": 2,    // 目标层（切换层级动作）
          "has_long": true, "long_ms": 600, "long_type": 4, "long_cons": 205,
          "has_double": false, "double_ms": 250, "double_type": 1, "double_key": 44,
          "has_repeat": true, "repeat_type": 4, "repeat_cons": 233,
          "repeat_delay_ms": 350, "repeat_interval_ms": 70
        }
      ]
    }
  ]
}
```

字段说明：

- `has_click` / `has_long` / `has_double`：是否启用对应手势。
- 动作字段前缀：`click_` / `long_` / `double_`，后缀含义：
  - `_type`：动作类型（见 `ACTION`）。
  - `_mod` / `_key`：键盘修饰键与 HID 键码（键盘类动作）。
  - `_cons`：USB Consumer 多媒体码（多媒体类动作）。
  - `_layer`：目标层（切换层级动作）。
  - `_ms`：长按/双击判定时间（仅 long/double）。
- `has_repeat`：连发（音量键常用）；`repeat_*` 同前缀规则。
- `type=10`（穿透继承）：该动作沿用默认层的设置。
- 非默认层未配置的按键自动继承默认层。

---

## 5. WebUSB 通信协议（底层）

库已封装，如需自行实现可参考：

**请求帧（主机 → 设备）**

```text
0     1     2     3        4-5          6..N
'M'   'R'   cmd   rsvd     len (LE16)   payload (UTF-8 / JSON)
```

**响应帧（设备 → 主机）**

```text
0     1     2     3        4-5          6..N
'M'   'R'   cmd   status   len (LE16)   payload
```

- `status == 0` 表示成功。
- 厂商接口：USB class `0xFF`，BULK OUT / BULK IN 端点由浏览器自动识别。
- 大负载（如保存按键）建议分块发送（库已用 `KEYMAP_BEGIN/DATA/COMMIT` 实现）。

---

## 6. 自定义 UI 示例

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>My MIRC003 UI</title></head>
<body>
  <button id="conn">连接</button>
  <button id="save">保存默认映射</button>
  <pre id="out"></pre>

  <script src="assets/mirc003.js"></script>
  <script>
    const dev = new Mirc003();
    const out = document.getElementById("out");
    const show = (o) => out.textContent = JSON.stringify(o, null, 2);

    dev.on("disconnect", () => show({ disconnected: true }));

    document.getElementById("conn").onclick = async () => {
      await dev.connect();
      show(await dev.status());
    };

    document.getElementById("save").onclick = async () => {
      const keymap = await dev.getKeymap();
      await dev.saveKeymap(keymap);
      show({ saved: true });
    };
  </script>
</body>
</html>
```

---

## 7. 错误处理

所有异步方法在失败时 reject，错误对象为 `Error`：

```js
try {
  await dev.connect();
} catch (e) {
  if (e.name === "NotFoundError") {
    // 用户取消了设备选择
  } else {
    console.error(e.message);
  }
}
```

- 用户取消选择：`NotFoundError: No device selected`。
- 设备返回非 0 状态：`设备返回错误 (status=N)`。
- 未连接时调用：`设备未连接`。

---

## 8. 兼容性

- 桌面版 Chrome / Edge（Windows / macOS / Linux）。
- 页面必须为安全上下文（HTTPS 或 `http://localhost`）。
- Windows 10/11 自动为厂商接口加载 WinUSB，无需 Zadig。
- Linux 需配置 udev 规则。
