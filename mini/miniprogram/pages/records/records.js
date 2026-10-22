const repo = require('../../utils/repo/index');
const { fmtScore } = require('../../core/pycompat');

Page({
  data: {
    tab: 'practice',
    loading: true,
    err: '',
    overall: {},
    rows: [],
  },

  onShow() {
    this.load();
  },

  load() {
    const isExam = this.data.tab === 'exam';
    const p = isExam ? repo.examRecords({ page: 1, size: 50 }) : repo.practiceRecords();
    p.then((res) => {
      const raw = isExam ? res.rows : res.by_bank;
      // WXML 里不能调用函数，展示用的字符串在这里算好
      const rows = (raw || []).map((r) =>
        Object.assign({}, r, { accText: this.acc(r.accuracy), scoreText: fmtScore(r.score) })
      );
      const o = res.overall || {};
      this.setData({
        loading: false,
        err: '',
        rows,
        overall: Object.assign({}, o, {
          accText: this.acc(o.accuracy),
          scoreText: fmtScore(o.score),
        }),
      });
    }).catch((e) => {
      this.setData({ loading: false, err: (e && e.message) || '读取失败' });
    });
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.tab) return;
    this.setData({ tab, loading: true }, () => this.load());
  },

  acc(v) {
    return v === undefined || v === null ? '—' : fmtScore(v) + '%';
  },
});
