const repo = require('../../utils/repo/index');
const settings = require('../../core/settings');
const paper = require('../../core/paper');
const { fmtScore } = require('../../core/pycompat');

const MODE_LABEL = { practice: '练习模式', mock: '模拟考试', exam: '正式考试' };

Page({
  data: {
    bankId: '',
    bankName: '',
    mode: 'practice',
    modeLabel: '练习模式',
    // 全部题型（含未勾选的），用于"1. 题型"区块
    types: [],
    // 只含**已勾选**题型的数量/分值行：控件从这个数组渲染，与计算结果解耦，
    // 计算一旦抛错（比如没勾题型）输入框也不会消失
    rows: [],
    amountMode: 'all',
    amount: { single: '', multi: '', judge: '' },
    scores: { single: 2, multi: 4, judge: 1 },
    qOrder: 'asc',
    aOrder: 'keep',
    // 题源：'bank' 正常题库；'hard' 只练该库的重难错题
    source: 'bank',
    candidate: '',
    showCandidate: false,
    total: 0,
    scoreTotalText: '0',
    err: '',
    loading: true,
  },

  onLoad(q) {
    const mode = q.mode || 'practice';
    this.setData({
      bankId: q.bank || '',
      mode,
      modeLabel: MODE_LABEL[mode] || '练习模式',
      source: q.source === 'hard' ? 'hard' : 'bank',
      showCandidate: mode === 'exam' || mode === 'mock',
    });
  },

  onCandidateInput(e) {
    this.setData({ candidate: e.detail.value });
  },

  onShow() {
    if (!this.data.bankId) {
      this.setData({ loading: false, err: '未选择题库' });
      return;
    }
    const wantHard = this.data.source === 'hard';
    const info = wantHard ? repo.hardOverview() : repo.getBank(this.data.bankId);
    info
      .then((res) => {
        if (!res) {
          this.setData({ loading: false, err: '题库不存在或已被删除' });
          return;
        }
        const c = wantHard
          ? (res.banks || []).filter((b) => b.bankId === this.data.bankId)[0] || { name: '', single: 0, multi: 0, judge: 0, total: 0 }
          : res.counts || {};
        const types = [
          { key: 'single', label: '单选题', available: c.single || 0 },
          { key: 'multi', label: '多选题', available: c.multi || 0 },
          { key: 'judge', label: '判断题', available: c.judge || 0 },
        ];
        types.forEach((t) => (t.on = t.available > 0));
        this.setData({
          loading: false,
          bankName: res.name || res.bankName || this.data.bankName,
          types,
          rows: this.buildRows(types),
        });
        this._questions = null;
        // 重难错题作题源：题目池来自 hard 快照，不是整个题库
        if (wantHard) {
          return repo.listHard({ bankId: this.data.bankId }).then((r) => {
            this._questions = this.buildPools(r.items || []);
            this.recalc();
          });
        }
        this.recalc();
      })
      .catch((e) => this.setData({ loading: false, err: (e && e.message) || '读取失败' }));
  },

  buildPools(qs) {
    const pools = { single: [], multi: [], judge: [] };
    for (const q of qs || []) (pools[q.qtype] || (pools[q.qtype] = [])).push(q);
    return pools;
  },

  /** 数量/分值区块的行 = 已勾选的题型 */
  buildRows(types) {
    return types.filter((t) => t.on).map((t) => ({ key: t.key, label: t.label, available: t.available, subtotal: '0' }));
  },

  /** 题目池（缓存，避免每次输入都重读） */
  pools() {
    if (this._questions) return this._questions;
    this._questions = this.buildPools(repo.raw.getBankQuestions(this.data.bankId));
    return this._questions;
  },

  toggleType(e) {
    const key = e.currentTarget.dataset.key;
    const types = this.data.types.map((t) => (t.key === key ? Object.assign({}, t, { on: !t.on }) : t));
    this.setData({ types, rows: this.buildRows(types) }, () => this.recalc());
  },

  setAmountMode(e) {
    this.setData({ amountMode: e.currentTarget.dataset.mode }, () => this.recalc());
  },

  onAmountInput(e) {
    const key = e.currentTarget.dataset.key;
    const amount = Object.assign({}, this.data.amount, { [key]: e.detail.value });
    // 只更新 amount 与小计，不整页 setData，避免输入时光标跳走
    this.setData({ amount }, () => this.recalc());
  },

  onScoreInput(e) {
    const key = e.currentTarget.dataset.key;
    const scores = Object.assign({}, this.data.scores, { [key]: e.detail.value });
    this.setData({ scores }, () => this.recalc());
  },

  setOrder(e) {
    const f = e.currentTarget.dataset.field;
    const v = e.currentTarget.dataset.value;
    if (f === 'q') this.setData({ qOrder: v }, () => this.recalc());
    else this.setData({ aOrder: v }, () => this.recalc());
  },

  recalc() {
    const payload = {
      bank_id: this.data.bankId,
      types: this.data.types.filter((t) => t.on).map((t) => t.key),
      amount_mode: this.data.amountMode,
      amount: this.data.amount,
      score: this.data.scores,
      q_order: this.data.qOrder,
      a_order: this.data.aOrder,
    };
    try {
      const st = settings.normalizeSettings(payload);
      const plan = paper.planPaper(st, this.pools(), 'bank', this.data.bankName);
      // 小计写回 rows（输入框的 value 不变，光标不会跳）
      const subtotals = {};
      Object.keys(plan.by_type).forEach((k) => {
        subtotals[k] = fmtScore(plan.by_type[k].picked * plan.by_type[k].score);
      });
      const rows = this.data.rows.map((r) => Object.assign({}, r, { subtotal: subtotals[r.key] || '0' }));
      this.setData({ err: '', total: plan.total, scoreTotalText: fmtScore(plan.score_total), rows });
    } catch (e) {
      this.setData({ err: (e && e.message) || '设置无效', total: 0, scoreTotalText: '0' });
    }
  },

  start() {
    if (this.data.err || !this.data.total) {
      wx.showToast({ title: this.data.err || '请先调整设置', icon: 'none' });
      return;
    }
    if (this.data.showCandidate) {
      const c = String(this.data.candidate || '').trim();
      if (!c) {
        wx.showToast({ title: '请填写考生信息', icon: 'none' });
        return;
      }
    }
    const payload = {
      bank_id: this.data.bankId,
      types: this.data.types.filter((t) => t.on).map((t) => t.key),
      amount_mode: this.data.amountMode,
      amount: this.data.amount,
      score: this.data.scores,
      q_order: this.data.qOrder,
      a_order: this.data.aOrder,
      source: this.data.source,
    };
    wx.showLoading({ title: '出卷中' });
    repo
      .createPaper({ bankId: this.data.bankId, mode: this.data.mode, candidate: this.data.candidate, settings: payload })
      .then((r) => {
        wx.hideLoading();
        const url = this.data.mode === 'practice' ? '/pages/practice/practice' : '/pages/exam/exam';
        wx.redirectTo({ url: url + '?sid=' + r.sessionId });
      })
      .catch((e) => {
        wx.hideLoading();
        wx.showToast({ title: (e && e.message) || '出卷失败', icon: 'none' });
      });
  },
});
