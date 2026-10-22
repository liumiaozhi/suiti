// 导出视图模型：PDF / Word / Excel 三种格式共用同一份数据（与 desktop export/model.py 对齐）。
//
// 两种来源：
//   * 会话（练习/模拟/正式考试）—— 只读卷面 items 快照，所以题号与正确答案必然与页面一致；
//   * 重难错题（按题库整份导出）。
//
// 卷面约定（用户确认过的）：
//   * 标题 = 题库名，不缀「练习 / 模拟考试 / 正式考试」；
//   * 卷头一行三栏：考生信息（左）/ 题量 + 满分（中）/ 得分（右），练习卷也保留考生信息；
//   * 不打印日期。

const grading = require('./grading');
const { pyRound } = require('./pycompat');

const MODE_TITLE = { practice: '练习', mock: '模拟考试', exam: '正式考试' };
const HARD_TITLE = '重难错题';

/** 按题型分组并**重新编号**（pos 按分组后的顺序，1 起）。 */
function groupItems(items, withScore) {
  const groups = [];
  let pos = 0;
  for (const t of grading.QTYPES) {
    const rows = (items || []).filter((i) => i.qtype === t);
    if (!rows.length) continue;
    const gi = rows.map((i) => {
      pos += 1;
      return {
        pos,
        stem: i.stem,
        qtype: t,
        options:
          t === 'judge'
            ? []
            : (i.options || []).map((txt, k) => ({ label: String.fromCharCode(65 + k), text: txt })),
        option_count: t === 'judge' ? 0 : (i.options || []).length,
        score: withScore ? Number(i.score || 0) : 0,
        answer_text: i.answer_text,
      };
    });
    groups.push({
      name: grading.groupTitle(groups.length, t),
      type: t,
      type_label: grading.QTYPE_LABEL[t],
      score: withScore ? Number(rows[0].score || 0) : 0,
      items: gi,
    });
  }
  return groups;
}

function commonVm(groups, extra) {
  const answerSheet = [];
  for (const g of groups) {
    for (const it of g.items) answerSheet.push({ pos: it.pos, answer_text: it.answer_text });
  }
  return Object.assign(
    {
      title: '',
      bank_name: '',
      candidate: '',
      show_candidate: true,
      show_score: true,
      total: groups.reduce((s, g) => s + g.items.length, 0),
      scores: {},
      score_total: pyRound(
        groups.reduce((s, g) => s + g.items.reduce((x, it) => x + (it.score || 0), 0), 0),
        2
      ),
      groups,
      answer_sheet: answerSheet,
      with_answer: true,
    },
    extra
  );
}

/**
 * 会话卷面 -> 视图模型。
 * @param {object} data {bank_name, mode, candidate, scores, items:[{qtype,stem,options,answer_text,score}]}
 */
function buildPaperVm(data) {
  const d = data || {};
  const groups = groupItems(d.items || [], true);
  return commonVm(groups, {
    session_id: d.session_id || 0,
    mode: d.mode || 'practice',
    mode_title: MODE_TITLE[d.mode] || d.mode_label || '练习',
    // 卷面标题统一用题库名
    title: d.bank_name || '',
    bank_name: d.bank_name || '',
    candidate: d.candidate || '',
    scores: d.scores || {},
  });
}

/** 重难错题整份导出 -> 视图模型（无分值概念，score 一律 0）。 */
function buildHardVm(bankName, rawItems) {
  const items = (rawItems || []).map((i) => ({
    qtype: i.qtype,
    stem: i.stem,
    options: (i.options || []).map((o) => (typeof o === 'string' ? o : o.text)),
    score: 0,
    answer_text: i.answer_text,
  }));
  const groups = groupItems(items, false);
  return commonVm(groups, {
    session_id: 0,
    mode: 'hard',
    mode_title: HARD_TITLE,
    title: bankName || '题库',
    bank_name: bankName || '',
    candidate: '',
    scores: {},
    score_total: 0,
  });
}

/**
 * 大题副标题：无分值（重难错题）时只给题量。
 * 例：每题 2 分，共 8 题，共 16 分
 */
function groupSubtitle(group) {
  const n = (group.items || []).length;
  const score = Number(group.score || 0);
  if (score <= 0) return '共 ' + n + ' 题';
  return (
    '每题 ' + grading.fmtScore(score) + ' 分，共 ' + n + ' 题，共 ' + grading.fmtScore(score * n) + ' 分'
  );
}

/** 卷头中间栏：题量 + 满分（重难错题没有满分，只给题量）。 */
function headerMiddle(vm) {
  const parts = ['共 ' + vm.total + ' 题'];
  if (vm.show_score && vm.score_total) parts.push('满分 ' + grading.fmtScore(vm.score_total) + ' 分');
  return parts.join('\u3000');
}

/** 默认文件名：题库名 + 时间戳（+ 考生信息），不含练习/考试字样。 */
function defaultFileName(vm, ext, stamp) {
  const clean = (s) =>
    String(s || '')
      .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
      .replace(/\s+$/, '')
      .slice(0, 110) || '试卷';
  const parts = [clean(vm.bank_name || vm.title)];
  parts.push(stamp || '');
  if (vm.candidate) parts.push(clean(vm.candidate));
  return parts.filter((p) => p).join('_') + '.' + ext;
}

module.exports = {
  MODE_TITLE, HARD_TITLE,
  groupItems, buildPaperVm, buildHardVm, groupSubtitle, headerMiddle, defaultFileName,
};
