// 出卷：抽题、排序、答案映射。与 desktop session.preview / session.create_session 对齐。
//
// 不变式（B1）：answer_disp 在**建卷这一刻**算定，之后渲染/判分/导出都只读它。
// 题型之间固定按 单选 -> 多选 -> 判断 排列；q_order（正序/倒序/随机）只在题型内部生效。

const grading = require('./grading');
const { pickCount } = require('./settings');
const { UserError } = require('./errors');
const { pyRound } = require('./pycompat');

/**
 * 预览：不建卷，只算出题量与满分，供设置页实时显示。
 * @param {object} st    normalizeSettings 的结果
 * @param {object} pools {single:[...], multi:[...], judge:[...]}
 * @param {string} source 'bank' | 'hard'
 * @param {string} bankName
 */
function planPaper(st, pools, source, bankName) {
  const src = source === 'hard' ? 'hard' : 'bank';
  const byType = {};
  const warnings = [];
  let total = 0;
  let scoreTotal = 0;

  for (const t of st.types) {
    const available = (pools && pools[t] ? pools[t] : []).length;
    const requested = st.amount_mode === 'num' ? (st.amount[t] || available) : available;
    const picked = Math.min(requested, available);
    byType[t] = { available, picked, score: st.scores[t] };
    total += picked;
    scoreTotal += picked * st.scores[t];
    if (available === 0) {
      warnings.push(
        (src === 'hard' ? '该题库还没有重难错题中的' : '该题库没有') + grading.QTYPE_LABEL[t] + '，已自动跳过'
      );
    } else if (requested > available) {
      warnings.push(grading.QTYPE_LABEL[t] + '只够 ' + available + ' 题，已按 ' + available + ' 题出卷');
    }
  }

  if (total === 0) {
    throw UserError(src === 'hard' ? '重难错题里还没有可练习的题目' : '按当前设置没有抽到任何题目，请调整题型或数量');
  }

  return {
    bank_id: st.bank_id,
    bank_name: bankName || '',
    source: src,
    total,
    by_type: byType,
    scores: st.scores,
    score_per_q: st.score_per_q,
    score_total: pyRound(scoreTotal, 2),
    warnings,
    settings: st,
  };
}

/**
 * 按设置从 pools 里挑出题目（不建卷时的纯函数版本，供测试与分批处理）。
 * @returns {Array} 已按题型+顺序排好的题目对象
 */
function selectQuestions(st, pools, rng) {
  const rand = rng || Math.random;
  const picked = [];
  for (const t of st.types) {
    let arr = (pools && pools[t] ? pools[t] : []).slice();
    if (!arr.length) continue;
    const n = pickCount(st, t, arr.length);
    if (n <= 0) continue;
    if (st.q_order === 'random') {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
    } else if (st.q_order === 'desc') {
      arr.reverse();
    }
    picked.push(...arr.slice(0, n));
  }
  return picked;
}

/**
 * 把挑好的题目变成卷面 items：算定展示顺序与 answer_disp。
 * 判断题固定「正确/错误」，不打乱（避免出现"错误/正确"的怪异排布）。
 */
function buildItems(st, picked, rng) {
  const rand = rng || Math.random;
  const items = [];
  for (let i = 0; i < picked.length; i++) {
    const r = picked[i];
    const options = r.options || [];
    const answer = r.answer || [];
    const qtype = r.qtype;
    const shuffle = st.a_order === 'shuffle' && qtype !== 'judge';
    const order = grading.buildDisplayOrder(options.length, shuffle, rand);
    const answerDisp = grading.mapAnswer(answer, order);
    const optionsDisp = grading.displayOptions(options, order);
    items.push({
      qid: r.qid,
      pos: i + 1,
      qtype,
      stem: r.stem,
      options,
      order,
      options_disp: optionsDisp,
      answer_disp: answerDisp,
      answer_text: grading.answerText(qtype, optionsDisp, answerDisp),
      score: st.scores[qtype],
    });
  }
  return items;
}

function scoreTotalOf(items) {
  return pyRound(items.reduce((s, it) => s + (it.score || 0), 0), 2);
}

module.exports = { planPaper, selectQuestions, buildItems, scoreTotalOf };
