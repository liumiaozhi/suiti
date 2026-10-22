const repo = require('../../utils/repo/index');

// 模拟考试 / 正式考试：作答不判分，交卷时统一评卷；可改答案；空选 = 未答
Page({
  data: {
    sid: '',
    pos: 1,
    total: 0,
    doneCnt: 0,
    bankName: '',
    mode: '',
    modeLabel: '',
    candidate: '',
    item: null,
    sel: [],
    opts: [], // 选项视图模型（WXML 不支持在 mustache 里调 indexOf，必须在 JS 里算好）
    marked: false,
    hardOn: false,
    sheet: [],
    showSheet: false,
    letters: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
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
    this.load(this.data.pos);
  },

  load(pos) {
    repo
      .getPaperState(this.data.sid, pos)
      .then((st) => {
        const it = st.item;
        if (!it) {
          this.setData({ loading: false, err: '题目不存在' });
          return;
        }
        const sel = (it.chosen || []).slice();
        this.setData({
          loading: false,
          err: '',
          pos: st.pos,
          total: st.session.total,
          doneCnt: st.doneCnt,
          bankName: st.session.bankName,
          mode: st.session.mode,
          modeLabel: st.session.mode === 'exam' ? '正式考试' : '模拟考试',
          candidate: st.session.candidate || '',
          item: it,
          sel: sel,
          opts: this.buildOpts(it, sel),
          marked: !!it.marked,
          sheet: st.sheet || [],
        });
        this.syncHard();
      })
      .catch((e) => this.setData({ loading: false, err: (e && e.message) || '读取失败' }));
  },

  syncHard() {
    const it = this.data.item;
    if (!it) return;
    repo
      .hardQidsOfBank(it.bankId || '')
      .then((ids) => this.setData({ hardOn: (ids || []).indexOf(it.qid) >= 0 }))
      .catch(() => {});
  },

  /** 选项 -> 视图模型：WXML 的 mustache 不支持 indexOf 等方法调用，全部在 JS 里算好 */
  buildOpts(it, sel) {
    const L = this.data.letters;
    const s = sel || [];
    return ((it && it.options_disp) || []).map((text, i) => ({
      letter: L[i] || '',
      text: text,
      idx: i,
      on: s.indexOf(i) >= 0,
    }));
  },

  onOpt(e) {
    const it = this.data.item;
    if (!it) return;
    const i = Number(e.currentTarget.dataset.idx);
    let sel;
    if (it.qtype === 'multi') {
      sel = this.data.sel.slice();
      const k = sel.indexOf(i);
      if (k >= 0) sel.splice(k, 1);
      else sel.push(i);
    } else {
      sel = [i];
    }
    this.setData({ sel: sel, opts: this.buildOpts(it, sel) });
    // 考试模式每次改动都落盘（可改答案）
    repo
      .saveAnswer(this.data.sid, this.data.pos, sel)
      .then((r) => {
        const st = r && r.saved;
        this.refreshSheet();
      })
      .catch((e) => wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' }));
  },

  refreshSheet() {
    repo.getPaperState(this.data.sid, this.data.pos).then((st) => {
      this.setData({ doneCnt: st.doneCnt, sheet: st.sheet || [] });
    }).catch(() => {});
  },

  prev() {
    if (this.data.pos <= 1) return;
    this.setData({ sel: [] }, () => this.load(this.data.pos - 1));
  },

  next() {
    if (this.data.pos >= this.data.total) {
      wx.showToast({ title: '已是最后一题', icon: 'none' });
      return;
    }
    this.setData({ sel: [] }, () => this.load(this.data.pos + 1));
  },

  jump(e) {
    const p = Number(e.currentTarget.dataset.pos);
    this.setData({ showSheet: false, sel: [] }, () => this.load(p));
  },

  toggleSheet() {
    this.setData({ showSheet: !this.data.showSheet });
  },

  noop() {},

  closeSheet() {
    this.setData({ showSheet: false });
  },

  toggleMark() {
    const v = !this.data.marked;
    repo.toggleMarkByPos(this.data.sid, this.data.pos, v).then(() => {
      this.setData({ marked: v });
      this.refreshSheet();
    });
  },

  toggleHard() {
    const it = this.data.item;
    if (!it) return;
    const v = !this.data.hardOn;
    repo.toggleHardByPos(this.data.sid, this.data.pos, v).then(() => {
      this.setData({ hardOn: v });
      wx.showToast({ title: v ? '已加入重难错题' : '已移出重难错题', icon: 'none' });
    }).catch((e) => wx.showToast({ title: (e && e.message) || '操作失败', icon: 'none' }));
  },

  submit() {
    const undone = this.data.total - this.data.doneCnt;
    const content = undone > 0
      ? `还有 ${undone} 题未作答，交卷后将计为漏答。确定交卷吗？`
      : '所有题目均已作答，确定交卷吗？';
    wx.showModal({
      title: '交卷',
      content,
      confirmText: '交卷',
      success: (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: '评卷中' });
        repo.gradeAndSubmit(this.data.sid)
          .then(() => {
            wx.hideLoading();
            wx.redirectTo({ url: '/pages/result/result?sid=' + this.data.sid });
          })
          .catch((e) => {
            wx.hideLoading();
            wx.showToast({ title: (e && e.message) || '交卷失败', icon: 'none' });
          });
      },
    });
  },

  exit() {
    wx.showModal({
      title: '退出',
      content: '本次作答会保留，下次进来继续。',
      confirmText: '退出',
      success: (r) => {
        if (r.confirm) wx.switchTab({ url: '/pages/home/home' });
      },
    });
  },
});
