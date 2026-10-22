// 判题核心：答案归一化、打乱映射、判分、答题括号。
// 与 desktop app/services/grading.py **逐行对齐**，任何改动都要先重跑
//   python tools/dump_fixtures.py
// 再让 tests/node/core 里的 golden 比对通过。
//
// 唯一不变式（全工程最重要的约定）：
//   answer_disp（展示下标）在"建卷"时一次算定并写进 session_items，
//   之后渲染、判分、导出三方都只读它，任何地方都不许再做第二次映射。
//   违反这条必然出现"点对判错"。

const { stripSep, stripLabel, normalizeText } = require('./text');
const { fmtScore: fmtScoreFn, accuracy: accuracyFn, pyRound } = require('./pycompat');

const QTYPES = ['single', 'multi', 'judge'];
const QTYPE_LABEL = { single: '单选题', multi: '多选题', judge: '判断题' };
const QTYPE_NAME = { single: '单项选择题', multi: '多项选择题', judge: '判断题' };
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

const JUDGE_OPTIONS = ['正确', '错误'];
const JUDGE_TRUE = new Set(['对', '正确', '是', '√', '✓', '✔', 'T', 'TRUE', 'Y', 'YES', '1', 'TURE']);
const JUDGE_FALSE = new Set(['错', '错误', '否', '×', '✗', '✘', 'X', 'F', 'FALSE', 'N', 'NO', '0', '不']);

// 数字答案：多个数字（用分隔符隔开）或单个数字
const NUM_MULTI_RE = /^[\s\u3000,，、;；/|]*\d+([\s\u3000,，、;；/|]+\d+)+[\s\u3000,，、;；/|]*$/;
const NUM_SINGLE_RE = /^[\s\u3000]*\d+[\s\u3000]*$/;
const LETTERS_RE = /^[A-Z]+$/;

function AnswerError(message, code) {
  const e = new Error(message);
  e.name = 'AnswerError';
  e.code = code || 'ANSWER_INVALID';
  return e;
}

function idxToLetters(idxs) {
  return (idxs || []).map((i) => String.fromCharCode(65 + i)).join(',');
}

function parseQtype(raw) {
  const s = normalizeText(raw).toLowerCase();
  if (!s) throw AnswerError('题型为空');
  if (s.indexOf('多') >= 0 || s.indexOf('multi') >= 0 || s === '2' || s === '多选' || s === '多项') return 'multi';
  if (s.indexOf('判断') >= 0 || s.indexOf('judge') >= 0 || s.indexOf('tf') >= 0 || s === '3' || s === '对错') return 'judge';
  if (s.indexOf('单') >= 0 || s.indexOf('single') >= 0 || s.indexOf('radio') >= 0 || s === '1' || s === '选择') return 'single';
  throw AnswerError('题型无法识别：' + raw + '（应为 单选/多选/判断）');
}

/**
 * 把 Excel 里五花八门的答案写法解析成 0 基下标列表（升序去重）。
 * 支持：ABD / A,B,D / A B D / b、a、d / 1,3 / 对 / √ / T / 正确 / A
 * 失败抛 AnswerError（绝不静默返回空列表 —— 宁可拒绝导入也不能带病入库）。
 */
