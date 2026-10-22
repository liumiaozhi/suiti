// xlsx 导入管线单测：写入 -> 读回 -> 解析，验证内置 SheetJS + importer 闭环。
// Node 侧直接 require 工程内的 utils/xlsx（内部 require vendor UMD），无需小程序运行时。
const test = require('node:test');
const assert = require('node:assert');

const xlsx = require('../../../miniprogram/utils/xlsx');
const importer = require('../../../miniprogram/core/importer');

function buildBookRows() {
  return [
    ['题型', '题干', '选项', '正确答案'],
    ['单选', '中国的首都是哪里？', '北京|上海|广州', 'A'],
    ['多选', '下列哪些是水果？', '苹果|萝卜|香蕉|白菜', 'A,C'],
    ['判断', '地球是球体。', '', '正确'],
    ['单选', '1+1=?', '1|2|3', 'B'],
  ];
}

test('xlsx 写->读->解析 全闭环', () => {
  const ab = xlsx.writeSheets([{ name: '题库', rows: buildBookRows() }]);
  assert.ok(ab.byteLength > 0, '写出的 xlsx 不应为空');

  const rows = xlsx.readFirstSheet(ab);
  assert.strictEqual(rows.length, 5, '应读回 5 行（含表头）');

  const parsed = importer.parseRows(rows);
  assert.strictEqual(parsed.questions.length, 4, '应解析出 4 道题');
  assert.strictEqual(parsed.errors.length, 0, '示例数据不应有错误');

  const [q1, q2, q3, q4] = parsed.questions;
  assert.strictEqual(q1.qtype, 'single');
  assert.deepStrictEqual(q1.answer, [0]);
  assert.strictEqual(q1.answer_text, 'A');

  assert.strictEqual(q2.qtype, 'multi');
  assert.deepStrictEqual(q2.answer, [0, 2]); // 苹果、香蕉
  assert.strictEqual(q2.answer_text, 'A,C');

  assert.strictEqual(q3.qtype, 'judge');
  assert.deepStrictEqual(q3.answer, [0]);
  assert.strictEqual(q3.answer_text, '正确');

  assert.strictEqual(q4.answer_text, 'B');
});

test('缺表头应抛错', () => {
  const rows = [
    ['苹果', '香蕉'],
    ['单选', '测试', 'a|b', 'A'],
  ];
  assert.throws(() => importer.parseRows(rows));
});

test('选项不足 2 个应记错误而非崩溃', () => {
  const rows = [
    ['题型', '题干', '选项', '正确答案'],
    ['单选', '只有一项', '唯一', 'A'],
  ];
  const parsed = importer.parseRows(rows);
  assert.strictEqual(parsed.questions.length, 0);
  assert.strictEqual(parsed.errors.length, 1);
  assert.match(parsed.errors[0].msg, /选项少于 2 个/);
});
