// Excel 导入 golden 比对：15 个用例覆盖两种选项写法、判断题容错、各类报错行号。
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const importer = require(path.resolve(__dirname, '../../../miniprogram/core/importer'));
const cases = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../fixtures/import.json'), 'utf8')
).cases;

const norm = (x) => JSON.parse(JSON.stringify(x, (k, v) => (Object.is(v, -0) ? 0 : v)));

test('golden：Excel 导入逐条比对', () => {
  assert.ok(cases.length >= 15, '用例太少');
  for (const c of cases) {
    const label = c.name;
    if (!c.ok) {
      const want = String(c.error || '').replace(/^[^:]+:\s*/, '');
      assert.throws(() => importer.parseRows(c.rows), (err) => {
        assert.strictEqual(err.message, want, label + ' 的错误文案不一致');
        return true;
      }, label + ' 应当抛错');
      continue;
    }
    const got = importer.parseRows(c.rows);
    assert.deepStrictEqual(norm(got.questions), norm(c.expect.questions), label + ' 题目不一致');
    assert.deepStrictEqual(norm(got.errors), norm(c.expect.errors), label + ' 错误不一致');
    assert.deepStrictEqual(norm(got.warnings), norm(c.expect.warnings), label + ' 提醒不一致');
  }
});

test('判断题 9 种答案写法都能解析成正确下标', () => {
  const rows = [
    ['题型', '题干', '选项', '正确答案'],
    ['判断', '题干1', '', '对'],
    ['判断', '题干2', '', '错'],
    ['判断', '题干3', '', '√'],
    ['判断', '题干4', '', '×'],
    ['判断', '题干5', '', 'T'],
    ['判断', '题干6', '', 'F'],
    ['判断', '题干7', '', '是'],
    ['判断', '题干8', '', '否'],
  ];
  const r = importer.parseRows(rows);
  assert.strictEqual(r.questions.length, 8);
  assert.deepStrictEqual(r.questions.map((q) => q.answer[0]), [0, 1, 0, 1, 0, 1, 0, 1]);
  assert.deepStrictEqual(r.errors, []);
});

test('表头偏移时行号仍然正确（报错指向真实行）', () => {
  const rows = [
    ['题库导入'],
    [],
    ['题型', '题干', '选项', '正确答案'],
    ['单选', '', '甲|乙', 'A'], // 第 4 行：题干为空
  ];
  const r = importer.parseRows(rows);
  assert.deepStrictEqual(r.errors, [{ row: 4, msg: '题干为空' }]);
});