function parseAnswer(raw, qtype, options) {
  const s = normalizeText(raw);
  if (!s) throw AnswerError('答案为空');
  const up = s.toUpperCase();
  const compact = stripSep(up);
  const n = (options || []).length;

  // 判断题：先走语义集合
  if (qtype === 'judge') {
    if (JUDGE_TRUE.has(compact)) return [0];
    if (JUDGE_FALSE.has(compact)) return [1];
    if (compact === 'A') return [0];
    if (compact === 'B') return [1];
  }

  // 数字编号（1 基；若出现 0 则按 0 基处理）
  if (NUM_MULTI_RE.test(s) || NUM_SINGLE_RE.test(s)) {
    const nums = (s.match(/\d+/g) || []).map((x) => parseInt(x, 10));
    if (nums.length && nums.every((v) => v >= 1 && v <= n)) {
      return Array.from(new Set(nums.map((v) => v - 1))).sort((a, b) => a - b);
    }
    if (nums.length && nums.every((v) => v >= 0 && v <= n - 1)) {
      return Array.from(new Set(nums)).sort((a, b) => a - b);
    }
  }

  // 字母串
  if (compact && LETTERS_RE.test(compact)) {
    const idx = Array.from(new Set(compact.split('').map((c) => c.charCodeAt(0) - 65))).sort((a, b) => a - b);
    if (idx[idx.length - 1] >= n) {
      let ok = '';
      for (let i = 0; i < n; i++) ok += String.fromCharCode(65 + i);
      throw AnswerError('答案字母超出选项范围（本题只有 ' + n + ' 个选项：' + ok + '）');
    }
    return idx;
  }

  // 兜底一：答案直接写成选项文本
  const cleaned = stripLabel(s);
  const hits = [];
  for (let i = 0; i < n; i++) {
    if (stripLabel(options[i]) === cleaned) hits.push(i);
  }
  if (hits.length === 1) return hits;

  // 兜底二：多个选项文本用分隔符拼接
  const parts = s.split(/[\s\u00a0\u3000,，、;；/|·.。:：()（）[\]【】{}<>"'“”‘’_\-－—~*]+/).filter((p) => p.trim());
  if (parts.length > 1) {
    const out = new Set();
    for (const p of parts) {
      const h = [];
      const pc = stripLabel(p);
      for (let i = 0; i < n; i++) {
        if (stripLabel(options[i]) === pc) h.push(i);
      }
      if (h.length !== 1) throw AnswerError('答案无法识别：' + s);
      out.add(h[0]);
    }
    if (out.size) return Array.from(out).sort((a, b) => a - b);
  }

  throw AnswerError('答案无法识别：' + s);
}

/** 展示序 -> 原始下标：order[k] = 第 k 个展示的是原第几个选项。rng 可注入便于测试。 */
function buildDisplayOrder(n, shuffle, rng) {
  const order = [];
  for (let i = 0; i < n; i++) order.push(i);
  if (shuffle) {
    const rand = rng || Math.random;
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
  }
  return order;
}

/** 原始答案下标 -> 展示下标（升序）。 */
function mapAnswer(answerOrig, order) {
  const inv = {};
  for (let disp = 0; disp < order.length; disp++) inv[order[disp]] = disp;
  return (answerOrig || []).filter((a) => a in inv).map((a) => inv[a]).sort((a, b) => a - b);
}

function displayOptions(options, order) {
  return order.map((i) => options[i]);
}

/** 答案展示文本：判断题给"正确/错误"，其余给字母串。 */
function answerText(qtype, optionsDisplay, answerDisp) {
  if (qtype === 'judge') {
    if (answerDisp && answerDisp.length && answerDisp[0] >= 0 && answerDisp[0] < optionsDisplay.length) {
      return optionsDisplay[answerDisp[0]];
    }
    return '';
  }
  return idxToLetters(answerDisp);
}

/** 多选全对才得分；单选/判断是单元素集合比较；空选判错。 */
function isCorrect(chosen, answerDisp) {
  const c = Array.from(new Set((chosen || []).map((x) => parseInt(x, 10)))).sort((a, b) => a - b);
  const a = Array.from(new Set((answerDisp || []).map((x) => parseInt(x, 10)))).sort((a, b) => a - b);
  if (!c.length) return false;
  return c.length === a.length && c.every((v, i) => v === a[i]);
}

/** 作答/答案的展示文本；未作答给空串。 */
function selText(qtype, optionsDisplay, idxs) {
  if (!idxs || !idxs.length) return '';
  const list = Array.from(new Set(idxs.map((i) => parseInt(i, 10)))).sort((a, b) => a - b);
  if (qtype === 'judge') {
    if (list[0] >= 0 && list[0] < optionsDisplay.length) return optionsDisplay[list[0]];
    return '';
  }
  return idxToLetters(list);
}

function groupTitle(orderIndex, qtype) {
  const num = orderIndex < CN_NUM.length ? CN_NUM[orderIndex] : String(orderIndex + 1);
  return num + '、' + (QTYPE_NAME[qtype] || '题目');
}

// ---------------------------------------------------------------- 答题括号
const PAREN_GAP = { single: 2, judge: 2, multi: 6 };
const BLANK_PAREN_RE = /[（(][\s\u3000]*[）)]/g;

function blankParen(gap) {
  return '（' + '\u3000'.repeat(Math.max(1, gap)) + '）';
}

/** 保证题干带一个空括号，且括号中间宽度按题型固定（单选/判断 2，多选 6）。 */
function ensureAnswerParens(stem, qtype) {
  const s = String(stem || '').replace(/\s+$/, '');
  const gap = PAREN_GAP[qtype] === undefined ? 2 : PAREN_GAP[qtype];
  const pat = blankParen(gap);
  if (BLANK_PAREN_RE.test(s)) {
    BLANK_PAREN_RE.lastIndex = 0;
    return s.replace(BLANK_PAREN_RE, pat);
  }
  if (!s) return pat;
  return s + '\u3000' + pat;
}

module.exports = {
  QTYPES, QTYPE_LABEL, QTYPE_NAME, CN_NUM, JUDGE_OPTIONS, JUDGE_TRUE, JUDGE_FALSE, PAREN_GAP,
  AnswerError,
  idxToLetters,
  parseQtype,
  parseAnswer,
  buildDisplayOrder,
  mapAnswer,
  displayOptions,
  answerText,
  isCorrect,
  selText,
  groupTitle,
  fmtScore: fmtScoreFn,
  accuracy: accuracyFn,
  pyRound,
  blankParen,
  ensureAnswerParens,
};
