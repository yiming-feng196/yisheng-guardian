# 忆声守护 · 认知筛查与情感陪伴

这是一个支持 Jetson Nano 终端的认知健康与日常情感陪伴项目。数字人可以聊生活、心情、压力与家人相处，也可以协助进行语音认知观察。项目包含：

- Spring Boot 后端。
- 后端托管的静态 Web 前端。
- Python 语音筛查服务 `http://127.0.0.1:5000/api/diagnosis`。
- 登录、注册、历史音频、诊断报告、PDF、管理员管理等接口。
- 中文数字人语音、CSI 摄像头情绪观察、ICS43434 麦克风与 MAX98357 功放接入。

当前版本说明见 [版本与模块说明](docs/current-version.md)，Jetson 音频、相机及部署说明见 [Jetson 部署](deploy/jetson/README.md)。

本系统只用于健康科普和风险提示，不能诊断、排除或治疗阿尔茨海默病。临床判断必须由正规医疗机构完成。

## 一键启动

### Docker（Windows、macOS、Linux）

已提供包含 MySQL、Redis、RabbitMQ、Python 筛查服务和 Spring Boot 后端的完整 Compose 配置：

```bash
cp .env.docker.example .env
# 修改 .env 中的四个必填密码/密钥
docker compose up -d --build
```

启动完成后访问 `http://localhost:8080/`。详细说明见
[Docker 本地部署](docs/docker-local-deployment.md)。

### Windows 原生启动

推荐在项目根目录双击：

```cmd
start.cmd
```

也可以在 PowerShell 中运行：

```powershell
cd C:\Users\Administrator\IdeaProjects\alz-backendalz-backend\alzheimers-voice-assistant
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start.ps1
```

启动后访问：

```text
http://localhost:8080/
```

更详细的启动说明见 [start.md](start.md)。

## 启动脚本会处理的服务

`start.ps1` 会自动：

- 设置 Java 17。
- 读取 `.env`。
- 创建 `data/audio`、`data/pdf`、`data/admin_audio`。
- 尝试启动本机 Redis。
- 使用 `D:\Professional software\anaconda3\envs\mock\python.exe` 启动 Python 筛查服务。
- 如果找不到 mock 环境，由用户决定是否根据 `screening-service\requirements.txt` 创建 `screening-service\.venv`。
- 输入有效 DeepSeek Key 时自动启用联网搜索、向量检索、Embedding 和向量库初始化。
- 启动并等待 Qdrant 与 BGE-M3 Embedding 服务；Docker 不可用时可在 Windows x64 自动下载经 SHA-256 校验的原生 Qdrant。
- 启动 Spring Boot 后端，在完成 Qdrant 知识索引预热并通过 readiness 后打开浏览器。

## 当前前端功能

当前页面不再依赖旧 Vue 前端目录。`backend/src/main/resources/static/` 是当前运行的前端；`frontend/` 保留早期静态实现供参考。

已迁移的主要功能：

- 日常聊天、情感陪伴与认知健康问答；普通聊天不再被限制为阿尔茨海默病话题。
- 用户可在前端保存并即时切换 DeepSeek、Kimi、智谱 GLM、通义千问模型。
- 看图说话任务和三张任务图。
- 浏览器录音、上传语音、历史音频。
- 个人资料、修改密码。
- 用户风险检测、诊断报告、PDF 管理。
- 管理员用户管理、音频管理、管理员样本上传、管理员检测、统计信息。
- Jetson Nano 左侧 CSI 摄像头实时预览与七类表情识别；画面只在内存中处理，不保存到磁盘。
- 情绪观察采用按时间平滑、持续确认、最短显示时间和人脸丢失宽限，画面标注与主标签共用稳定结果。
- 浏览器麦克风只读取有效左声道，自动进行高通、增益和限幅；数字人声音通过 I²S 功放输出，界面支持音量控制。

## Jetson Nano 前端与视觉识别

当前部署采用双机架构：

- 本机 `192.168.55.1`：Spring Boot 业务后端、数字人服务和 `vision-service` 表情识别服务。
- Jetson Nano `192.168.55.2`：静态前端、左侧 CSI 相机采集和 HDMI 全屏 Chromium。
- Jetson 页面统一访问 `http://127.0.0.1:8080/`，本地代理再连接本机服务，避免跨域和浏览器摄像头兼容问题。

视觉模型使用 OpenCV Zoo 的 YuNet 人脸检测与 Progressive Teacher / MobileFaceNet 表情分类，支持生气、厌恶、紧张、愉悦、平静、低落和惊讶七类结果。识别结果只用于界面交互提示，不作为诊断或筛查依据。

部署文件与运维命令见 [deploy/jetson/README.md](deploy/jetson/README.md)。

## 目录结构

- `backend/`：Spring Boot 后端和真正对外提供的静态前端资源。
- `frontend/`：早期静态前端参考；当前版本以前述后端静态资源目录为准。
- `screening-service/`：Python 语音筛查服务。
- `vision-service/`：本机视觉表情识别服务。
- `data/`：本地运行数据目录，不应提交真实敏感数据。
- `docs/`：项目说明、接口契约和验证文档。
- `deploy/`：数据库初始化和部署相关文件。
- `start.cmd` / `start.ps1`：根目录一键启动入口。

## 端口

- Web 前端和后端 API：`http://localhost:8080/`
- Python 语音筛查服务：`http://127.0.0.1:5000/api/diagnosis`
- Redis：`localhost:6379`
- MySQL：`localhost:3306`
- Qdrant：`http://127.0.0.1:6333`
- Embedding：`http://127.0.0.1:7997/v1/embeddings`
- 视觉表情服务：`http://127.0.0.1:8092`
- Jetson 前端：Jetson 本机 `http://127.0.0.1:8080/`

旧前端迁移来的 `/user/detect` 和 `/admin/detect` 还依赖外部 `POST /detect` 服务。当前仓库没有包含 `8000/detect` 的实现；如果需要使用这两个检测按钮，请另外启动对应服务。

## 常用配置

可以复制 `.env.example` 为 `.env`，再按本机情况修改：

```powershell
Copy-Item .env.example .env
```

常用项：

```dotenv
PYTHON_DIAGNOSIS_URL=http://127.0.0.1:5000/api/diagnosis
PYTHON_EXE=D:\Professional software\anaconda3\envs\mock\python.exe
PYTHON_AUTO_VENV=false
SCREENING_ENGINE_FACTORY=app.ad_diagnose_engine:create_engine

DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash

AUDIO_STORAGE_DIR=C:\Users\Administrator\IdeaProjects\alz-backendalz-backend\alzheimers-voice-assistant\data\audio
PDF_STORAGE_DIR=C:\Users\Administrator\IdeaProjects\alz-backendalz-backend\alzheimers-voice-assistant\data\pdf
ADMIN_AUDIO_STORAGE_DIR=C:\Users\Administrator\IdeaProjects\alz-backendalz-backend\alzheimers-voice-assistant\data\admin_audio
```

不要把真实 API Key、真实语音、转写文本、筛查结果或健康资料提交到仓库。

前端多模型选择、浏览器本地 Key 保存边界和联网检索兼容性见
[多模型切换使用说明](docs/多模型切换使用说明.md)。
