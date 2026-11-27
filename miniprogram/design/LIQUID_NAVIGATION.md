# 液态玻璃导航

四个一级页面共用相同的交互：按下时轻微压缩，横向拖动时前端跟随触点、尾部滞后，两端以连续的水滴细颈连接；停住或松手后融合为胶囊。可以中途反向拖动，拖出导航区域取消切页。

`custom-tab-bar/liquid.js` 负责弹簧和封闭轮廓，`custom-tab-bar/index.js` 用微信原生 Canvas 2D 绘制半透明薄荷绿填充、表面高光和边缘反光。底座使用静态背景模糊；这是适用于小程序的玻璃材质模拟，不包含实时光学折射。

每个页面拥有独立的自定义导航实例。位置按标签宽度归一化，并在切页时交接给新的实例，因此无需等动画结束才切页。只有当前可见实例调度动画，静止、页面隐藏、键盘遮挡时停止；绘制不逐帧调用 `setData`。页面通过 `utils/ui.js` 的 `syncTab` 同步选中项、安全区和大字模式。

缓存页面复用画布及渐变，不在每次切页时重新查询节点、重设位图。动画按实际经过的时间积分，并补偿导航期间的间隔。原生帧回调超过 34ms 未返回时启用定时器兜底；令牌和取消机制避免重复绘制。柔和玻璃层最多使用 2 倍像素密度，图标与文字保持原生分辨率；图标预装普通、选中两种状态，切换时不重新替换图片地址。

开发者工具内的八次缓存页切换对照见 [优化前](verification/liquid-navigation/performance-before.json)、[优化后](verification/liquid-navigation/performance-after.json)：重复测量从 8 次降为 0 次，目标页首次绘制从 34–60ms 降为 9–14ms。优化后的多数帧回调间隔为 20–27ms；仍记录到 58ms 和 125ms 的单次长间隔。这些数据是模拟器中逻辑绘制回调的采样，不能直接当作手机屏幕帧率。

Canvas 不可用时保留 CSS 选中胶囊和原生导航按钮；低性能设备取消拖尾，系统减少动态效果的媒体查询生效时显示静态胶囊。大字模式重新测量画布高度。点击、拖动及失败回退都保留当前实际页面的无障碍选中状态。

浏览器对照预览：[liquid-glass-preview.html](liquid-glass-preview.html)。它只演示材质和动效，不连接账号或后端；不会进入小程序发布包。

运行检查：

```bash
node miniprogram/scripts/check.cjs
node --test miniprogram/tests/core.test.cjs miniprogram/tests/liquid-tab.test.cjs
```

真机验收仍需在 iOS 和 Android 微信上检查流畅度与背景模糊降级。开发者工具和合成触摸测试不替代物理设备验收。
