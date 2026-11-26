const { getSettings, applyDeploymentDefaults } = require('./config/env');

App({
  globalData: {
    // Chat drafts stay in memory. Changing environment clears the current draft.
    chat: null
  },
  onLaunch() {
    applyDeploymentDefaults();
    getSettings();
  }
});
