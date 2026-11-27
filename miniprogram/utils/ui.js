// Native geometry and tab coordination shared by all four pages.
function windowInfo() {
  try {
    if (wx.getWindowInfo) return wx.getWindowInfo();
    if (wx.getSystemInfoSync) return wx.getSystemInfoSync();
  } catch (_) {
    /* Geometry is optional in unit tests and older clients. */
  }
  return { windowWidth: 393, windowHeight: 700, screenHeight: 700 };
}
function keyboardInset(height, baseline, currentHeight) {
  return Math.max(0, (Number(height) || 0) - Math.max(0, baseline - currentHeight));
}
function syncTab(page, selected, hidden) {
  const info = windowInfo();
  const safeBottom = info.safeArea ? Math.max(0, info.screenHeight - info.safeArea.bottom) : 0;
  const largeText = !!page.data.largeText;
  const dockHeight = Math.ceil((largeText ? 150 : 130) * info.windowWidth / 750) + 14;
  const navSpace = safeBottom + Math.max(largeText ? 94 : 82, dockHeight);
  if (page.data.navSpace !== navSpace) page.setData({ navSpace });
  if (page.getTabBar) {
    const bar = page.getTabBar();
    if (bar) {
      const state = { selected, hidden: !!hidden, largeText, safeBottom };
      if (!bar.data || Object.keys(state).some((key) => bar.data[key] !== state[key])) bar.setData(state);
    }
  }
}
module.exports = { windowInfo, keyboardInset, syncTab };
