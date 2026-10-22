// 在 Node 里用 wx 桩跑一遍"页面真正会调用的路径"，把真机上的错误逼出来。
// 用法： node tests/node/wxsmoke.js
const path = require('node:path');
const assert = require('node:assert');

const MP = path.resolve(__dirname, '../..', 'miniprogram');

// ---------------- wx 桩 ----------------
const memStore = new Map();
const memFiles = new Map();
const logs = [];

global.wx = {
  env: { USER_DATA_PATH: '/mock/user' },
  getStorageSync: (k) => (memStore.has(k) ? memStore.get(k) : ''),
  setStorageSync: (k, v) => {
    if (typeof v !== 'string') throw new Error('存储必须是字符串');
    memStore.set(k, v);
  },
  removeStorageSync: (k) => memStore.delete(k),
  getStorageInfoSync: () => ({ currentSize: 1, limitSize: 10240, keys: Array.from(memStore.keys()) }),
  getFileSystemManager: () => {
    const norm = (p) => String(p).replace(/^\/+/, '');
    const fs = {
      mkdirSync: (p) => p,
      accessSync: (p) => {
        if (!memFiles.has(norm(p))) throw new Error('no such file');
      },
      writeFileSync: (p, data) => memFiles.set(norm(p), typeof data === 'string' ? data : '<bytes>'),
      readFileSync: (p) => {
        if (!memFiles.has(norm(p))) throw new Error('readFileSync:fail no such file ' + p);
        return memFiles.get(norm(p));
      },
      unlinkSync: (p) => memFiles.delete(norm(p)),
      rmdirSync: () => true,
      renameSync: (a, b) => {
        const va = memFiles.get(norm(a));
        memFiles.delete(norm(a));
        memFiles.set(norm(b), va);
      },
      copyFileSync: (a, b) => memFiles.set(norm(b), memFiles.get(norm(a))),
      statSync: (p) => {
        if (!memFiles.has(norm(p))) throw new Error('no such file');
        throw new Error('not a dir');
      },
      readdirSync: () => [],
      getFileInfoSync: () => ({ size: 0 }),
    };
    return fs;
  },
  showToast: (o) => logs.push('toast:' + (o && o.title)),
  setNavigationBarTitle: () => {},
};

// ---------------- 跑一遍 ----------------
const repo = require(path.join(MP, 'utils/repo'));
const demo = require(path.join(MP, 'utils/demo'));

(async () => {
  const steps = [];
  const run = async (name, fn) => {
    try {
      const r = await fn();
      steps.push('OK   ' + name + (r === undefined ? '' : ' -> ' + JSON.stringify(r).slice(0, 90)));
      return r;
    } catch (e) {
      steps.push('FAIL ' + name + ' -> ' + (e && e.message));
      throw e;
    }
  };

  try {
    await run('repo.init()', () => repo.init());
    await run('repo.getEnv()', () => repo.getEnv());
    await run('repo.listBanks()', () => repo.listBanks());
    await run('repo.practiceRecords()', () => repo.practiceRecords());
    await run('repo.examRecords()', () => repo.examRecords({}));
    await run('repo.hardOverview()', () => repo.hardOverview());

    const b = await run('createBank(演示题库)', () =>
      repo.createBank({ name: '演示题库', sourceFile: 'demo', questions: demo.sampleQuestions() })
    );
    await run('getBank', () => repo.getBank(b.bankId).then((x) => ({ name: x.name, counts: x.counts })));
    await run('listBanks(有数据)', () => repo.listBanks().then((x) => x.length));
    await run('practiceRecords(有题库)', () => repo.practiceRecords().then((x) => x.overall));
    await run('deleteBank', () => repo.deleteBank(b.bankId));
    console.log(steps.join('\n'));
    console.log('\n[PASS] 数据层在 wx 桩下全部调用成功');
  } catch (e) {
    console.log(steps.join('\n'));
    console.log('\n[FAIL] ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e));
    process.exit(1);
  }
})();
