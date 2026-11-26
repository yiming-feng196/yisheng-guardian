# 设计资源

运行资源位于 `../assets/`，所有页面共用同一背景与图标体系；本目录为开发源文件与交付素材，不打进微信主包。

| 资源 | 来源 / 用法 |
| --- | --- |
| `../assets/avatar-companion.png` | 原项目人物透明导出；保留角色身份 |
| `../assets/logo.png`、`../assets/observation.jpg` | 原项目Logo与真实任务图片 |
| `../assets/scene-atmosphere.png`、`scene-curves.svg` | 本轮代码绘制弥散光与曲面，PNG为预模糊合成 |
| `../assets/ginkgo-glass.png`、`ginkgo-glass.svg` | 原创淡玻璃银杏，SVG可编辑 |
| `../assets/icons/`、本目录六个图标SVG | 统一线性图标；旧图标由 `../scripts/export-ui-assets.py` 导出，新图标提供SVG |
| `observation-glass-original.png` | imagegen生成的透明插图原件 |
| `../assets/illustrations/observation-glass.png` | 640×480透明压缩导出；作为装饰，不表示录音能力 |
| `references/` | 用户提供的四张设计参考图；仅作设计基准，不作页面背景 |
| `verification/native-*.png` | 真实微信开发者工具截图；键盘布局图为高度事件模拟 |
| `verification/source-*.png` | Chromium源码派生的窄屏辅助检查；不是微信运行截图 |
| `tokens.json`、`asset-manifest.json` | 色板、排版、材质参数与运行资源校验值 |

原项目素材的权利归属沿用原项目，参考图由用户提供；未为这些素材另行声明第三方许可。imagegen提示词见 `IMAGEGEN_PROMPT.txt`。前端无第三方运行依赖。

`yisheng-guardian-design-assets.zip` 汇总运行图片、矢量源文件、原始插图、参考图、参数和验证截图。完整开发说明在上级 `UI_UPDATE.md`。

## 开发时重新导出

前端运行不依赖这些工具。安装 Pillow 后先执行 `python scripts/export-glass-art.py`，再使用可选 Sharp 开发工具执行 `node scripts/export-glass-vectors.cjs`，后者从本目录的 SVG 生成 PNG 并合成曲面。旧线性图标可通过 `python scripts/export-ui-assets.py` 导出。
