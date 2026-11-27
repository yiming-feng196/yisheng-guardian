const AUTO_READ_KEY = 'yisheng.mp.autoRead.v1';

function getAutoRead() {
  return wx.getStorageSync(AUTO_READ_KEY) !== false;
}

function saveAutoRead(value) {
  wx.setStorageSync(AUTO_READ_KEY, value === true);
}

module.exports = { getAutoRead, saveAutoRead };
