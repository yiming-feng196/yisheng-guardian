# 忆声陪伴 · 微信小程序公共骨架

版本：V0.1.0。AppID：`wx23c148b666ca9b93`。

这是仓库中新建的原生微信小程序工程，供三人团队并行迁移。使用 JavaScript、WXML 和 WXSS，后端沿用现有 Spring Boot 与 Python 服务。项目代码在本目录，微信运行时由开发者工具和微信客户端提供。

## 从哪里获得框架和示例

- [微信官方目录结构](https://developers.weixin.qq.com/miniprogram/dev/framework/structure.html)：说明 `App`、页面及其四种文件。
- [官方开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)：也可用其“JavaScript 基础模板”生成类似的最小工程。
- [微信官方组件/API 示例](https://github.com/wechat-miniprogram/miniprogram-demo)：查阅录音、音频、请求和上传用法。该示例有自己的 MIT 许可；本骨架没有复制整个示例项目。

当前没有第三方 npm 运行依赖，不需要安装 Node.js、Java 或 Python才能在 Windows 开发者工具中打开前端。Node.js 仅用于本目录的可选检查脚本。

## Windows 导入与预览

1. 拉取包含本目录的代码，安装微信开发者工具稳定版。
2. 用已加入项目开发成员的微信账号登录。
3. 选择“导入项目”，目录选择本仓库下的 **`miniprogram`**，不是仓库根目录。
4. 确认 AppID 为 `wx23c148b666ca9b93`，使用“小程序”编译类型。
5. 直接编译，默认进入演示模式。无需开通云开发，也无需“构建 npm”。
6. 四个入口是“陪伴 / 观察 / 记录 / 我的”。手机预览和音频等能力需要用真实微信客户端验证。

## 当前实现范围

| 功能 | 当前状态 |
| --- | --- |
| 四个页面、底部导航、品牌样式、大字模式 | 已实现公共骨架 |
| 演示问答 | 固定规则回复，始终标注演示，不调用 AI |
| 真实文字问答 | 接入 `POST /assistant/chat`，一次请求一次回答 |
| 账号密码登录 | 接入现有 `/user/login`，不是微信一键登录 |
| 登录后的已有观察任务 | 接入 `GET /api/v1/screenings`，可查看返回的报告文本 |
| 后端连接检查 | 接入 `/actuator/health`；通过不等于全部模型服务可用 |
| 观察四步流程 | UI 示例，没有真实录音、上传、任务提交或健康结果 |
| 聊天录音、转写、朗读、连续会话与流式回答 | 待队友 A 接入 |
| 真实观察任务、完整报告详情、个人资料等 | 待队友 B 接入 |
| 唤醒词、实时情绪识别、Jetson 硬件控制 | 不在本骨架范围 |

演示模式不向后端发送聊天、登录或记录请求。只有明确点击“检查连接”才会独立访问填写的真实服务器。联调失败会显示错误，不会自动伪装成演示成功。

聊天草稿只留在当前小程序进程内，不是后端会话历史。退出进程或切换开发环境会丢弃当前草稿。接入带记忆的聊天需要使用 `/assistant/conversations` 和流式接口。

## 配置自己的后端

在“我的”页面填写工作站局域网地址，例如 `http://192.168.1.100:8080`，保存后检查连接。这里的 IP 只是示例，必须换成手机实际能够访问的地址。

手机、Windows 电脑和工作站需要网络可达，工作站的后端端口也需要开放。手机里的 `127.0.0.1` 指向手机自己；Jetson USB 网段的地址通常也不能直接用于 Wi-Fi 手机。

配置完成后打开“接口联调模式”并保存。返回“陪伴”即可使用真实单轮问答；查看已有观察记录需要在“我的”中登录原网页的账号。

公共配置默认启用域名校验。开发者工具及手机调试模式中的域名/TLS 临时调试选项请按[微信网络文档](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)设置，不要将调试成功当作普通预览或发布环境验证通过。音频、图片的加载路径也需要单独真机检查。

环境模式、后端地址和字号只保存在各自设备中。登录凭证按后端地址隔离保存，密码不持久化。不要在代码中填真实账号、密码或模型密钥；AppID 本身是项目标识。

## 接口对照

| 用途 | 方法与地址 | 约定 |
| --- | --- | --- |
| 健康检查 | `GET /actuator/health` | JSON `status: UP` |
| 当前单轮问答 | `POST /assistant/chat` | JSON `{message}`；读取 `answer` |
| 原项目登录 | `POST /user/login` | JSON `{username,password}`；成功返回 JWT 字符串 |
| 观察任务列表 | `GET /api/v1/screenings` | Bearer token；返回任务数组 |
| 后续连续会话 | `/assistant/conversations` | 已预留匿名 UUID 请求头，后续接入 |
| 后续聊天转写 | `POST /assistant/speech/transcribe` | multipart 字段 `file` |
| 后续观察录音上传 | `POST /audio/upload` | PCM WAV、登录和正式知情同意字段 |
| 后续观察任务创建 | `POST /api/v1/audios/{audioId}/screenings` | 不要绕过后端正式录音验证 |

后端地址集中由 `config/env.js` 管理；HTTP 状态码、请求错误和登录凭证统一由 `services/request.js` 处理。业务页面只调用 `services/api.js`。

## 本地检查

在有 Node.js 的电脑上运行：

```bash
node miniprogram/scripts/check.cjs
node --test miniprogram/tests/core.test.cjs
```

检查覆盖源码语法、配置/页面/资源引用以及环境隔离、请求错误、登录和异步结果保护。它们不能代替微信开发者工具的 WXML/WXSS 编译与手机预览。

2026-11-25 的 Ubuntu 检查结果：源码结构检查通过，核心逻辑测试 10 项通过。Windows 微信开发者工具编译和手机预览待团队验证。

真机验收顺序：四页切换 → 演示内容标识 → 文字输入和键盘 → 字号保存 → 观察流程示例 → 配置后端 → 健康检查 → 真实单轮回答 → 原账号登录与已有任务。

## 与软著材料对应

本目录是开发起点，不是完整业务成品。说明书和截图应随真实实现更新，明确区分演示数据和实际功能；记录软件版本、开发分工及改动来源。原项目、第三方依赖和官方示例的许可应分别核实，公共模板不能替代对实际代码权属的说明。

品牌图标在 `assets/logo.png`，来自本项目本轮生成的 Logo；观察示意图沿用原仓库的 `test.jpg`，其原始素材来源及使用权需要沿用原项目的权属记录。
