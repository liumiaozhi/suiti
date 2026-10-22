// 出卷 golden 比对 + 不变式测试（desktop session.preview / create_session）
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const { normalizeSettings } = require(path.resolve(__dirname, '../../../miniprogram/core/settings'));
const paper = require(path.resolve(__dirname, '../../../miniprogram/core/paper'));
const grading = require(path.resolve(__dirname, '../../../miniprogram/core/grading'));

const sess = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../fixtures/session.json'), 'utf8')
).cases;
const previewCase = sess.find((c) => c.name.indexOf('预览') === 0);
const itemsCase = sess.find((c) => c.expectItems);

const norm = (x) => JSON.parse(JSON.stringify(x, (k, v) => (Object.is(v, -0) ? 0 : v)));

function poolsOf(questions) {
  const pools = { single: [], multi: [], judge: [] };
  for (const q of questions) {
    (pools[q.qtype] || (pools[q.qtype] = [])).push(q);
  }
  return pools;
}

test('golden：预览出卷（题量 / 各题型分值 / 满分）', () => {
  const st = normalizeSettings(previewCase.settings);
  const got = paper.planPaper(st, poolsOf(previewCase.questions), 'bank', '黄金题库');
  assert.strictEqual(got.total, previewCase.expect.total);
  assert.strictEqual(got.score_total, previewCase.expect.score_total);
  assert.deepStrictEqual(norm(got.by_type), norm(previewCase.expect.by_type));
  assert.deepStrictEqual(norm(got.scores), norm(previewCase.expect.scores));
  assert.deepStrictEqual(norm(got.warnings), norm(previewCase.expect.warnings));
  // 满分 = 各题型题量 × 该题型分值
  const want = Object.keys(got.by_type).reduce(
    (s, t) => s + got.by_type[t].picked * got.scores[t],
    0
  );
  assert.strictEqual(got.score_total, want);
});

test('golden：确定性卷面 items 逐字段一致', () => {
  const st = normalizeSettings(previewCase.settings);
  const picked = paper.selectQuestions(st, poolsOf(previewCase.questions));
  const items = paper.buildItems(st, picked);
  assert.strictEqual(items.length, itemsCase.expectItems.length);
  for (let i = 0; i < items.length; i++) {
    const got = items[i];
    const want = itemsCase.expectItems[i];
    assert.strictEqual(got.pos, want.pos, 'pos ' + want.pos);
    assert.strictEqual(got.qtype, want.qtype);
    assert.strictEqual(got.stem, want.stem);
    assert.deepStrictEqual(got.options, want.options);
    assert.deepStrictEqual(got.order, want.order);
    assert.deepStrictEqual(got.answer_disp, want.answer_disp);
    assert.strictEqual(got.answer_text, want.answer_text);
    assert.strictEqual(got.score, want.score);
  }
});

test('题型顺序固定 单选 -> 多选 -> 判断', () => {
  const st = normalizeSettings({
    bank_id: 1,
    types: ['judge', 'multi', 'single'], // 故意乱序传入
    amount_mode: 'all',
    score: { single: 2, multi: 4, judge: 1 },
  });
  assert.deepStrictEqual(st.types, ['single', 'multi', 'judge']);
  const picked = paper.selectQuestions(st, poolsOf(previewCase.questions));
  assert.deepStrictEqual(
    picked.map((q) => q.qtype),
    ['single', 'single', 'single', 'single', 'multi', 'multi', 'judge', 'judge']
  );
});

test('倒序只在题型内部生效', () => {
  const st = normalizeSettings({
    bank_id: 1,
    types: ['single', 'multi', 'judge'],
    amount_mode: 'all',
    q_order: 'desc',
    score: { single: 2, multi: 4, judge: 1 },
  });
  const picked = paper.selectQuestions(st, poolsOf(previewCase.questions));
  const singles = picked.filter((q) => q.qtype === 'single').map((q) => q.stem);
  const asc = previewCase.questions.filter((q) => q.qtype === 'single').map((q) => q.stem);
  assert.deepStrictEqual(singles, asc.slice().reverse());
});

test('判断题不打乱选项，其他题型按 a_order 打乱', () => {
  const keep = normalizeSettings({
    bank_id: 1, types: ['single', 'multi', 'judge'], amount_mode: 'all',
    a_order: 'keep', score: { single: 2, multi: 4, judge: 1 },
  });
  const shuffle = normalizeSettings({
    bank_id: 1, types: ['single', 'multi', 'judge'], amount_mode: 'all',
    a_order: 'shuffle', score: { single: 2, multi: 4, judge: 1 },
  });
  const pools = poolsOf(previewCase.questions);
  const a = paper.buildItems(keep, paper.selectQuestions(keep, pools));
  const b = paper.buildItems(shuffle, paper.selectQuestions(shuffle, pools));
  for (const it of a) assert.deepStrictEqual(it.order, it.options.map((_, i) => i), 'keep 时是恒等顺序');
  const judge = b.find((it) => it.qtype === 'judge');
  assert.deepStrictEqual(judge.order, [0, 1], '判断题不打乱');
  assert.deepStrictEqual(judge.options_disp, ['正确', '错误']);
});

test('不变式：任意打乱下答案映射都自洽（1000 次）', () => {
  const st = normalizeSettings({
    bank_id: 1, types: ['single', 'multi', 'judge'], amount_mode: 'all',
    q_order: 'random', a_order: 'shuffle', score: { single: 2, multi: 4, judge: 1 },
  });
  const pools = poolsOf(previewCase.questions);
  for (let i = 0; i < 1000; i++) {
    const items = paper.buildItems(st, paper.selectQuestions(st, pools));
    for (const it of items) {
      const shown = it.answer_disp.map((d) => it.options_disp[d]).sort();
      const orig = it.answer_disp.length ? shown : [];
      assert.ok(orig.length >= 1, '答案不能为空');
      // 展示出来的答案文本，必须能在原始选项里找到（按 answer_disp 反查 order）
      for (const d of it.answer_disp) {
        assert.strictEqual(it.options_disp[d], it.options[it.order[d]], '映射错乱');
      }
      assert.strictEqual(grading.answerText(it.qtype, it.options_disp, it.answer_disp), it.answer_text);
    }
  }
});

test('预览：没有题目时抛错而不是返回空卷', () => {
  const st = normalizeSettings({ bank_id: 1, types: ['single'], amount_mode: 'all', score: { single: 2 } });
  assert.throws(() => paper.planPaper(st, { single: [] }, 'bank', '黄金题库'), /没有抽到任何题目/);
  assert.throws(() => paper.planPaper(st, { single: [] }, 'hard', '黄金题库'), /重难错题里还没有/);
});
