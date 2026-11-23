# 视频级数字人服务

该服务把 DeepSeek 返回的文本转换为中文语音，再使用 SadTalker 从固定女性头像生成带口型、眨眼、表情和头部运动的 MP4。

## 本机运行

```bash
chmod +x digital-human-service/run-local.sh
./digital-human-service/run-local.sh
```

健康检查：`http://localhost:8091/health`

本机已经通过用户级 systemd 服务启动。常用命令：

```bash
systemctl --user status alz-digital-human
systemctl --user restart alz-digital-human
journalctl --user -u alz-digital-human -f
```

模型和运行时位于 `.runtime/SadTalker`，生成文件位于 `digital-human-data`；两者均不提交到 Git。

默认优先使用 `zh-CN-XiaoxiaoNeural`，可通过 `DIGITAL_HUMAN_VOICE` 修改。如果联网语音接口不可用，会自动切换到项目内的 Piper `zh_CN-huayan-medium` 中文女声模型，避免回答只有文字没有声音。Piper 运行库和模型分别放在 `.runtime/piper-runtime` 与 `.runtime/piper-voices`。默认每次只生成一个视频，以控制 RTX 4060 8GB 的显存占用。

页面默认使用 `/v1/speech` 的晓晓普通话神经音色，并按短句预生成下一段音频，在声调、自然度和首句响应速度之间保持平衡。联网语音不可用时自动回退到本地 Kokoro，再回退到 MeloTTS 和 Piper；语音播放会同步驱动透明人物说话帧动画，不再等待 GPU 生成整段视频。SadTalker `/v1/renders` 接口仍保留，用于需要导出视频级口型、表情和头部动作的场景，但不再阻塞实时对话。
