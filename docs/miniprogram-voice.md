# 小程序语音使用与联调

本次开放的是陪伴页的语音输入与回复朗读。数字人仍是静态形象，不包含音频口型同步；观察页仍为流程体验，不会因此开启认知评估录音。

## 使用

1. 在“我的”连接真实后端。
2. 点击输入框左侧麦克风，允许隐私授权与麦克风权限。
3. 说完后点击“结束”，最长录音 60 秒。结束后上传到配置的后端转文字。
4. 转写文字填入输入框，已有草稿会保留并合并。检查修改后点击发送。
5. 新的真实回复完成后自动朗读，无需再点按钮。对话面板中的“自动朗读回复”开关可关闭并保存；不会自动朗读欢迎语、旧消息、错误或演示回复。
6. 点击回复下方的“停止朗读”或输入栏的取消按钮停止。发送新消息会打断当前朗读；录音、转写期间仍需先结束语音操作。

切换页面、切换后端、收起对话会取消录音、上传或播放；这些操作之后到达的回复不会自动出声。取消的录音不上传；已经到达服务器的转写请求可能继续计算，但结果不会再填入页面。录音临时文件在转写完成或取消后删除，后端上传临时文件由既有接口 finally 删除。播放音频仅存小程序临时文件，用完删除。

语音识别可能有同音字错误，不自动发送识别结果。演示模式不申请录音权限、不调用语音服务。

## Windows 本机启动

仓库根目录运行：

```powershell
.\start-local.cmd -Build
```

本机启动默认包含语音工作进程，首次安装需要 Python 3.10+，下载依赖和 Whisper small 模型。依赖、模型、日志均放在忽略提交的 `.runtime` 中。无需增加模型 API 密钥。原有后端配置继续由 `.env` 管理。

仅启动语音：`powershell -ExecutionPolicy Bypass -File .\start-voice.ps1`。
只启动文字后端：`powershell -ExecutionPolicy Bypass -File .\start-local.ps1 -Voice:$false`。
停止本机服务：`powershell -ExecutionPolicy Bypass -File .\stop-local.ps1`。

语音工作进程只监听 `127.0.0.1:5010`；手机只连接电脑的 8080 端口。健康检查：

```text
GET /assistant/voice/status
```

只有模型实际加载完成，`asrReady` 才为 true。配置了独立转写服务的部署继续沿用 `PYTHON_TRANSCRIPTION_URL`；否则本机启动器指向 `http://127.0.0.1:5010/api/transcription`。TTS 代理地址可由 `APP_VOICE_URL` 覆盖。

默认 ASR 使用 CPU/int8，`VOICE_WHISPER_MODEL` 可指定其他 faster-whisper 模型或本地模型路径。改变模型后重启语音进程。转写音频仅交给本机模型。朗读采用现有项目同类的 Edge 在线普通话引擎，会将朗读文字发送到在线语音服务；需要电脑联网，网络失败会明确提示，不会伪装播放成功。此在线引擎并非有 SLA 的生产 TTS 合同服务，正式部署可替换工作进程的 `/synthesize` 实现。

在线朗读会读取系统或环境中的 HTTP/HTTPS 代理。可用 `VOICE_TTS_PROXY` 显式指定代理，设为 `direct` 则强制直连。不要在仓库中填写个人代理凭据。语音进程健康检查成功只表示进程可达，不代表在线合成已经成功；排查时须实际调用合成接口。朗读失败保留文字回复，不影响后续文字聊天。

正式发布前，在微信公众平台配置录音相关用户隐私保护指引和正式 HTTPS 域名。开发环境的域名校验选项不等于发布环境已经配置。需在 Android/iOS 真机分别测试权限拒绝、再次授权、来电中断、录音 60 秒、切后台、弱网取消和播放音量。

## 接口

| 接口 | 用途 |
|---|---|
| `POST /assistant/speech/transcribe` | 既有 multipart `file` 接口，接收真实 MP3，返回 `transcription` |
| `GET /assistant/voice/status` | 语音进程与模型加载状态 |
| `POST /assistant/voice/synthesize` | JSON `{text}`，1–3000 字；返回 `audio/mpeg`，禁止缓存 |

依赖：[faster-whisper](https://github.com/SYSTRAN/faster-whisper)、[edge-tts](https://github.com/rany2/edge-tts)。PyAV 固定到 16.0.1，避免新版本移除 `metadata_errors` 参数导致解码失败。

## 本次验证（2026-11-27）

40 项小程序逻辑测试、8 项相关 Java 测试通过；微信开发者工具自带 WXML/WXSS 编译器通过。
通过真实 8080 网关生成 34,992 字节普通话 MP3，再通过 multipart 上传到转写接口；Whisper small 返回“你好,我是小忆。今天天气很好,很高兴陪你聊天。”，本次转写耗时约 4.65 秒。该测试使用合成语音，不代表手机麦克风、实际扬声器或移动网络已经验收。

自动朗读更新：58 项小程序逻辑测试、5 项语音代理与错误处理测试通过；实际 8080 网关生成 22,896 字节、约 3.82 秒的可解码 MP3。微信开发者工具验证了 `idle → synthesizing → playing` 自动播放状态和停止控制，无运行异常。这不代表已验证实体手机扬声器或音量设置。
