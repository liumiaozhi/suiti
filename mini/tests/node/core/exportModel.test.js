// 导出视图模型 golden 比对（desktop export/model.py）
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const em = require(path.resolve(__dirname, '../../../miniprogram/core/exportModel'));
const grading = require(path.resolve(__dirname, '../../../miniprogram/core/grading'));

const exp = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../fixtures/export.json'), 'utf8')
).cases[0].expect;
const items = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../fixtures/session.json'), 'utf8')
).cases.find((c) => c.expectItems).expectItems;

const norm = (x) => JSON.parse(JSON.stringify(x, (k, v) => (Object.is(v, -0) ? 0 : v)));

function vmOf() {
  return em.buildPaperVm({
    session_id: 1,
    mode: 'exam',
    bank_name: '黄金题库',
    candidate: '张三 001',
    scores: { single: 2, multi: 4, judge: 1 },
    items,
  });
}

test('golden：视图模型与桌面版一致', () => {
  const vm = vmOf();
  assert.strictEqual(vm.title, exp.title, '标题应只用题库名');
  assert.strictEqual(vm.mode_title, exp.mode_title);
  assert.strictEqual(vm.total, exp.total);
  assert.strictEqual(vm.score_total, exp.score_total);
  assert.deepStrictEqual(norm(vm.scores), norm(exp.scores));
  assert.strictEqual(vm.groups.length, exp.groupCount);
  assert.deepStrictEqual(vm.groups.map((g) => g.name), exp.groupTitles);
  assert.deepStrictEqual(norm(vm.groups.map((g) => g.score)), norm(exp.groupScores));
  assert.deepStrictEqual(norm(vm.answer_sheet), norm(exp.answerSheet));
});

test('卷头四项：题量、满分、考生信息、得分', () => {
  const vm = vmOf();
  assert.strictEqual(vm.show_candidate, true, '练习卷也要保留考生信息');
  assert.strictEqual(vm.show_score, true);
  assert.strictEqual(em.headerMiddle(vm), '共 8 题\u3000满分 18 分');
  assert.strictEqual(vm.candidate, '张三 001');
});

test('大题副标题按各题型分值算', () => {
  const vm = vmOf();
  assert.strictEqual(em.groupSubtitle(vm.groups[0]), '每题 2 分，共 4 题，共 8 分');
  assert.strictEqual(em.groupSubtitle(vm.groups[1]), '每题 4 分，共 2 题，共 8 分');
  assert.strictEqual(em.groupSubtitle(vm.groups[2]), '每题 1 分，共 2 题，共 2 分');
});

test('重难错题导出：无分值，只给题量', () => {
  const vm = em.buildHardVm('黄金题库', [
    { qtype: 'single', stem: '甲题', options: ['甲', '乙'], answer_text: 'A' },
    { qtype: 'multi', stem: '乙题', options: ['甲', '乙', '丙'], answer_text: 'A,C' },
  ]);
  assert.strictEqual(vm.title, '黄金题库');
  assert.strictEqual(vm.score_total, 0);
  assert.strictEqual(vm.groups[0].score, 0);
  assert.strictEqual(em.groupSubtitle(vm.groups[0]), '共 1 题');
  assert.strictEqual(em.headerMiddle(vm), '共 2 题', '没有满分就不显示');
});

test('题干答题括号按题型补/改宽（在渲染前处理）', () => {
  // 视图模型里仍保留原题干，括号处理在渲染那一步做，这里验证规则挂在同一处
  assert.strictEqual(grading.ensureAnswerParens('题干（　）', 'single'), '题干（　　）');
  assert.strictEqual(grading.ensureAnswerParens('题干（　）', 'multi').length, '题干'.length + 2 + 6);
});

test('文件名：题库名 + 时间戳 + 考生，不含练习/考试字样', () => {
  const vm = vmOf();
  const name = em.defaultFileName(vm, 'pdf', '20261022_0855');
  assert.strictEqual(name, '黄金题库_20261022_0855_张三 001.pdf');
  assert.ok(!/练习|模拟|正式考试/.test(name));
  assert.strictEqual(
    em.defaultFileName({ bank_name: '黄金题库', candidate: '', show_score: true }, 'docx', '20261022_0855'),
    '黄金题库_20261022_0855.docx'
  );
});
