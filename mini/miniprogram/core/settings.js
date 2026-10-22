// 出题设置归一化：与 desktop app/services/session.py 的 normalize_settings 对齐。
//
// 要点：
//   * 分值**按题型**分别设置（多选通常比单选分值高）；
//   * 老调用方只给 score_per_q 时，按同一分值铺到三个题型（兼容桌面版旧数据）；
//   * 只有"勾选到的题型"才校验分值 > 0，避免没勾的题型 0 分被判错。

const grading = require('./grading');
const { UserError } = require('./errors');
const { pyRound } = require('./pycompat');

function toFloat(v, dflt) {
  const f = parseFloat(v);
  return Number.isFinite(f) ? f : dflt;
}

function normalizeSettings(payload) {
  const p = payload || {};
  // 题库 ID 在小程序里是字符串（桌面版是数字），只判空，不做 parseInt
  const bankId = String(p.bank_id || '').trim();
  if (!bankId) throw UserError('请先选择题库');

  const pickedTypes = p.types || [];
  const types = grading.QTYPES.filter((t) => pickedTypes.indexOf(t) >= 0);
  if (!types.length) throw UserError('请至少勾选一种题型');

  let amountMode = p.amount_mode || 'all';
  if (amountMode !== 'all' && amountMode !== 'num') amountMode = 'all';
  const rawAmount = p.amount || {};
  const amount = {};
  for (const t of grading.QTYPES) {
    const n = parseInt(rawAmount[t], 10);
    amount[t] = Number.isFinite(n) && n > 0 ? n : 0;
  }

  // 分值：新格式是 {single:2, multi:4, judge:1}；老格式是 number（score_per_q）
  const scores = {};
  const rawScores = p.score;
  if (rawScores && typeof rawScores === 'object' && !Array.isArray(rawScores)) {
    for (const t of grading.QTYPES) {
      const v = toFloat(rawScores[t], 0);
      scores[t] = v > 0 ? pyRound(v, 2) : 0;
    }
  } else {
    const legacy = toFloat(p.score_per_q, 2);
    for (const t of grading.QTYPES) scores[t] = pyRound(legacy, 2);
  }

  for (const t of types) {
    if (!(scores[t] > 0)) throw UserError('请为' + grading.QTYPE_LABEL[t] + '填写大于 0 的分值');
    if (scores[t] > 1000) throw UserError('分值过大，请检查');
  }

  const qOrder = p.q_order === 'desc' || p.q_order === 'random' ? p.q_order : 'asc';
  const aOrder = p.a_order === 'shuffle' ? 'shuffle' : 'keep';

  return {
    bank_id: bankId,
    types,
    amount_mode: amountMode,
    amount,
    scores,
    score_per_q: scores[types[0]] || 0, // 兼容字段：仅代表第一个题型的分值
    q_order: qOrder,
    a_order: aOrder,
  };
}

/** 该题型实际抽多少题：全量 / 按设置取小值 / 没填按全量。 */
function pickCount(st, t, available) {
  if (st.amount_mode === 'all') return available;
  const n = st.amount[t] || 0;
  if (n <= 0) return available;
  return Math.min(n, available);
}

module.exports = { normalizeSettings, pickCount };
