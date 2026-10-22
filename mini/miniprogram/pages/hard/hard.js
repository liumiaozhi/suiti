const repo = require('../../utils/repo/index');

// 重难错题：按题库归集，可查看、逐题移出、整库清空、单独练习、整份导出
Page({
  data: {
    banks: [],
    bankCnt: 0,
    total: 0,
    openId: '',
    openItems: [],
    loading: true,
    err: '',
  },

  onShow() {
    this.load();
  },

  load() {
    repo
      .hardOverview()
      .then((o) => {
        this.setData({ loading: false, err: '', banks: o.banks || [], bankCnt: o.bankCnt || 0, total: o.total || 0 });
        if (this.data.openId) this.expand(this.data.openId);
      })
      .catch((e) => this.setData({ loading: false, err: (e && e.message) || '读取失败' }));
  },

  toggle(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.openId === id) {
      this.setData({ openId: '', openItems: [] });
      return;
    }
    this.expand(id);
  },

  expand(id) {
    repo
      .listHard({ bankId: id })
      .then((r) => this.setData({ openId: id, openItems: r.items || [] }))
      .catch(() => this.setData({ openId: id, openItems: [] }));
  },

  removeOne(e) {
    const id = e.currentTarget.dataset.bank;
    const qid = Number(e.currentTarget.dataset.qid);
    repo
      .removeHard({ bankId: id, qid })
      .then(() => {
        wx.showToast({ title: '已移出', icon: 'none' });
        this.load();
      })
      .catch((err) => wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }));
  },

  clearBank(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    const n = this.countOf(id);
    wx.showModal({
      title: '清空重难错题',
      content: `确定把「${name}」的 ${n} 道重难错题全部移除吗？只影响归集清单，不影响题库和已有成绩。`,
      confirmText: '全部移除',
      confirmColor: '#c62828',
      success: (r) => {
        if (!r.confirm) return;
        repo
          .removeHard({ bankId: id, all: true })
          .then(() => {
            wx.showToast({ title: '已清空', icon: 'success' });
            this.setData({ openId: '', openItems: [] });
            this.load();
          })
          .catch((err) => wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }));
      },
    });
  },

  countOf(id) {
    const b = (this.data.banks || []).filter((x) => x.bankId === id)[0];
    return b ? b.total : 0;
  },

  practice(e) {
    wx.navigateTo({ url: '/pages/setup/setup?bank=' + e.currentTarget.dataset.id + '&mode=practice&source=hard' });
  },

  exportBank(e) {
    wx.navigateTo({
      url: '/pkg-io-export/pages/export/export?kind=hard&bankId=' + e.currentTarget.dataset.id,
      fail: () => wx.showToast({ title: '导出功能将在 P5 接入', icon: 'none' }),
    });
  },
});
