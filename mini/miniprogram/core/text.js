// 文本处理：与 desktop app/services/grading.py 的 strip_sep / strip_label / normalize_text
// 以及 bank_import.py 的 _cell_text 逐字对齐。
//
// 铁律：这里不能有 wx、不能有 DOM、不能读全局状态。

// 与 Python _SEP_RE 等价：[\s\u00a0\u3000,，、;；/|·.。:：()（）[]【】{}<>"'“”‘’_\-－—~*]+
const SEP_RE = /[\s\u00a0\u3000,，、;；/|·.。:：()（）[\]【】{}<>"'“”‘’_\-－—~*]+/g;

// 与 Python _LABEL_RE 等价：^[\s(（\[]*[A-Za-z1-9][\s)）\].、,:：]+
const LABEL_RE = /^[\s(（\[]*[A-Za-z1-9][\s)）\].、,:：]+/;

/** 去掉所有分隔符与空白（用于答案归一化比较）。 */
function stripSep(text) {
  return (text || '').replace(SEP_RE, '');
}

/** 去掉选项前缀标签：'A. foo' / 'A、foo' / '（1）foo' -> 'foo'。循环到稳定。 */
function stripLabel(text) {
  let t = (text || '').trim();
  let prev = null;
  while (prev !== t) {
    prev = t;
    t = t.replace(LABEL_RE, '').trim();
  }
  return t;
}

/** NFKC 归一 + 去除首尾空白（与 Python unicodedata.normalize("NFKC") 对齐）。 */
function normalizeText(raw) {
  return String(raw === null || raw === undefined ? '' : raw).normalize('NFKC').trim();
}

/** Excel 单元格值 -> 文本（与 bank_import._cell_text 一致：整数浮点转整数、去首尾空白）。
 *  注意这里**不做** NFKC 归一 —— Python 侧只是 str(v).strip()。 */
function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return String(v);
    if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
    return String(v).trim();
  }
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

module.exports = { SEP_RE, LABEL_RE, stripSep, stripLabel, normalizeText, cellText };
