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
  page.setData({ safeBottom, navSpace: safeBottom + (page.data.largeText ? 94 : 82) });
  if (page.getTabBar) {
    const bar = page.getTabBar();
    if (bar) {
      const state = { selected, hidden: !!hidden, largeText: !!page.data.largeText, safeBottom };
      if (bar.syncPage) bar.syncPage(state);
      else bar.setData(state);
    }
  }
}
module.exports = { windowInfo, keyboardInset, syncTab };
