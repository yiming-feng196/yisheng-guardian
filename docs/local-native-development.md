# Windows 本机小程序联调

在仓库根目录运行 `start-local.cmd`。它在后台启动 Spring Boot（8080）和只监听本机的 Redis（6380），并配置小程序的本机地址。进程、工具和日志在 `.runtime/`；H2 文件数据库在 `data/runtime/local-db/`。这些运行数据不会提交到仓库。

本配置是显式启用的 `local-native` 开发配置，常规 MySQL 部署继续使用 `application.yml` 和原 Compose 文件。异步语音筛查、Python 转写和数字人视频服务不由这个启动入口运行。

## 模型与地址

模型凭据仅配置在仓库根目录 `.env`：`DEEPSEEK_API_KEY`、`DEEPSEEK_ENABLED=true` 和服务商实际支持的 `DEEPSEEK_MODEL`。不要把凭据写入小程序。未配置模型时，`/assistant/status` 明确返回 `modelConfigured=false`，不将本地知识回答标成模型已接通。

开发者工具使用 `http://127.0.0.1:8080`。启动脚本会把本机当前局域网地址写入手机端开发配置，并仅在本机的 `project.private.config.json` 关闭开发域名校验。手机仍需和电脑网络可达；正式发布应配置已备案的 HTTPS 合法域名。

`miniprogram/config/deployment.js` 是不含密钥的开发地址模板。脚本生成的机器地址不应提交。首次本机部署会迁移旧的演示/服务器配置，随后用户手动选择演示模式仍会保留。

## 启停与验证

- 停止：`powershell -NoProfile -ExecutionPolicy Bypass -File .\stop-local.ps1`。仅操作此项目记录的进程。
- 后端源码变更后：先停止，再执行 `start-local.cmd -Build`。
- 健康检查：`GET /actuator/health`；服务能力：`GET /assistant/status`；真实问答：`POST /assistant/chat`，JSON 为 `{ "message": "你好" }`。
- 首次部署没有原 MySQL 中的账号或记录，可通过现有 Web 前端注册账号。

工具首次缺失时会由 `scripts/bootstrap-local-tools.py` 下载并校验。JDK 来源为 Amazon Corretto，Maven 来源为 Apache，Redis Windows 本地开发构建来源为 redis-windows 项目；实际文件地址与校验值记录在 `.runtime/native-tools/tools-lock.json`。
