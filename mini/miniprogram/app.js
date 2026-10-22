// 随题 · 小程序入口
const cfg = require('./utils/config');

App({
  globalData: {
    version: '0.1.0',
    schema: 1,
    ready: false,
  },

  onLaunch() {
    // P0：只做环境初始化。repo 在 P2 接入后由 utils/repo 门面懒加载，
    // 这里只记录一次启动时间，供「僵尸会话清理」使用（禁止在 onHide 里 abandon）。
    try {
      wx.setStorageSync('suiti:last_launch', Date.now());
    } catch (e) {}
    this.globalData.ready = true;
    console.log('[随题] onLaunch', cfg.env, this.globalData.version);
  },

  onError(err) {
    console.error('[随题] 未捕获错误', err);
  },
});
