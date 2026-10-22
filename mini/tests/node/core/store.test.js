// P2：分块存储 + 本地数据层（用内存假实现，不依赖 wx）
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { createFakeStorage } = require('../fakes/storage');
const { createFakeFs } = require('../fakes/fs');
const { createChunkStore } = require(path.resolve(__dirname, '../../../miniprogram/utils/chunkStore'));
const { createLocalRepo, nameKey } = require(path.resolve(__dirname, '../../../miniprogram/utils/repo/local'));

function makeRepo(opts) {
  const o = opts || {};
  const storage = createFakeStorage(o.storage || {});
  const fs = createFakeFs();
  let t = 1690000000000;
  const clock = { now: () => '2026-10-22 09:00:00', nowMs: () => (t += 1000) };
  const repo = createLocalRepo({ storage, fs, clock, rng: () => 0.42 });
  repo.init();
  return { repo, storage, fs, clock };
}

function questionsOf(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      qid: i + 1,
      qtype: ['single', 'multi', 'judge'][i % 3],
      stem: '第 ' + i + ' 题的题干内容，用于占位测试（　）',
      options: i % 3 === 2 ? ['正确', '错误'] : ['甲' + i, '乙' + i, '丙' + i, '丁' + i],
      answer: i % 3 === 1 ? [0, 2] : [i % 2],
      answer_text: i % 3 === 1 ? 'A,C' : i % 3 === 2 ? (i % 2 ? '错误' : '正确') : 'A',
    });
  }
  return out;
}

test('chunkStore：小对象进 storage，大对象进文件', () => {
  const { repo, storage, fs } = makeRepo();
  const store = createChunkStore(storage, fs);
  const small = store.put('x/small', { a: 1 });
  assert.strictEqual(small.kind, 'storage');
  const big = store.put('x/big', { list: new Array(40000).fill('中文字占位') });
  assert.strictEqual(big.kind, 'file');
  assert.deepStrictEqual(store.get(small), { a: 1 });
  assert.strictEqual(store.get(big).list.length, 40000);
  store.del(small);
  assert.strictEqual(store.get(small, null), null);
});

test('chunkStore：storage 写满时自动降级到文件且不丢数据', () => {
  const { repo, storage, fs } = makeRepo();
  const store = createChunkStore(storage, fs);
  storage.setLimit(2048); // 2KB 上限
  const ref = store.put('x/mid', { list: new Array(3000).fill('占位') });
  assert.strictEqual(ref.kind, 'file', '必须落到文件');
  assert.strictEqual(store.get(ref).list.length, 3000, '降级后仍能完整读回');
});

test('题库：1000 题写入后能完整读回（按 200 题分片）', () => {
  const { repo, fs } = makeRepo();
  const qs = questionsOf(1000);
  const r = repo.createBank({ name: '压测题库', sourceFile: 'x.xlsx', questions: qs });
  assert.strictEqual(r.counts.total, 1000);
  const back = repo.getBankQuestions(r.bankId);
  assert.strictEqual(back.length, 1000);
  assert.strictEqual(back[999].stem, qs[999].stem);
  assert.strictEqual(repo.listBanks().length, 1);
});

test('题库重名自动追加 (2)(3)', () => {
  const { repo } = makeRepo();
  const a = repo.createBank({ name: '黄金题库', questions: questionsOf(3) });
  const b = repo.createBank({ name: '黄金题库', questions: questionsOf(3) });
  const c = repo.createBank({ name: ' 黄金题库 ', questions: questionsOf(3) }); // 去空白后同名
  assert.strictEqual(a.name, '黄金题库');
  assert.strictEqual(b.name, '黄金题库 (2)');
  assert.strictEqual(c.name, '黄金题库 (3)');
  assert.strictEqual(nameKey(' 黄金题库 '), '黄金题库');
});

