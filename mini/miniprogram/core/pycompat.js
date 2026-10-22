// Python 兼容性：舍入与格式化。
//
// 两个必须复刻的差异（desktop 侧是 Python）：
//   1) round() 是**银行家舍入**（round(2.5) === 2，而不是 JS 的 3）；
//      且它舍入的是浮点数的**精确二进制值**：round(2.675, 2) === 2.67，
//      因为 2.675 的真实值是 2.6749999999999998。
//   2) 时间用本地时间 "+08:00" 的 YYYY-MM-DD HH:MM:SS，绝不能用 toISOString()（那是 UTC，会差 8 小时）。

/** 十进制字符串按位 +1（处理进位），用于精确实现"进位到偶数"。 */
function decimalIncrement(intPart, frac) {
  const f = frac.split('');
  let carry = 1;
  for (let i = f.length - 1; i >= 0 && carry; i--) {
    const d = f[i].charCodeAt(0) - 48 + 1;
    if (d === 10) {
      f[i] = '0';
      carry = 1;
    } else {
      f[i] = String(d);
      carry = 0;
    }
  }
  let ip = intPart.split('');
  if (carry) {
    for (let i = ip.length - 1; i >= 0 && carry; i--) {
      const d = ip[i].charCodeAt(0) - 48 + 1;
      if (d === 10) {
        ip[i] = '0';
        carry = 1;
      } else {
        ip[i] = String(d);
        carry = 0;
      }
    }
    if (carry) ip.unshift('1');
  }
  return ip.join('') + (f.length ? '.' + f.join('') : '');
}

/**
 * Python round(v, ndigits) 的等价实现：四舍五入到最近的偶数（banker's rounding），
 * 且舍入依据是浮点数的**真实值**。
 *
 * 为什么不能简单地 `Math.round(v * 10**n)`：
 *   - Math.round 是四舍五入（half up），而 Python 是 half to even：round(2.5) === 2；
 *   - v * 10**n 本身会引入新的浮点误差，2.675 * 100 在 JS 里会得到 267.50000000000006，
 *     于是算出 2.68，而 Python 的 round(2.675, 2) 是 2.67。
 * 所以这里先把浮点数展开成足够长的十进制字符串（toFixed(20) 能还原真实值），
 * 再做基于字符串的 half-to-even 舍入。
 */
function pyRound(v, ndigits) {
  if (!Number.isFinite(v)) return v;
  const nd = ndigits || 0;
  if (nd < 0) {
    const p = Math.pow(10, -nd);
    return Math.round(v / p) * p;
  }
  const str = v.toFixed(20);
  const neg = str.charAt(0) === '-';
  const body = neg ? str.slice(1) : str;
  const dot = body.indexOf('.');
  const intPart = dot < 0 ? body : body.slice(0, dot);
  const fracPart = dot < 0 ? '' : body.slice(dot + 1);

  if (fracPart.length <= nd) {
    return Number(v);
  }
  const keep = fracPart.slice(0, nd);
  const rest = fracPart.slice(nd);
  const first = rest.charAt(0);
  let up = false;
  if (first > '5') {
    up = true;
  } else if (first === '5') {
    if (/[1-9]/.test(rest.slice(1))) {
      up = true; // 超过一半
    } else {
      // 恰好一半：保留位的末位为奇数才进位（结果变成偶数）
      const lastKeep = nd > 0 ? keep.charAt(nd - 1) : intPart.charAt(intPart.length - 1);
      up = Number(lastKeep) % 2 !== 0;
    }
  }
  const result = up ? decimalIncrement(intPart, keep) : intPart + (nd > 0 ? '.' + keep : '');
  return Number((neg ? '-' : '') + result);
}

/** 与 Python "%.2f" % v 等价（先按 Python 规则舍入到 2 位，再固定输出两位小数）。 */
function pyFormat2f(v) {
  return pyRound(v, 2).toFixed(2);
}

/** 分数展示：整数不显示小数，小数去掉尾随 0（与 grading.fmt_score 一致）。 */
function fmtScore(v) {
  if (v === null || v === undefined) return '0';
  const f = Number(v);
  if (!Number.isFinite(f)) return '0';
  if (Math.abs(f - pyRound(f)) < 1e-9) return String(pyRound(f));
  return pyFormat2f(f).replace(/0+$/, '').replace(/\.$/, '');
}

/** 正确率：保留一位小数（与 grading.accuracy 一致）。 */
function accuracy(right, base) {
  if (!base) return 0;
  return pyRound((right * 100.0) / base, 1);
}

/** 本地时间字符串 "YYYY-MM-DD HH:MM:SS"（与 db.now_str 一致）。 */
function nowStr(d) {
  const t = d || new Date();
  const p = (n, w) => String(n).padStart(w || 2, '0');
  return (
    t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()) + ' ' +
    p(t.getHours()) + ':' + p(t.getMinutes()) + ':' + p(t.getSeconds())
  );
}

module.exports = { pyRound, pyFormat2f, fmtScore, accuracy, nowStr };
