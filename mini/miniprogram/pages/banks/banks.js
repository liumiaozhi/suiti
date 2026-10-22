const repo = require('../../utils/repo/index');
const cfg = require('../../utils/config');
const demo = require('../../utils/demo');

Page({
  data: {
    banks: [],
    loading: true,
    err: '',
    dev: false,
  },

  onLoad() {
    // 演示数据入口只在开发模式出现（发布前把 config.env 改成 prod 即可）
    this.setData({ dev: cfg.env === 'dev' });
  },

  onShow() {
    this.load();
  },

  load() {
    repo
      .listBanks()
      .then((banks) => this.setData({ loading: false, err: '', banks: banks || [] }))
      .catch((e) => {
        this.setData({ loading: false, err: (e && e.message) || '读取失败' });
      });
  },

  goImport() {
    wx.navigateTo({
      url: '/pkg-io-import/pages/import/import',
      fail: () => wx.showToast({ title: '导入功能将在 P4 接入', icon: 'none' }),
    });
  },

  seedDemo() {
    repo
      .createBank({ name: '演示题库（金融市场）', sourceFile: 'demo', questions: demo.sampleQuestions() })
      .then(() => {
        wx.showToast({ title: '已注入演示题库', icon: 'success' });
        this.load();
      })
      .catch((e) => wx.showToast({ title: (e && e.message) || '注入失败', icon: 'none' }));
  },

  goSetup(e) {
    wx.navigateTo({ url: '/pages/setup/setup?bank=' + e.currentTarget.dataset.id });
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    wx.showModal({
      title: '删除题库',
      content: '确定删除「' + name + '」吗？它的重难错题会一并清除。',
      confirmColor: '#c62828',
      success: (r) => {
        if (!r.confirm) return;
        repo
          .deleteBank(id)
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            this.load();
          })
          .catch((err) => wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' }));
      },
    });
  },
});
