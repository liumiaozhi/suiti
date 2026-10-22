// 交卷评分与记录统计 golden 比对（desktop session.submit / stats.py）
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const stats = require(path.resolve(__dirname, '../../../miniprogram/core/stats'));

const sess = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../fixtures/session.json'), 'utf8')
).cases;
const items = sess.find((c) => c.expectItems).expectItems;
const practiceCase = sess.find((c) => c.name.indexOf('练习交卷') === 0);
const examCase = sess.find((c) => c.name.indexOf('正式考试交卷') === 0);

const norm = (x) => JSON.parse(JSON.stringify(x, (k, v) => (Object.is(v, -0) ? 0 : v)));

/** 构造作答：前 n 题按正确答案，wrongAt 那题故意选错，其余不答 */
function makeAnswers(n, wrongAt) {
  return items.map((it) => {
    if (it.pos <= n) return { qtype: it.qtype, score: it.score, chosen: it.answer_disp, answer_disp: it.answer_disp };
    if (it.pos === wrongAt) {
      const wrong = [0].filter((x) => it.answer_disp.indexOf(x) < 0);
      const chosen = wrong.length ? wrong : [it.answer_disp.indexOf(0) >= 0 ? 1 : 0];
      return { qtype: it.qtype, score: it.score, chosen, answer_disp: it.answer_disp };
    }
    return { qtype: it.qtype, score: it.score, chosen: [], answer_disp: it.answer_disp };
  });
}

test('golden：练习交卷（对4、错1、未答3）—— 练习模式不产生漏答', () => {
  const session = { session_id: 1, mode: 'practice', total: items.length, status: 'submitted' };
  const g = stats.gradeSession(session, makeAnswers(4, 5));
  const e = practiceCase.expect;
  assert.strictEqual(g.right, e.right, 'right');
  assert.strictEqual(g.wrong, e.wrong, 'wrong');
  assert.strictEqual(g.missing, e.missing, 'missing');
  assert.strictEqual(g.score, e.score, 'score');
  assert.strictEqual(g.score_total, e.score_total, 'score_total');
  assert.strictEqual(g.accuracy, e.accuracy, 'accuracy');
  assert.strictEqual(g.done_cnt, 5, '未答的不算做题数');
});

test('golden：正式考试交卷（对3、漏5）—— 未答计入漏答，正确率按题量', () => {
  const session = { session_id: 2, mode: 'exam', total: items.length, status: 'submitted' };
  const g = stats.gradeSession(session, makeAnswers(3, 0));
  const e = examCase.expect;
  assert.strictEqual(g.right, e.right);
  assert.strictEqual(g.wrong, e.wrong);
  assert.strictEqual(g.missing, e.missing);
  assert.strictEqual(g.score, e.score);
  assert.strictEqual(g.score_total, e.score_total);
  assert.strictEqual(g.accuracy, e.accuracy);
});

test('得分 = 答对题的分值之和，满分 = 全部题分值之和', () => {
  const session = { mode: 'exam', total: items.length };
  const g = stats.gradeSession(session, makeAnswers(4, 5));
  assert.strictEqual(g.score_total, 18, '4×2 + 2×4 + 2×1');
  assert.strictEqual(g.score, 8, '只对的前 4 道单选');
});

test('练习模式未答不算漏答，考试模式算', () => {
  const none = items.map((it) => ({ qtype: it.qtype, score: it.score, chosen: [], answer_disp: it.answer_disp }));
  const p = stats.gradeSession({ mode: 'practice', total: items.length }, none);
  assert.strictEqual(p.missing, 0);
  assert.strictEqual(p.done_cnt, 0);
  const e = stats.gradeSession({ mode: 'exam', total: items.length }, none);
  assert.strictEqual(e.missing, items.length);
});

test('做题记录与考试记录的统计口径', () => {
  const pr = stats.practiceRecords(
    [
      { bank_id: 1, bank_name: '黄金题库', right: 7, wrong: 3, missing: 0, done_cnt: 10, session_cnt: 2, last_at: 'x' },
      { bank_id: 2, bank_name: '练习库', right: 5, wrong: 5, missing: 0, done_cnt: 10, session_cnt: 1, last_at: 'y' },
    ],
    3
  );
  assert.strictEqual(pr.overall.done_cnt, 20);
  assert.strictEqual(pr.overall.right, 12);
  assert.strictEqual(pr.overall.accuracy, 60);
  assert.strictEqual(pr.overall.bank_cnt, 2);
  assert.strictEqual(pr.overall.bank_total, 3);
  assert.strictEqual(pr.by_bank[0].accuracy, 70);

  const er = stats.examRecords(
    [
      { session_id: 1, bank_name: '黄金题库', candidate: '张三', total: 8, right: 6, wrong: 1, missing: 1, score: 12, score_total: 18 },
      { session_id: 2, bank_name: '黄金题库', candidate: '李四', total: 8, right: 4, wrong: 2, missing: 2, score: 8, score_total: 18 },
    ],
    1,
    50
  );
  assert.strictEqual(er.overall.exam_cnt, 2);
  assert.strictEqual(er.overall.bank_cnt, 1, '同一题库只算一次');
  assert.strictEqual(er.overall.total_q, 16);
  assert.strictEqual(er.overall.accuracy, 62.5, '考试正确率按题量：10/16');
  assert.deepStrictEqual(norm(er.rows[0].accuracy), 75);
});
