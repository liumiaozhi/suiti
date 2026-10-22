// 交卷评分与记录统计（desktop session.submit / _summary / stats.py）。
//
// 口径一律以每条 item 的判定结果为准：
//   done（做题数）= 已判定的题数
//   missing（漏答）= 未作答 **且** 模式是模拟/正式 **且** 已交卷（练习模式不产生漏答）
//   正确率：做题记录 = 正确/做题数；考试记录 = 正确/题量
//   得分 = 答对题的分值之和；满分 = 全部题的分值之和

const grading = require('./grading');
const { pyRound } = require('./pycompat');

const EXAM_MODES = ['mock', 'exam'];
const MODE_LABEL = { practice: '练习', mock: '模拟考试', exam: '正式考试' };

/**
 * 交卷评分：只算，不落库（落库在 repo 层）。
 * @param {object} session {mode, total, ...}
 * @param {Array} items [{qtype, score, chosen, answer_disp}]
 * @returns {{right,wrong,missing,score,score_total,accuracy,base,done_cnt,is_correct:Array}}
 */
function gradeSession(session, items) {
  const mode = (session && session.mode) || 'practice';
  const list = items || [];
  let right = 0;
  let wrong = 0;
  let missing = 0;
  let rightScore = 0;
  let scoreTotal = 0;
  const flags = [];

  for (const it of list) {
    const itemScore = Number(it.score || 0);
    scoreTotal += itemScore;
    const chosen = it.chosen || [];
    if (!chosen.length) {
      if (EXAM_MODES.indexOf(mode) >= 0) missing += 1;
      flags.push(null); // 未判定
      continue;
    }
    const ok = grading.isCorrect(chosen, it.answer_disp, it.qtype);
    flags.push(ok ? 1 : 0);
    if (ok) {
      right += 1;
      rightScore += itemScore;
    } else {
      wrong += 1;
    }
  }

  const done = flags.filter((f) => f !== null).length;
  const base = EXAM_MODES.indexOf(mode) >= 0 ? (session && session.total) || list.length : done;
  return {
    right,
    wrong,
    missing,
    done_cnt: done,
    score: pyRound(rightScore, 2),
    score_total: pyRound(scoreTotal, 2),
    accuracy: grading.accuracy(right, base),
    base,
    is_correct: flags,
  };
}

/** 交卷后的汇总视图（与 _summary 对齐）。 */
function summarize(session, items) {
  const g = gradeSession(session, items);
  const settings = (session && session.settings) || {};
  return {
    session_id: (session && session.session_id) || 0,
    mode: (session && session.mode) || 'practice',
    mode_label: MODE_LABEL[(session && session.mode) || 'practice'] || '',
    source: (session && session.source) || 'bank',
    bank_id: (session && session.bank_id) || 0,
    bank_name: (session && session.bank_name) || '',
    candidate: (session && session.candidate) || '',
    total: (session && session.total) || (items || []).length,
    right: g.right,
    wrong: g.wrong,
    missing: g.missing,
    done_cnt: g.done_cnt,
    score: g.score,
    scores: settings.scores || {},
    score_per_q: (session && session.score_per_q) || 0,
    score_total: g.score_total,
    accuracy: g.accuracy,
    started_at: (session && session.started_at) || '',
    submitted_at: (session && session.submitted_at) || '',
    duration_sec: (session && session.duration_sec) || 0,
    status: (session && session.status) || 'submitted',
  };
}

/**
 * 做题记录：整体 + 按题库分行。
 * @param {Array} bankRows 每个题库一行：{bank_id,bank_name,right,wrong,missing,done_cnt,session_cnt,last_at}
 * @param {number} bankTotal 题库总数（用于"共 N 个题库"）
 */
function practiceRecords(bankRows, bankTotal) {
  const rows = bankRows || [];
  const byBank = [];
  let right = 0;
  let wrong = 0;
  let missing = 0;
  let done = 0;
  for (const r of rows) {
    const item = {
      bank_id: r.bank_id,
      bank_name: r.bank_name,
      done_cnt: r.done_cnt || 0,
      right: r.right || 0,
      wrong: r.wrong || 0,
      missing: r.missing || 0,
      session_cnt: r.session_cnt || 0,
      last_at: r.last_at || '',
    };
    item.accuracy = grading.accuracy(item.right, item.done_cnt);
    byBank.push(item);
    right += item.right;
    wrong += item.wrong;
    missing += item.missing;
    done += item.done_cnt;
  }
  return {
    overall: {
      bank_cnt: byBank.length,
      bank_total: bankTotal || 0,
      done_cnt: done,
      right,
      wrong,
      missing,
      accuracy: grading.accuracy(right, done),
    },
    by_bank: byBank,
  };
}

/** 考试记录：只含正式考试，一次考试一行。 */
function examRecords(sessions, page, size) {
  const all = sessions || [];
  const rows = all.map((r) => ({
    session_id: r.session_id,
    bank_name: r.bank_name || '',
    candidate: r.candidate || '',
    total: r.total || 0,
    right: r.right || 0,
    wrong: r.wrong || 0,
    missing: r.missing || 0,
    score: Number(r.score || 0),
    score_total: Number(r.score_total || 0),
    score_per_q: Number(r.score_per_q || 0),
    started_at: r.started_at || '',
    submitted_at: r.submitted_at || '',
    duration_sec: r.duration_sec || 0,
    accuracy: grading.accuracy(r.right || 0, r.total || 0),
  }));

  const totalQ = rows.reduce((s, r) => s + r.total, 0);
  const rightSum = rows.reduce((s, r) => s + r.right, 0);
  return {
    overall: {
      exam_cnt: rows.length,
      bank_cnt: new Set(rows.map((r) => r.bank_name)).size,
      total_q: totalQ,
      right: rightSum,
      wrong: rows.reduce((s, r) => s + r.wrong, 0),
      missing: rows.reduce((s, r) => s + r.missing, 0),
      score: rows.reduce((s, r) => s + r.score, 0),
      accuracy: grading.accuracy(rightSum, totalQ),
    },
    rows,
    page: page || 1,
    size: size || 50,
  };
}

module.exports = { EXAM_MODES, MODE_LABEL, gradeSession, summarize, practiceRecords, examRecords };
