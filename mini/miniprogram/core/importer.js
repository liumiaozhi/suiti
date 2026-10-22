// Excel 题库解析：与 desktop app/services/bank_import.py 的解析部分逐条对齐。
//
// 输入是**二维数组**（SheetJS 的 sheet_to_json({header:1}) 产物），
// 读文件那一段在 pkg-io-import 里，这里只管"行 -> 题目"，因此可以在 Node 里直接单测。
//
// 两种选项写法都支持：
//   1) 「选项」单列，用 | 或换行分隔；
//   2) 「选项A」~「选项H」多个列。
// 两种同时填时**只认单列**（与桌面版一致）。

const { stripLabel, normalizeText, cellText } = require('./text');
const grading = require('./grading');

const HEADERS = [
  '题型', '题干', '选项',
  '选项A', '选项B', '选项C', '选项D', '选项E', '选项F', '选项G', '选项H',
  '正确答案',
];

const HEAD_ALIAS = {
  题型: 'qtype', 类型: 'qtype', 题目类型: 'qtype',
  题干: 'stem', 题目: 'stem', 问题: 'stem', 题目内容: 'stem',
  选项: 'options', 选项内容: 'options', 备选项: 'options',
  正确答案: 'answer', 答案: 'answer', 标准答案: 'answer', 正确选项: 'answer', 参考答案: 'answer',
};

const OPT_COL_RE = /^选项\s*([A-Z])$/;
// 单列选项的分隔符：竖线或换行（Python: r"[|\r\n]+"）
const SPLIT_RE = /[|\r\n]+/;

/** 表头文本 -> 归一化 key：取「（」之前的部分，去掉空格。 */
function headKey(text) {
  let s = normalizeText(text);
  if (!s) return '';
  s = s.split(/[（(]/)[0].trim();
  return s.replace(/ /g, '').replace(/\u3000/g, '');
}

/**
 * 找表头行：前 15 行内，必须同时有「题干」和（「题型」或「正确答案」）。
 * @returns {{headRow:number, colmap:Object, optCols:Object}}
 */
function findHeader(rows) {
  const maxRow = Math.min(15, rows.length);
  for (let r = 0; r < maxRow; r++) {
    const row = rows[r] || [];
    const colmap = {};
    const optCols = {};
    for (let c = 0; c < row.length; c++) {
      const key = headKey(row[c]);
      if (!key) continue;
      const m = OPT_COL_RE.exec(key);
      if (m) {
        optCols[m[1]] = c + 1; // 1 基列号
        continue;
      }
      const field = HEAD_ALIAS[key];
      if (field && colmap[field] === undefined) colmap[field] = c + 1;
    }
    if (colmap.stem !== undefined && (colmap.qtype !== undefined || colmap.answer !== undefined)) {
      return { headRow: r + 1, colmap, optCols };
    }
  }
  return { headRow: 0, colmap: {}, optCols: {} };
}

/**
 * @param {Array<Array>} rows 二维数组（含表头行）
 * @returns {{questions:Array, errors:Array, warnings:Array}}
 */
function parseRows(rows) {
  const all = rows || [];
  const { headRow, colmap, optCols } = findHeader(all);
  if (!headRow) {
    throw grading.AnswerError(
      '找不到表头行，请使用「下载模板」生成的表格填写（需包含「题干」「正确答案」列）'
    );
  }

  const questions = [];
  const errors = [];
  const warnings = [];
  const seen = {};

  const cell = (row, field) => {
    const idx = colmap[field];
    if (!idx || idx - 1 >= row.length) return '';
    return cellText(row[idx - 1]);
  };

  for (let rowIdx = headRow + 1; rowIdx <= all.length; rowIdx++) {
    const row = all[rowIdx - 1] || [];
    const stem = cell(row, 'stem');
    const qtypeRaw = cell(row, 'qtype');
    const ansRaw = cell(row, 'answer');
    const optColText = cell(row, 'options');

    if (!stem && !qtypeRaw && !ansRaw && !optColText) continue;
    if (!stem) {
      errors.push({ row: rowIdx, msg: '题干为空' });
      continue;
    }

    let qtype;
    try {
      qtype = grading.parseQtype(qtypeRaw);
    } catch (e) {
      errors.push({ row: rowIdx, msg: e.message });
      continue;
    }

    let options = [];
    if (qtype === 'judge') {
      options = grading.JUDGE_OPTIONS.slice();
      if (optColText) {
        warnings.push({ row: rowIdx, msg: '判断题的选项已自动按「正确/错误」处理，填写的选项被忽略' });
      }
    } else if (optColText) {
      options = optColText
        .split(SPLIT_RE)
        .map((p) => stripLabel(p))
        .filter((p) => p);
    } else {
      const letters = Object.keys(optCols).sort();
      for (const letter of letters) {
        const idx = optCols[letter];
        if (idx - 1 < row.length) {
          const t = stripLabel(cellText(row[idx - 1]));
          if (t) options.push(t);
        }
      }
    }
    if (options.length < 2) {
      errors.push({ row: rowIdx, msg: '选项少于 2 个（请用 | 或换行分隔，或填 选项A~H）' });
      continue;
    }

    let answer;
    try {
      answer = grading.parseAnswer(ansRaw, qtype, options);
    } catch (e) {
      errors.push({ row: rowIdx, msg: e.message });
      continue;
    }

    if ((qtype === 'single' || qtype === 'judge') && answer.length !== 1) {
      errors.push({
        row: rowIdx,
        msg: grading.QTYPE_LABEL[qtype] + '只能有 1 个正确答案，当前解析出 ' + answer.length + ' 个',
      });
      continue;
    }
    if (qtype === 'multi' && answer.length < 2) {
      warnings.push({ row: rowIdx, msg: '多选题只有 1 个正确答案，请核对' });
    }

    const answerText = grading.answerText(qtype, options, answer);
    const key = stem + '\u0001' + options.join('|');
    if (seen[key] !== undefined) {
      warnings.push({ row: rowIdx, msg: '与第 ' + seen[key] + ' 行题干重复' });
    } else {
      seen[key] = rowIdx;
    }

    questions.push({
      qtype,
      stem,
      options,
      answer,
      answer_text: answerText,
      source_row: rowIdx,
      raw_type: qtypeRaw,
    });
  }

  return { questions, errors, warnings };
}

module.exports = { HEADERS, HEAD_ALIAS, headKey, findHeader, parseRows };
