# Jetson Nano 前端部署

## 网络

两端均使用持久静态地址：

- 本机有线口：`192.168.55.1/24`，NetworkManager 连接名 `jetson-direct`
- Jetson Nano `eth0`：`192.168.55.2/24`，NetworkManager 连接名 `jetson-direct`

该有线连接不配置默认网关，不影响本机原有 Wi-Fi 上网。

## Jetson 运行组件

- `/opt/yisheng-guardian/frontend/`：部署后的静态前端
- `yisheng-camera.service`：左侧 CSI 相机，经 GStreamer 和硬件 JPEG 编码输出 640×360、12 FPS 的内存 MJPEG 流
- `yisheng-frontend.service`：本机静态服务器和反向代理，监听 `127.0.0.1:8080`
- `~/.config/autostart/yisheng-kiosk.desktop`：登录后自动全屏打开 Chromium

页面请求路径：

- 普通业务接口 → 本机 `192.168.55.1:8080`
- `/vision-api/*` → 本机 `192.168.55.1:8092`
- `/digital-human-api/*` → 本机 `192.168.55.1:8091`
- `/camera-stream` → Jetson 本机 GStreamer 相机流

## 常用检查

在 Jetson 上：

```bash
systemctl status yisheng-camera.service
systemctl status yisheng-frontend.service
curl http://127.0.0.1:8080/healthz
curl http://127.0.0.1:8080/vision-api/health
```

在本机上：

```bash
systemctl --user status alz-vision.service
curl http://127.0.0.1:8092/health
```

## 隐私边界

相机帧通过内存流传输，并在本机内存中完成推理；服务不保存截图、视频或人脸模板。前端仅显示短时平滑后的交互标签，识别结果不会自动写入用户档案或医疗报告。生气、厌恶、紧张或低落持续约 3 秒且达到置信度门槛时，数字人会主动播放一次安抚语音；同一情绪事件不会重复触发，事件间另有 90 秒冷却。

## ICS43434 麦克风和 MAX98357 功放

2026-11-05 已部署到当前 `nano` 用户的设备。当前前端目录为
`~/yisheng-guardian/frontend/`，前端和相机是用户级 systemd 服务。

- I²S4B 引脚由 `/boot/yisheng-i2s4.dtb` 持久启用，原 `primary` 启动项保留作回退。
- `pulse-default.pa` 安装到 `~/.config/pulse/default.pa`，保留系统桌面模块，
  将 I²S 设备设置为 48 kHz、32 位采样。
- 默认输出 `yisheng_speaker` 连接 MAX98357；数字人语音、视频和录音试听均通过它播放。
- 默认输入 `yisheng_microphone` 只保留 ICS43434 的左声道。右声道的无效满幅直流值不能参与混音。
- `yisheng-audio-route.service` 安装在 `~/.config/systemd/user/` 并启用，
  启动时连接 `ADMAIF1 ↔ I2S4`。
- `runtime-config.js` 的 `microphoneDeviceLabel: "YiSheng_ICS43434"` 启用
  Jetson 专用录音处理；`microphoneGain: 20` 设置采集增益。
- `microphone.js` 在浏览器内去除直流及低频噪声（80 Hz 高通）、放大、限幅，
  输出单声道，供数字人语音输入和筛查录音共用。停止录音时释放硬件输入和 AudioContext。
- `yisheng-kiosk.desktop` 安装到 `~/.config/autostart/`。此专用浏览器使用真实麦克风；
  `--use-fake-ui-for-media-stream` 仅为本地设备界面自动确认媒体权限。

检查和调整音量：

```bash
systemctl --user status yisheng-audio-route.service
pactl info | grep Default
pactl list short sinks
pactl list short sources
pactl set-sink-volume yisheng_speaker 50%
```

PulseAudio 配置的启动音量为 50%；可用最后一条命令调整当前输出。
数字人首页“开始说话”下方也提供 0–100% 音量滑块及静音按钮，
通过 `runtime-config.js` 的 `audioControlUrl: "/device-audio/volume"`
调节本机功放输出。界面加载时读取实际输出音量；接口校验同源和 0–100 的整数范围。
网页接管音频后，手动录音应使用 PulseAudio 的左声道设备：

```bash
parecord --device=yisheng_microphone --rate=48000 --channels=1 --format=s32le --file-format=wav ~/Recordings/manual.wav
paplay --device=yisheng_speaker ~/Recordings/new-recording-clean.wav
```

`parecord` 保存的是未做网页增益处理的有效单声道音频。网页中的“开始说话”
和筛查“开始录音”会自动应用上述处理。不要同时用 `hw:1,0` 独占设备，
以免与网页的 PulseAudio 录放冲突。
