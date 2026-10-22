// 出题设置归一化：与 desktop normalize_settings 对齐
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { normalizeSettings, pickCount } = require(path.resolve(__dirname, '../../../miniprogram/core/settings'));

const base = { bank_id: 7, types: ['single', 'multi'], amount_mode: 'all' };

test('题库 ID 是字符串（小程序用字符串 id，不能 parseInt）', () => {
  const st = normalizeSettings({
    bank_id: 'bmviw8e5b6128', types: ['single'], amount_mode: 'all', score: { single: 2 },
  });
  assert.strictEqual(st.bank_id, 'bmviw8e5b6128');
  // 数字形式的 id 也要兼容（桌面版是数字）
  assert.strictEqual(normalizeSettings({ bank_id: 7, types: ['single'], score: { single: 1 } }).bank_id, '7');
});

test('分值按题型分别设置', () => {
  const st = normalizeSettings(Object.assign({}, base, { score: { single: 2, multi: 4, judge: 1 } }));
  assert.deepStrictEqual(st.scores, { single: 2, multi: 4, judge: 1 });
  assert.strictEqual(st.score_per_q, 2, '兼容字段取第一个题型的分值');
});

test('老调用方只给 score_per_q 时铺到所有题型', () => {
  const st = normalizeSettings(Object.assign({}, base, { score_per_q: 2.5 }));
  assert.deepStrictEqual(st.scores, { single: 2.5, multi: 2.5, judge: 2.5 });
});

test('校验只针对勾选的题型', () => {
  // judge 没勾，分值 0 不报错
  const st = normalizeSettings(Object.assign({}, base, { score: { single: 2, multi: 4, judge: 0 } }));
  assert.strictEqual(st.scores.judge, 0);
  // 勾选的题型分值必须 > 0
  assert.throws(
    () => normalizeSettings({ bank_id: 7, types: ['single', 'judge'], score: { single: 2, judge: 0 } }),
    /请为判断题填写大于 0 的分值/
  );
});

test('入参校验', () => {
  assert.throws(() => normalizeSettings({ types: ['single'] }), /请先选择题库/);
  assert.throws(() => normalizeSettings({ bank_id: 1, types: [] }), /请至少勾选一种题型/);
  assert.throws(() => normalizeSettings({ bank_id: 1, types: ['single'], score: { single: 5000 } }), /分值过大/);
});

test('题型顺序与开关默认值', () => {
  const st = normalizeSettings({
    bank_id: 1, types: ['judge', 'single', 'multi'],
    q_order: '乱写', a_order: '乱写',
    score: { single: 1, multi: 1, judge: 1 },
  });
  assert.deepStrictEqual(st.types, ['single', 'multi', 'judge']);
  assert.strictEqual(st.q_order, 'asc');
  assert.strictEqual(st.a_order, 'keep');
});

test('抽题数量：全量 / 按设置取小值 / 没填按全量', () => {
  const all = normalizeSettings(Object.assign({}, base, { score: { single: 1, multi: 1 } }));
  assert.strictEqual(pickCount(all, 'single', 12), 12);
  const num = normalizeSettings({
    bank_id: 7, types: ['single'], amount_mode: 'num', amount: { single: 5 },
    score: { single: 1 },
  });
  assert.strictEqual(pickCount(num, 'single', 12), 5);
  assert.strictEqual(pickCount(num, 'single', 3), 3, '不足则截断');
  assert.strictEqual(pickCount(num, 'multi', 8), 8, '没填数量按全量');
});
