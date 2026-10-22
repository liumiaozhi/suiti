// golden 驱动：逐条比对 desktop 版真实函数的输出。
// 数据来自 python tools/dump_fixtures.py，改规则前先重跑它。
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const CORE = path.resolve(__dirname, '../../../miniprogram/core');
const g = require(path.join(CORE, 'grading'));
const { pyRound } = require(path.join(CORE, 'pycompat'));

const FIX = path.resolve(__dirname, '../../fixtures/grading.json');
const cases = JSON.parse(fs.readFileSync(FIX, 'utf8')).cases;

const dispatch = {
  'parse_answer.judge': (a) => g.parseAnswer(a[0], a[1], a[2]),
  'parse_answer.single_multi': (a) => g.parseAnswer(a[0], a[1], a[2]),
  'parse_answer.bad': (a) => g.parseAnswer(a[0], a[1], a[2]),
  parens: (a) => g.ensureAnswerParens(a[0], a[1]),
  map_answer: (a) => g.mapAnswer(a[0], a[1]),
  display_options: (a) => g.displayOptions(a[0], a[1]),
  is_correct: (a) => g.isCorrect(a[0], a[1], a[2]),
  answer_text: (a) => g.answerText(a[0], a[1], a[2]),
  sel_text: (a) => g.selText(a[0], a[1], a[2]),
  fmt_score: (a) => g.fmtScore(a[0]),
  accuracy: (a) => g.accuracy(a[0], a[1]),
  pyround: (a) => pyRound(a[0], 2),
  pyround0: (a) => pyRound(a[0]),
  parse_qtype: (a) => g.parseQtype(a[0]),
};

// JSON 无法表达 -0（Python 的 -0.0 落到 fixture 里就是 0），比对前统一成 +0
const norm = (x) => JSON.parse(JSON.stringify(x, (k, v) => (Object.is(v, -0) ? 0 : v)));

test('golden：逐条比对桌面版输出', () => {
  let ran = 0;
  for (const c of cases) {
    if (c.group === 'order') continue; // 打乱不可跨语言复现，另做不变式测试
    const fn = dispatch[c.group];
    assert.ok(fn, '未定义该组的比对函数：' + c.group);
    const label = c.group + ' / ' + c.name;
    if (!c.ok) {
      // 期望抛错，且错误信息一致
      const want = String(c.error || '').replace(/^[^:]+:\s*/, '');
      assert.throws(() => fn(c.args), (err) => {
        assert.strictEqual(err.message, want, label + ' 的错误文案不一致');
        return true;
      }, label + ' 应当抛错');
    } else {
      const got = fn(c.args);
      assert.deepStrictEqual(norm(got), norm(c.expect), label + ' 结果不一致');
    }
    ran++;
  }
  assert.ok(ran >= 90, 'golden 用例太少：' + ran);
});

test('不变式：打乱后答案映射必须自洽（1000 次）', () => {
  const options = ['甲', '乙', '丙', '丁', '戊', '己'];
  const answers = [0, 2, 4];
  for (let i = 0; i < 1000; i++) {
    const order = g.buildDisplayOrder(options.length, true);
    // 1) order 必须是 0..n-1 的排列
    assert.deepStrictEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
    // 2) 展示出来的选项，在展示下标上的答案，必须等于原答案的选项文本
    const shown = g.displayOptions(options, order);
    const disp = g.mapAnswer(answers, order);
    const shownTexts = disp.map((d) => shown[d]).sort();
    const origTexts = answers.map((a) => options[a]).sort();
    assert.deepStrictEqual(shownTexts, origTexts, '第 ' + i + ' 次打乱后答案映射错乱');
    // 3) 不打乱时是恒等映射
    assert.deepStrictEqual(g.buildDisplayOrder(5, false), [0, 1, 2, 3, 4]);
  }
});

test('判分：多选必须全对，空选判错', () => {
  assert.strictEqual(g.isCorrect([0], [0]), true);
  assert.strictEqual(g.isCorrect([1], [0]), false);
  assert.strictEqual(g.isCorrect([], [0]), false);
  assert.strictEqual(g.isCorrect([0, 2], [0, 2]), true);
  assert.strictEqual(g.isCorrect([2, 0], [0, 2]), true, '顺序不影响');
  assert.strictEqual(g.isCorrect([0], [0, 2]), false, '漏选不得分');
  assert.strictEqual(g.isCorrect([0, 1, 2], [0, 2]), false, '多选不得分');
});

test('括号宽度：单选/判断 2，多选 6', () => {
  assert.strictEqual(g.ensureAnswerParens('题干（　）', 'single'), '题干（　　）');
  assert.strictEqual(g.ensureAnswerParens('题干（　）', 'judge'), '题干（　　）');
  assert.strictEqual(g.ensureAnswerParens('题干（　）', 'multi').length, '题干'.length + 2 + 6);
});
