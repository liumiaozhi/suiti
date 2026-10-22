// 随机数：小程序侧用 Math.random，测试里可注入固定序列的 rng。

function random() {
  return Math.random();
}

module.exports = { random };
