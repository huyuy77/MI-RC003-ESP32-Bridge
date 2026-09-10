# MIRC003-bridge-esp32

基于 **ESP-IDF** 的 ESP32-S3 固件：将 **小米蓝牙遥控器 2 Pro（RC003）** 的按键与语音通过
USB 复合设备转发到 Windows，并使用 **浏览器 WebUSB** 完成设备配置。

> 本项目基于 [cuicui-V5/RemoteMapper-ESP32](https://github.com/cuicui-V5/RemoteMapper-ESP32)
> 的硬件桥接思路，参考 [HD838A/remote-mic-app](https://github.com/HD838A/remote-mic-app)
> 的 RC003 协议实现与按键/UI 设计，从 Arduino/PlatformIO 迁移到 **ESP-IDF**，
> 并将原先的 **Wi-Fi AP 热点 + HTTP 网页配置** 替换为 **WebUSB 浏览器直连配置**。

---

## 1. 项目亮点

| 能力 | RemoteMapper-ESP32（原版） | 本项目 |
| :--- | :--- | :--- |
| 开发框架 | Arduino + PlatformIO | **ESP-IDF v6.x** |
| BLE 协议栈 | NimBLE-Arduino | **ESP-IDF NimBLE Host** |
| USB 协议栈 | Arduino TinyUSB | **esp_tinyusb (TinyUSB)** |
| 配置方式 | Wi-Fi AP 热点 + 内置 HTTP 网页 | **浏览器 WebUSB 直连配置（无热点、无 IP）** |
| 配置页面 | 固件内嵌 145KB HTML | **独立静态站点 `webusb-config/`，可部署到任意 HTTPS 站点** |
| 按键映射 | 5 层 / 单击·长按·双击 | 保留并移植 |
| 语音麦克风 | UAC 1.0 + IMA-ADPCM | 保留并移植 |

### 它解决了什么

1. Windows 蓝牙键盘驱动会丢弃遥控器的 `音量+ (0x80)`、`音量- (0x81)`、`返回 (0xF1)` 等非标准键码。
2. 语音走私有 ATVV 协议，纯软件方案需要虚拟声卡。
3. 原版必须让 ESP32 开热点、用户切换 Wi-Fi 才能配置，体验割裂。

本项目让 ESP32-S3 作为硬件中间人：上游直连遥控器蓝牙，下游通过原生 USB 模拟标准
**UAC 1.0 麦克风 + HID 键盘/多媒体设备**；同时增加一个 **WebUSB 厂商接口**，
浏览器访问配置站点即可直接读写设备，无需 Wi-Fi、无需驱动。

---

## 2. 系统拓扑

```text
┌────────────────────────┐   BLE 5.0 (HOGP + ATVV)   ┌────────────────────────┐
│  小米蓝牙遥控器 2 Pro  │ ────────────────────────► │      ESP32-S3          │
│  (RC003)               │ ◄──────────────────────── │   (BLE Central)        │
└────────────────────────┘                           └───────────┬────────────┘
                                                                 │ USB 2.0 Full-Speed
                                                                 │ 复合设备
                                                                 ▼
                                                     ┌────────────────────────┐
                                                     │        PC / Windows    │
                                                     │ • UAC 1.0 麦克风       │
                                                     │ • HID 键盘 + 多媒体键  │
                                                     │ • WebUSB 配置接口 ◄────┼── 浏览器访问配置站点
                                                     └────────────────────────┘
```

USB 复合设备包含 4 个接口：

| 接口 | 类 | 端点 | 说明 |
| :--- | :--- | :--- | :--- |
| 0 / 1 | Audio (UAC 1.0) | ISO IN `0x81` | 16 kHz / 16-bit / 单声道麦克风 |
| 2 | HID | INT IN `0x82` | 键盘（Report ID 1）+ 多媒体（Report ID 2） |
| 3 | Vendor (WebUSB) | BULK OUT `0x03` / BULK IN `0x83` | 配置命令通道 |

---

## 3. 硬件要求

* **ESP32-S3 开发板**（推荐 16MB Flash + 8MB PSRAM，如 N16R8；4MB 版本需调整分区表）。
* 板载 WS2812 RGB 指示灯（默认 GPIO48，可在 `main/app_config.h` 修改 `RGB_BUILTIN`）。
* **小米蓝牙语音遥控器 2 Pro（型号 RC003）**。
* 两根 Type-C 数据线（或一根）：一根接 **USB/OTG** 口（必须，用于复合设备与 WebUSB），
  UART 口可选用于查看串口日志。

---

## 4. 编译与烧录（ESP-IDF v6.x）

### 4.1 环境准备

安装 [ESP-IDF v6.1](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/get-started/)
并激活环境（Windows PowerShell）：

```powershell
. "C:\Espressif\tools\Microsoft.v6.1.PowerShell_profile.ps1"
```

首次编译会自动通过 IDF Component Manager 下载依赖：
`espressif/esp_tinyusb`、`espressif/tinyusb`、`bblanchon/arduinojson`、`espressif/led_strip`。

### 4.2 设置目标并编译

```powershell
idf.py set-target esp32s3
idf.py build
```

### 4.3 烧录与监视

```powershell
idf.py -p COMx flash monitor
```

也可以直接运行仓库根目录脚本（Windows）：

```bat
build.bat        :: 编译
flash.bat COM5   :: 烧录（默认自动探测串口）
monitor.bat COM5 :: 串口监视
```

---

## 5. 配置站点（WebUSB）

配置页面位于 [`webusb-config/`](./webusb-config)，是一个**纯静态站点**，不依赖任何后端。

### 5.1 本地运行（推荐）

WebUSB 要求安全上下文，`http://localhost` 被视为安全来源：

```powershell
cd webusb-config
python -m http.server 8000
```

浏览器打开 <http://localhost:8000/>，点击「连接设备」，在弹出的设备列表中选择
`MIRC003 Remote Bridge`。

> 固件 BOS 描述符中的着陆页地址默认为 `http://localhost:8000/`，
> 可在 `main/version.h` 的 `WEBUSB_LANDING_URL` / `WEBUSB_LANDING_SCHEME` 中修改。

### 5.2 部署到公网（可选）

将 `webusb-config/` 目录部署到任意 **HTTPS** 站点（如 GitHub Pages），并同步修改
`WEBUSB_LANDING_URL` 与 `WEBUSB_LANDING_SCHEME`（`1` = https）后重新编译固件。

### 5.3 浏览器兼容性

* 桌面版 **Chrome / Edge**（Windows / macOS / Linux）支持 WebUSB。
* Android / iOS 浏览器**不支持** WebUSB。
* Windows 10/11 会自动为带 BOS 描述的厂商接口绑定 WinUSB，**无需 Zadig**。
* Linux 需要 udev 规则允许普通用户访问该设备。

配置页面包含：设备状态、按键映射（5 层可视化编辑）、蓝牙配对、运行日志、系统设置
与原始 JSON 导入导出。

---

## 6. WebUSB 通信协议

浏览器与设备之间通过厂商 BULK 端点传输带帧头的 JSON 数据。

**请求帧（主机 → 设备）**

```text
偏移  0     1     2     3        4-5          6..N
      'M'   'R'   cmd   rsvd     len (LE16)   payload (UTF-8 / JSON)
```

**响应帧（设备 → 主机）**

```text
偏移  0     1     2     3        4-5          6..N
      'M'   'R'   cmd   status   len (LE16)   payload
```

`status == 0` 表示成功。命令字与旧版 REST API 一一对应：

| cmd | 名称 | 说明 |
| :--- | :--- | :--- |
| `0x01` | STATUS | 运行状态 / 内存 / BLE 状态 / 当前层 |
| `0x02` `0x03` | LOGS_GET / CLEAR | 运行日志 |
| `0x10` `0x11` `0x12` `0x13` | KEYMAP_GET / SAVE / RESET / TELEMETRY | 多层级按键映射 |
| `0x20` `0x21` `0x22` `0x23` `0x24` | BLE_SCAN / CONNECT / UNPAIR / INFO / RECONNECT | 蓝牙配对管理 |
| `0x31` | NVS_RESET | 恢复出厂设置 |
| `0x40` | SYSTEM_RESTART | 重启设备 |
| `0x50` | DEVICE_INFO | 设备信息 |

---

## 7. 默认出厂按键映射

| 按键 | 键码 | 单击 | 长按 | 双击 |
| :--- | :--- | :--- | :--- | :--- |
| 电源键 | `0x66` | `Alt + Tab` | 系统休眠 | — |
| 语音键 | `0x04` | 麦克风推流 + `RAlt + ,` | 持续录音 | — |
| 方向上/下/左/右 | `0x52/51/50/4F` | 方向键 | — | — |
| 确定键 | `0x28` | 回车 | — | — |
| 返回键 | `0xF1` | 多媒体返回 | — | — |
| 主页键 | `0x24` | `Win + D` | — | — |
| 菜单键 | `0x5D` | 空格 | — | — |
| 音量 +/− | `0x80/0x81` | 音量调节（支持连发） | — | — |
| 电视键 | `0xC0` | `F8` | — | — |

所有映射均可在配置站点中自由修改；支持 5 个层级与单击/长按/双击/连发。

> 说明：RC003 的 HOGP 输入报文是「Report ID 1 + 3 个小端 16-bit 键盘 usage」。
> 固件会将其解析并归一化为上表的内部键码（例如 HID usage `0x4A/0x65/0x35` 分别
> 归一化为主页/菜单/电视键），同时兼容标准 8 字节键盘报文。

---

## 8. 项目结构

```text
MIRC003-bridge-esp32/
├── CMakeLists.txt
├── sdkconfig.defaults
├── partitions.csv
├── main/
│   ├── main.c                     # 初始化与任务
│   ├── app_config.h / version.h
│   ├── ble/ble_remote_client.*    # NimBLE Central: HOGP + ATVV
│   ├── audio/                     # IMA-ADPCM / AGC / 滤波 / 环形缓冲
│   ├── keymap/                    # 5 层按键状态机 + NVS 配置
│   ├── storage/config_store.*     # NVS 封装
│   ├── usb/
│   │   ├── usb_descriptors.*      # 设备/配置/BOS/WebUSB/HID 描述符
│   │   ├── uac_microphone.*       # 自定义 UAC 1.0 类驱动
│   │   ├── hid_bridge.*           # HID 键盘 + 多媒体发送
│   │   ├── webusb_transport.*     # 厂商端点帧协议
│   │   └── usb_composite.*
│   ├── webusb/webusb_protocol.cpp # WebUSB 命令分发
│   ├── led/led_indicator.*
│   └── log/app_log.*
└── webusb-config/                 # 浏览器配置站点（静态）
    ├── index.html
    └── assets/{app.js,style.css}
```

---

## 9. 常见问题

### Windows 设备管理器提示「代码 28 / 该设备的驱动程序未被安装」

本固件在 BOS 描述符中同时提供了 **WebUSB** 与 **Microsoft OS 2.0（WINUSB 兼容 ID）**
描述符，Windows 10/11 应自动为该厂商接口加载 `winusb.sys`。若仍出现代码 28：

1. 确认烧录的是最新固件（PID 已从 `0x8301` 改为 `0x8302`，以强制 Windows 重新识别）。
2. 打开「设备管理器」，卸载残留的旧设备（`VID_303A&PID_8301`）后「扫描检测硬件改动」。
3. 设备应出现在「通用串行总线设备 / WinUsb Device」下，而不是「其他设备」。
4. 无需 Zadig；Chrome / Edge 桌面版即可通过 WebUSB 访问。

### 串口日志出现 `NIMBLE_NVS: NVS data size mismatch`

这是因为之前烧录过 Arduino 版 RemoteMapper，其 NimBLE 绑定数据结构与本固件不同。
固件已内置一次性 NVS 迁移：首次启动会检测 schema 并自动清空旧 NVS。
若仍有问题，可手动执行 `idf.py erase-flash` 后再烧录。

### 浏览器找不到设备

* 必须使用桌面版 Chrome / Edge；移动端浏览器不支持 WebUSB。
* 页面必须运行在 `https://` 或 `http://localhost`（安全上下文）。
* 关闭可能占用该设备的其他程序（如串口助手、Zadig）。
* 首次使用需在弹窗中选择 `MIRC003 Remote Bridge`。

### 语音键没有声音 / 输入法无法采集

在 Windows 声音设置中，把输入设备切换为 `MIRC003 Microphone`（UAC 1.0 麦克风），
并确认输入法的语音热键与遥控器语音键配置一致（默认 `右Alt + ,`）。

---

## 10. 致谢

* [cuicui-V5/RemoteMapper-ESP32](https://github.com/cuicui-V5/RemoteMapper-ESP32)：硬件桥接架构、按键引擎与音频处理。
* [HD838A/remote-mic-app](https://github.com/HD838A/remote-mic-app)：RC003 的 HOGP/ATVV 协议细节与 UI 参考。
* [QL-4/RemoteMapper](https://github.com/QL-4/RemoteMapper)、[godarrenw/mi_remote_control](https://github.com/godarrenw/mi_remote_control)：协议逆向参考。
* [TinyUSB](https://github.com/hathach/tinyusb) 与 [esp_tinyusb](https://github.com/espressif/esp-usb)。

## 11. 开源协议

[MIT License](./LICENSE)
