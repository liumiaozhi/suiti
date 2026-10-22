// 时钟与随机数：注入进来的唯一目的就是让测试可复现。

const { nowStr } = require('../core/pycompat');

function now() {
  return nowStr();
}

function nowMs() {
  return Date.now();
}

module.exports = { now, nowMs };
