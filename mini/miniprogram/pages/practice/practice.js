const repo = require('../../utils/repo/index');
const grading = require('../../core/grading');
const { fmtScore } = require('../../core/pycompat');

// 练习模式：作答即判、禁止重答、不产生漏答
Page({
  data: {
    sid: '',
    pos: 1,
    total: 0,
    doneCnt: 0,
    bankName: '',
    item: null,
    sel: [],
    opts: [], // 选项视图模型（WXML 不支持在 mustache 里调 indexOf，必须在 JS 里算好）
    result: null, // {isCorrect, answerText, chosenText, correctIdx:[]}
    letters: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
    marked: false,
    hardOn: false,
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
    const sid = this.data.sid;
    repo
      .getPaperState(sid, pos)
      .then((st) => {
        const it = st.item;
        if (!it) {
          this.setData({ loading: false, err: '题目不存在' });
          return;
        }
        // 已判过分的不允许重答
        const judged = it.is_correct !== null && it.is_correct !== undefined;
        const sel = judged ? (it.chosen || []).slice() : [];
        const result = judged
          ? {
              isCorrect: !!it.is_correct,
              answerText: it.answer_text,
              chosenText: grading.selText(it.qtype, it.options_disp, it.chosen || []),
              correctIdx: (it.answer_disp || []).slice(),
            }
          : null;
        this.setData({
          loading: false,
          err: '',
          pos: st.pos,
          total: st.session.total,
          doneCnt: st.doneCnt,
          bankName: st.session.bankName,
          item: it,
          marked: !!it.marked,
          sel: sel,
          result: result,
          opts: this.buildOpts(it, sel, result),
        });
        this.syncHard();
      })
      .catch((e) => this.setData({ loading: false, err: (e && e.message) || '读取失败' }));
  },

  /** 当前题是否已在重难错题里 */
  syncHard() {
    const it = this.data.item;
    if (!it) return;
    repo
      .hardQidsOfBank(this.data.bankId || it.bankId || '')
      .then((ids) => this.setData({ hardOn: (ids || []).indexOf(it.qid) >= 0 }))
      .catch(() => {});
  },

  /** 选项 -> 视图模型：WXML 的 mustache 不支持 indexOf 等方法调用，全部在 JS 里算好 */
  buildOpts(it, sel, result) {
    const L = this.data.letters;
    const list = (it && it.options_disp) || [];
    const s = sel || [];
    const ok = (result && result.correctIdx) || [];
    return list.map((text, i) => ({
      letter: L[i] || '',
      text: text,
      idx: i,
      on: s.indexOf(i) >= 0,
      ok: ok.indexOf(i) >= 0,
      no: !!(result && !result.isCorrect && s.indexOf(i) >= 0),
    }));
  },

  onOpt(e) {
    const it = this.data.item;
    if (!it) return;
    if (this.data.result) return; // 已判分，锁定
    const i = Number(e.currentTarget.dataset.idx);
    if (it.qtype === 'multi') {
      const sel = this.data.sel.slice();
      const k = sel.indexOf(i);
      if (k >= 0) sel.splice(k, 1);
      else sel.push(i);
      this.setData({ sel: sel, opts: this.buildOpts(it, sel, null) });
      return;
    }
    const one = [i];
    this.setData({ sel: one, opts: this.buildOpts(it, one, null) });
    this.submit(one);
  },

  onDone() {
    const it = this.data.item;
    if (!it || this.data.result) return;
    if (!this.data.sel.length) {
      wx.showToast({ title: '请至少选一项', icon: 'none' });
      return;
    }
    this.submit(this.data.sel.slice());
  },

  submit(chosen) {
    repo
      .saveAnswer(this.data.sid, this.data.pos, chosen)
      .then((r) => {
        const fb = r && r.feedback;
        const it = this.data.item || {};
        const result = fb
          ? {
              isCorrect: fb.isCorrect,
              answerText: fb.answerText,
              chosenText: fb.chosenText,
              correctIdx: (it.answer_disp || []).slice(),
            }
          : null;
        this.setData({
          result: result,
          opts: this.buildOpts(it, this.data.sel, result),
          doneCnt: this.data.doneCnt + 1,
        });
        if (fb) wx.vibrateShort && wx.vibrateShort({ type: 'light' });
      })
      .catch((e) => wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' }));
  },

  prev() {
    if (this.data.pos <= 1) return;
    this.setData({ result: null, sel: [] }, () => this.load(this.data.pos - 1));
  },

  next() {
    if (this.data.pos >= this.data.total) {
      this.finish();
      return;
    }
    this.setData({ result: null, sel: [] }, () => this.load(this.data.pos + 1));
  },

  toggleMark() {
    const v = !this.data.marked;
    repo
      .toggleMarkByPos(this.data.sid, this.data.pos, v)
      .then(() => this.setData({ marked: v }));
  },

  toggleHard() {
    const it = this.data.item;
    if (!it) return;
    const v = !this.data.hardOn;
    repo
      .toggleHardByPos(this.data.sid, this.data.pos, v)
      .then(() => {
        this.setData({ hardOn: v });
        wx.showToast({ title: v ? '已加入重难错题' : '已移出重难错题', icon: 'none' });
      })
      .catch((e) => wx.showToast({ title: (e && e.message) || '操作失败', icon: 'none' }));
  },

  finish() {
    wx.showModal({
      title: '结束练习',
      content: `已答 ${this.data.doneCnt} 题，共 ${this.data.total} 题。未作答的题不计分。`,
      confirmText: '结束并看结果',
      success: (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: '评卷中' });
        repo
          .gradeAndSubmit(this.data.sid)
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
      title: '退出练习',
      content: '本次作答会保留，下次进来继续。',
      confirmText: '退出',
      success: (r) => {
        if (r.confirm) wx.switchTab({ url: '/pages/home/home' });
      },
    });
  },
});
