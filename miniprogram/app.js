const { getSettings } = require('./config/env');

App({
  globalData: {
    // Chat drafts stay in memory. Changing environment clears the current draft.
    chat: null
  },
  onLaunch() {
    getSettings();
  }
});
