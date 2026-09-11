# MI-RC003 Bridge · WebUSB 配置站点

这是一个纯静态网页，通过浏览器 **WebUSB API** 直接与 MI-RC003 Bridge 固件通信，
替代了原 RemoteMapper-ESP32 的 Wi-Fi 热点 + HTTP 网页配置方案。

## 功能

* 设备状态：固件版本、运行时间、BLE 状态、当前配置、音频帧数、内存占用
* 按键配置：5 个配置方案可视化编辑（单击 / 长按 / 双击 / 连发），支持键盘、多媒体、鼠标按键与鼠标移动/滚轮，并支持继承穿透
* 蓝牙配对：扫描、连接、重新连接、解除绑定
* 运行日志：查看 / 清空设备日志
* 系统设置：重启、恢复出厂、原始 JSON 导入导出

## 本地运行

WebUSB 要求页面处于安全上下文，`http://localhost` 属于安全来源：

```bash
cd webusb-config
python -m http.server 8000
```

然后打开 <http://localhost:8000/>，点击「连接设备」，选择 `MI-RC003 Remote Bridge`。

## 部署

将本目录上传到任意 **HTTPS** 静态托管（GitHub Pages / Cloudflare Pages / 自有服务器）即可。
若部署地址不是 `localhost:8000`，请同步修改固件 `main/version.h` 中的：

```c
#define WEBUSB_LANDING_URL     "your.site/path/"
#define WEBUSB_LANDING_SCHEME  1   // 0 = http, 1 = https
```

## 通信协议

请求与响应均使用如下帧格式（详见仓库根目录 README）：

```text
'M' 'R'  cmd  status  len_lo  len_hi  payload...
```

`app.js` 中的 `command(cmd, payload)` 负责组帧、发送并等待完整响应。

## 兼容性

* 桌面版 Chrome / Edge（Windows / macOS / Linux）
* Windows 10/11 自动绑定 WinUSB，无需 Zadig
* Linux 需配置 udev 规则
* 移动端浏览器不支持 WebUSB
