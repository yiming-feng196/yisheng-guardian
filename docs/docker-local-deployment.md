# Docker 本地部署

这套配置面向 Docker Desktop 以及安装了 Docker Compose 插件的 Linux。默认启动安全的基础模式：页面、用户与报告数据、Redis 会话、RabbitMQ 和录音质量检查均在本地运行，不调用外部大模型，也不会给出疾病诊断。

## 前置条件

- Docker Engine 24+ 或较新的 Docker Desktop。
- Docker Compose v2（命令形式为 `docker compose`）。
- 建议至少 8 GB 内存、15 GB 可用磁盘空间。

## 首次启动

在项目根目录执行：

```bash
cp .env.docker.example .env
```

打开 `.env`，至少替换以下四项：

```dotenv
DB_PASSWORD=数据库用户强密码
MYSQL_ROOT_PASSWORD=数据库root强密码
RABBITMQ_PASSWORD=RabbitMQ强密码
JWT_SECRET=至少32字节的随机字符串
```

Linux 或 macOS 可以用下面的命令分别生成随机值：

```bash
openssl rand -hex 32
```

随后构建并启动：

```bash
docker compose up -d --build
docker compose ps
```

首次构建需要下载 Java、Python 和语音处理依赖，耗时取决于网络。所有容器健康后访问：

```text
http://localhost:8080/
```

健康检查：

```bash
curl http://localhost:8080/actuator/health
curl http://localhost:8080/actuator/health/readiness
```

RabbitMQ 管理页位于 `http://localhost:15672/`，用户名是 `alz_app`，密码来自 `.env`。

## 常用操作

查看状态和日志：

```bash
docker compose ps
docker compose logs -f backend screening
```

停止服务但保留数据：

```bash
docker compose down
```

重新构建应用：

```bash
docker compose up -d --build backend screening
```

删除容器及所有数据库、录音和报告卷会永久清除本地数据，只有明确需要重置时才执行：

```bash
docker compose down -v
```

## 启用 Whisper 和 DeepSeek 筛查

基础模式只做录音质量分析。需要启用仓库中的 Whisper + DeepSeek 引擎时，在 `.env` 中修改：

```dotenv
SCREENING_ENGINE_FACTORY=app.ad_diagnose_engine:create_engine
SCREENING_REQUIRE_AI=true
DEEPSEEK_ENABLED=true
DEEPSEEK_API_KEY=你的API密钥
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_SCREENING_MODEL=deepseek-chat
WHISPER_MODEL_SIZE=small
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
```

然后重建 Python 服务并重启后端：

```bash
docker compose up -d --build screening backend
```

首次分析会下载 Whisper 模型。CPU 环境建议先使用 `small`，不要直接使用仓库原 Windows 配置中的 `large-v2`。

## 可选 Qdrant

Qdrant 已放在 `rag` profile 中，启动方式为：

```bash
docker compose --profile rag up -d qdrant
```

仅启动 Qdrant 还不足以打开向量 RAG；还需要可访问的 Embedding 服务。未配置 Embedding 前请保持：

```dotenv
RAG_VECTOR_ENABLED=false
RAG_EMBEDDING_ENABLED=false
```

## 当前功能边界

- `/user/detect` 和 `/admin/detect` 仍依赖仓库没有提供的外部 `POST /detect` 服务。
- 默认基础模式不能诊断或排除阿尔茨海默病。
- `.env`、真实录音、转写、报告及医疗信息都不应提交到 Git。

## 端口冲突

如果本机端口已被占用，可以在 `.env` 中修改左侧宿主机端口：

```dotenv
APP_PORT=18080
MYSQL_PORT=13306
REDIS_PORT=16379
RABBITMQ_PORT=15672
RABBITMQ_MANAGEMENT_PORT=25672
```

修改 `APP_PORT` 后应使用对应地址访问，例如 `http://localhost:18080/`。