test('删除题库：软删除 + 级联清空重难错题', () => {
  const { repo } = makeRepo();
  const b = repo.createBank({ name: '黄金题库', questions: questionsOf(5) });
  repo.addHard({ bankId: b.bankId, qid: 1, qtype: 'single', stem: '题干', options: ['甲', '乙'], answer: [0], answer_text: 'A' });
  assert.strictEqual(repo.hardOverview().total, 1);

  repo.deleteBank(b.bankId);
  assert.strictEqual(repo.listBanks().length, 0, '列表默认排除已删除');
  assert.strictEqual(repo.listBanks({ includeDeleted: true }).length, 1);
  assert.strictEqual(repo.hardOverview().total, 0, '删库后重难错题必须清空');
});

test('重难错题：归集去重、逐题移出、整库清空', () => {
  const { repo } = makeRepo();
  const b = repo.createBank({ name: '黄金题库', questions: questionsOf(5) });
  const base = { bankId: b.bankId, qtype: 'single', stem: '题干', options: ['甲', '乙'], answer: [0], answer_text: 'A' };
  repo.addHard(Object.assign({ qid: 1 }, base));
  repo.addHard(Object.assign({ qid: 2 }, base));
  repo.addHard(Object.assign({ qid: 1 }, base)); // 重复
  assert.strictEqual(repo.hardOverview().total, 2, '同一 qid 不重复计数');
  assert.deepStrictEqual(repo.hardMap().map[b.bankId], [1, 2]);

  repo.removeHard({ bankId: b.bankId, qid: 1 });
  assert.strictEqual(repo.hardOverview().total, 1);
  repo.removeHard({ bankId: b.bankId, all: true });
  assert.strictEqual(repo.hardOverview().total, 0);
  assert.strictEqual(repo.listHard({ bankId: b.bankId }).items.length, 0);
});

test('已删除的题库不能再归集重难错题', () => {
  const { repo } = makeRepo();
  const b = repo.createBank({ name: '黄金题库', questions: questionsOf(3) });
  repo.deleteBank(b.bankId);
  assert.throws(
    () => repo.addHard({ bankId: b.bankId, qid: 1, qtype: 'single', stem: 'x', options: ['甲', '乙'], answer: [0], answer_text: 'A' }),
    /已被删除/
  );
});

test('会话：建卷写快照，作答只写增量，可读回', () => {
  const { repo } = makeRepo();
  const b = repo.createBank({ name: '黄金题库', questions: questionsOf(4) });
  const items = [
    { qid: 1, pos: 1, qtype: 'single', stem: '题1', options: ['甲', '乙'], order: [0, 1], options_disp: ['甲', '乙'], answer_disp: [0], answer_text: 'A', score: 2, chosen: null },
    { qid: 2, pos: 2, qtype: 'single', stem: '题2', options: ['甲', '乙'], order: [0, 1], options_disp: ['甲', '乙'], answer_disp: [1], answer_text: 'B', score: 2, chosen: null },
  ];
  const session = { id: 's1', bankId: b.bankId, bankName: '黄金题库', mode: 'practice', candidate: '', status: 'ongoing', startedAt: '2026-10-22 09:00:00', settings: { scores: { single: 2, multi: 4, judge: 1 } } };
  repo.putSession(session, items);

  assert.strictEqual(repo.getSessionItems('s1').length, 2);
  repo.putAns('s1', { 1: [0] });
  assert.deepStrictEqual(repo.getAns('s1'), { 1: [0] });
  repo.delAns('s1');
  assert.strictEqual(repo.getAns('s1'), null);
  assert.strictEqual(repo.listSessions().length, 1);
});

test('storage 写满时建库仍然成功（正文落到文件）', () => {
  const { repo } = makeRepo({ storage: { limitBytes: 1024 } });
  const r = repo.createBank({ name: '大题库', questions: questionsOf(300) });
  assert.strictEqual(r.counts.total, 300);
  assert.strictEqual(repo.getBankQuestions(r.bankId).length, 300, '降级后仍能读回全部题目');
  assert.strictEqual(repo.listBanks().length, 1, '索引要能写进 storage');
});
