const repo = require('../../utils/repo/index');
const { fmtScore } = require('../../core/pycompat');

// 结果页：分数 + 统计 + 错题对照 + 重难错题归集
Page({
  data: {
    sid: '',
    summary: null,
    wrong: [],
    hardQids: [],
    showWrong: true,
    accText: '0%',
    scoreText: '0',
    scoreTotalText: '0',
    loading: true,
    err: '',
  },

  onLoad(q) {
    this.setData({ sid: q.sid || '' });
  },

  onShow() {
    if (!this.data.sid) {
      this.setData({ loading: false, err: '缺少会话' });
      return;
    }
    this.load();
  },

  load() {
    repo
      .getResult(this.data.sid)
      .then((r) => {
        if (!r || !r.summary) {
          this.setData({ loading: false, err: '结果不存在' });
          return;
        }
        const s = r.summary;
        this.setData({
          loading: false,
          err: '',
          summary: s,
          wrong: r.wrongItems || [],
          accText: fmtScore(s.accuracy) + '%',
          scoreText: fmtScore(s.score),
          scoreTotalText: fmtScore(s.score_total),
        });
        this.syncHard();
      })
      .catch((e) => this.setData({ loading: false, err: (e && e.message) || '读取失败' }));
  },

  syncHard() {
    const s = this.data.summary;
    if (!s) return;
    repo
      .hardQidsOfBank(s.bank_id)
      .then((ids) => {
        this.setData({ hardQids: ids || [] });
        this.applyHard();
      })
      .catch(() => {});
  },

  /** 把「是否已在重难错题里」写进每条错题：WXML 不支持在 mustache 里调 indexOf */
  applyHard() {
    const qids = this.data.hardQids || [];
    const wrong = (this.data.wrong || []).map((w) =>
      Object.assign({}, w, { hardOn: qids.indexOf(w.qid) >= 0 })
    );
    this.setData({ wrong: wrong });
  },

  toggleWrong() {
    this.setData({ showWrong: !this.data.showWrong });
  },

  isHard(qid) {
    return this.data.hardQids.indexOf(qid) >= 0;
  },

  toggleHard(e) {
    const pos = Number(e.currentTarget.dataset.pos);
    const qid = Number(e.currentTarget.dataset.qid);
    const on = this.data.hardQids.indexOf(qid) >= 0;
    repo
      .toggleHardByPos(this.data.sid, pos, !on)
      .then(() => {
        const qids = this.data.hardQids.slice();
        const k = qids.indexOf(qid);
        if (on && k >= 0) qids.splice(k, 1);
        else if (!on && k < 0) qids.push(qid);
        this.setData({ hardQids: qids });
        this.applyHard();
        wx.showToast({ title: on ? '已移出重难错题' : '已加入重难错题', icon: 'none' });
      })
      .catch((err) => wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }));
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/home' });
  },

  again() {
    const s = this.data.summary;
    if (!s) return;
    wx.redirectTo({ url: '/pages/setup/setup?bank=' + s.bank_id + '&mode=' + s.mode });
  },

  exportPaper() {
    wx.navigateTo({
      url: '/pkg-io-export/pages/export/export?kind=paper&sid=' + this.data.sid,
      fail: () => wx.showToast({ title: '导出功能暂不可用', icon: 'none' }),
    });
  },
});
