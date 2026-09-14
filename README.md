# MI-RC003-ESP32-Bridge

基于 **ESP-IDF** 的 ESP32-S3 固件：将 **小米蓝牙遥控器 2 Pro（RC003）** 的按键与语音通过
USB 复合设备转发到 Windows，并使用 **浏览器 WebUSB** 完成设备配置。

配置页面 https://ncmro7.github.io/MI-RC003-ESP32-Bridge/

> [!WARNING]
> **⚠️ 本项目由 AI 辅助开发，尚未完善，可能存在较多问题，请谨慎使用。**
> 如需稳定可用的方案，建议使用
> [cuicui-V5/RemoteMapper-ESP32](https://github.com/cuicui-V5/RemoteMapper-ESP32)。

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
| 按键配置 | 5 个配置方案 / 单击·长按·双击 | 保留并移植 |
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
| 2 | HID | INT IN `0x82` | 键盘（Report ID 1）+ 多媒体（Report ID 2）+ 鼠标（Report ID 3） |
| 3 | Vendor (WebUSB) | BULK OUT `0x05` / BULK IN `0x83` | WebUSB 配置通道 |

> **烧录与调试**
> * 复合设备占用的是 ESP32-S3 的**原生 USB（GPIO19/20，OTG）**口，运行时它同时提供
>   麦克风、键盘和 WebUSB。
> * 若要通过该 USB 口**烧录固件**：按住开发板 `BOOT` 键，点按一下 `RST`，松开 `BOOT`，
>   芯片会进入 ROM 的 USB-Serial-JTAG 引导模式，然后执行 `idf.py -p COMx flash` 即可。
> * 也可继续使用板载 UART 口（GPIO43/44）烧录与查看日志，二者互不影响。

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

开发时可直接使用 ESP-IDF：

```powershell
idf.py -p COMx flash monitor
```

### 4.4 一键生成烧录固件

`build-firmware.bat` / `tools/build-firmware.ps1` 会**编译固件并同时生成两份烧录固件**：
Windows 免安装烧录工具用的 `build/merged-flash.bin`，以及网页烧录用的
`webusb-config/flash/firmware/merged-flash.bin`（并自动更新 `manifest.json`）。

```bat
build-firmware.bat            :: 编译 + 生成两份固件
build-firmware.bat -NoBuild   :: 跳过编译，直接用现有 build 产物生成
```

### 4.5 打包 Windows 免安装烧录工具

`package-release.bat` / `tools/package-release.ps1` 将上一步生成的固件打包成**面向最终用户**的发布产物
（需先运行 `build-firmware.bat`）：

```bat
package-release.bat                 :: 打包
package-release.bat -Version 1.1.0  :: 指定版本号（默认读取 main/version.h）
```

执行后 `dist/` 中只包含 Windows 烧录工具：

| 产物 | 说明 |
| :--- | :--- |
| `MI-RC003-Bridge-<版本>-win64/` | **免安装 Windows 烧录包**：内置 `esptool.exe`、合并固件与双击 `flash.bat`，用户**无需 Python / ESP-IDF**，自动探测串口一键烧录 |
| `MI-RC003-Bridge-<版本>-win64.zip` | 上述目录的压缩包，可直接上传 GitHub Release |
| `SHA256SUMS.txt` | 发布包的 SHA-256 校验值 |

网页烧录器固定位于 `webusb-config/flash/`（`index.html` + `manifest.json` + `firmware/merged-flash.bin`），
随配置站点一起部署。提交并推送到 `main` 后 GitHub Pages 会自动部署，用户访问：

**https://ncmro7.github.io/MI-RC003-ESP32-Bridge/flash/**（桌面版 Chrome / Edge 直接在线烧录）

> 最终用户拿到的 Windows 包结构：`flash.bat`、`flash.ps1`、`esptool.exe`、`使用说明.txt`、`firmware/merged-flash.bin`。

---

## 5. 配置站点（WebUSB）

配置页面位于 [`webusb-config/`](./webusb-config)，是一个**纯静态站点**，不依赖任何后端。

> **二次开发**：设备通信已封装为无依赖的浏览器库
> [`webusb-config/assets/mi-rc003.js`](./webusb-config/assets/mi-rc003.js)，
> 第三方可以只写自己的 HTML/JS 调用该 API，完全替换默认 UI。
> 完整 API 参考见 [`webusb-config/api.md`](./webusb-config/api.md)（权威，随库维护）。

### 5.1 本地运行（推荐）

WebUSB 要求安全上下文，`http://localhost` 被视为安全来源：

```powershell
cd webusb-config
python -m http.server 8000
```

浏览器打开 <http://localhost:8000/>，点击「连接设备」，在弹出的设备列表中选择
`MI-RC003 Remote Bridge`。

> 固件 BOS 描述符中的着陆页地址默认为
> `https://ncmro7.github.io/MI-RC003-ESP32-Bridge/`；本地开发时可在 `main/version.h`
> 的 `WEBUSB_LANDING_URL` / `WEBUSB_LANDING_SCHEME` 中改回 `http://localhost:8000/`。

### 5.2 部署到公网（可选）

将 `webusb-config/` 目录部署到任意 **HTTPS** 站点（如 GitHub Pages），并同步修改
`WEBUSB_LANDING_URL` 与 `WEBUSB_LANDING_SCHEME`（`1` = https）后重新编译固件。

### 5.3 浏览器兼容性

* 桌面版 **Chrome / Edge**（Windows / macOS / Linux）支持 WebUSB。
* Android / iOS 浏览器**不支持** WebUSB。
* Windows 10/11 会自动为带 BOS 描述的厂商接口绑定 WinUSB，**无需 Zadig**。
* Linux 需要 udev 规则允许普通用户访问该设备。

配置页面包含：设备状态、按键配置（5 个配置方案可视化编辑）、蓝牙配对、运行日志、系统设置
与原始 JSON 导入导出。

按键编辑器提供可视化选择器：完整键盘布局、多媒体键分组、鼠标按键示意图，以及滚轮
「方向 + 格数」选择，并配有常用动作的快捷预设。「语音」动作可配置 Windows 语音快捷键
（默认 `RAlt + ,`）。

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
| `0x01` | STATUS | 运行状态 / 内存 / BLE 状态 / 当前配置 |
| `0x02` `0x03` | LOGS_GET / CLEAR | 运行日志 |
| `0x10` `0x11` `0x12` `0x13` | KEYMAP_GET / SAVE / RESET / TELEMETRY | 多配置方案按键映射 |
| `0x18` | SET_LAYER | 切换设备当前配置（层） |
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

所有映射均可在配置站点中自由修改；支持 5 个配置方案与单击/长按/双击/连发，动作类型可选
键盘、多媒体，以及**鼠标按键（左/右/中/后退/前进）与鼠标移动/滚轮**。鼠标移动可选上/下/左/右
方向并设置速度，按住持续移动，松开即停；滚轮可选滚动方向与每次格数。鼠标按键提供单击与
按住两种（按住时松开自动释放）；「语音」动作可配置 Windows 语音快捷键（默认 `RAlt + ,`）。

> 说明：RC003 的 HOGP 输入报文是「Report ID 1 + 3 个小端 16-bit 键盘 usage」。
> 固件会将其解析并归一化为上表的内部键码（例如 HID usage `0x4A/0x65/0x35` 分别
> 归一化为主页/菜单/电视键），同时兼容标准 8 字节键盘报文。

---

## 8. 项目结构

```text
MI-RC003-ESP32-Bridge/
├── CMakeLists.txt
├── sdkconfig.defaults
├── partitions.csv
├── build-firmware.bat                         # 一键生成烧录固件（Windows + 网页）
├── package-release.bat                        # 打包 Windows 免安装烧录工具
├── tools/
│   ├── common.ps1                             # 脚本公共函数
│   ├── build-firmware.ps1                     # 生成 build/merged-flash.bin 与网页固件
│   ├── package-release.ps1                    # 打包 dist/ Windows 烧录工具
│   └── standalone/{flash.bat,flash.ps1}       # 最终用户免安装烧录脚本模板
├── main/
│   ├── main.c                     # 初始化与任务
│   ├── app_config.h / version.h
│   ├── ble/ble_remote_client.*    # NimBLE Central: HOGP + ATVV
│   ├── audio/                     # IMA-ADPCM / AGC / 滤波 / 环形缓冲
│   ├── keymap/                    # 5 配置方案按键状态机 + NVS 配置
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
    ├── api.md                      # 浏览器库 API 参考（权威）
    ├── doc.md                      # 旧版说明
    ├── assets/{mi-rc003.js,app.js,style.css}
    └── flash/                     # 网页固件烧录（ESP Web Tools）
        ├── index.html
        ├── manifest.json
        └── firmware/merged-flash.bin
```

---

## 9. 常见问题

### 烧录工具检测不到串口

这是最常见的情况，原因通常是**设备正运行固件、原生 USB 口不提供串口**：

* 本项目运行时，原生 USB（OTG）口是 UAC + HID + WebUSB 复合设备，**不会出现 COM 口**。
  要烧录必须先让芯片进入 ROM 下载模式：
  1. 按住开发板 `BOOT` 键；
  2. 点按一下 `RST` 键；
  3. 松开 `BOOT` 键（此时设备管理器中会出现 `USB 串行设备 / USB JTAG serial debug unit`，并分配 COM 口）。
* 工具会自动等待最多 90 秒，进入下载模式后即可自动开始烧录。
* 也可改用板载 **UART 口**（GPIO43/44，需 CH34x / CP210x 驱动），此时无需手动按键即可自动复位烧录。
* 若设备管理器里根本没有串口，请先安装/更新 USB-UART 驱动。

### Windows 设备管理器提示「代码 28 / 该设备的驱动程序未被安装」

本固件在 BOS 描述符中同时提供了 **WebUSB** 与 **Microsoft OS 2.0（WINUSB 兼容 ID）**
描述符，Windows 10/11 应自动为该厂商接口加载 `winusb.sys`。若仍出现代码 28：

1. 确认烧录的是最新固件（PID 已从 `0x8303` 改为 `0x8304`，以强制 Windows 重新识别）。
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
* 首次使用需在弹窗中选择 `MI-RC003 Remote Bridge`。

### 修改按键映射后页面无响应 / 不生效

已修复：WebUSB 单帧上限提升到 32 KB，按键配置改为**按配置二进制存储**到 NVS
（NVS 单个值上限约 4 KB，之前的整段 JSON 会超限），并在应用配置时对按键引擎加锁。
配置过程与结果会打印到串口：

```
[KEYMAP] Saving keymap (NNNN bytes)
[KEYMAP] Keymap applied from JSON
[KEYMAP] Keymap saved to NVS
```

### 语音键没有声音 / 输入法无法采集

在 Windows 声音设置中，把输入设备切换为 `MI-RC003 Microphone`（UAC 1.0 麦克风），
并确认输入法的语音热键与遥控器语音键配置一致（默认 `右Alt + ,`）。

---

## 10. 致谢

* [cuicui-V5/RemoteMapper-ESP32](https://github.com/cuicui-V5/RemoteMapper-ESP32)：硬件桥接架构、按键引擎与音频处理。
* [HD838A/remote-mic-app](https://github.com/HD838A/remote-mic-app)：RC003 的 HOGP/ATVV 协议细节与 UI 参考。
* [QL-4/RemoteMapper](https://github.com/QL-4/RemoteMapper)、[godarrenw/mi_remote_control](https://github.com/godarrenw/mi_remote_control)：协议逆向参考。
* [TinyUSB](https://github.com/hathach/tinyusb) 与 [esp_tinyusb](https://github.com/espressif/esp-usb)。

## 11. 开源协议

[MIT License](./LICENSE)
