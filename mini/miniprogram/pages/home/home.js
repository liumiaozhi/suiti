const repo = require('../../utils/repo/index');
const { fmtScore } = require('../../core/pycompat');

Page({
  data: {
    version: '0.2.0',
    bankCnt: 0,
    doneCnt: 0,
    accText: '—',
    loading: true,
    err: '',
    banks: [],
    modes: [
      { mode: 'practice', name: '练习模式', desc: '每题作答后立即判分，可看答案', tag: '即时判分', tagClass: '' },
      { mode: 'mock', name: '模拟考试', desc: '交卷后统一评卷，不计入考试记录', tag: '不计记录', tagClass: 'gray' },
      { mode: 'exam', name: '正式考试', desc: '交卷后统一评卷，计入考试记录', tag: '留痕', tagClass: 'warn' },
    ],
  },

  onLoad() {
    repo.init();
  },

  onShow() {
    this.load();
  },

  load() {
    Promise.all([repo.listBanks(), repo.practiceRecords()])
      .then((res) => {
        const banks = res[0] || [];
        const o = (res[1] && res[1].overall) || {};
        this.setData({
          loading: false,
          banks: banks.slice(0, 3),
          bankCnt: o.bank_total || 0,
          doneCnt: o.done_cnt || 0,
          accText: o.done_cnt ? fmtScore(o.accuracy) + '%' : '—',
        });
      })
      .catch((e) => {
        // 出错要看得见：不能只停在骨架上，否则页面看起来就是"空白"
        this.setData({ loading: false, err: (e && e.message) || '读取失败' });
      });
  },

  goMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!this.data.bankCnt) {
      wx.showToast({ title: '请先导入题库', icon: 'none' });
      wx.switchTab({ url: '/pages/banks/banks' });
      return;
    }
    const first = this.data.banks[0];
    wx.navigateTo({
      url: '/pages/setup/setup?mode=' + mode + (first ? '&bank=' + first.id : ''),
    });
  },

  goBanks() {
    wx.switchTab({ url: '/pages/banks/banks' });
  },

  goBank(e) {
    wx.navigateTo({ url: '/pages/setup/setup?bank=' + e.currentTarget.dataset.id });
  },
});
