// 数据层门面：页面只 require 这一个文件，切换 local / cloud 不用改页面。
//
//   const repo = require('../../utils/repo/index');
//   await repo.listBanks();
//
// 接口以桌面版 28 个 api 方法为准（合并后 26 个），全部返回 Promise。

const cfg = require('../config');

let impl = null;
let injected = null; // 测试用：注入 deps

function build() {
  if (impl) return impl;
  if (cfg.repo === 'cloud') {
    impl = require('./cloud').createCloudRepo();
  } else {
    impl = require('./local').createLocalRepo(
      injected || {
        // 注意层级：本文件在 utils/repo/ 下，adapters 在 utils/ 下，所以是 ../../
        storage: require('../../adapters/storage'),
        fs: require('../../adapters/fs'),
        clock: require('../../adapters/clock'),
        rng: require('../../adapters/rng').random,
      }
    );
  }
  return impl;
}

/** 测试入口：注入假的 storage/fs，避免依赖 wx。 */
function setDeps(deps) {
  injected = deps;
  impl = null;
}

function reset() {
  impl = null;
  injected = null;
}

/** 把所有同步方法包成 Promise，页面统一 await。 */
const ASYNC = [
  'init', 'getEnv', 'listBanks', 'getBank', 'createBank', 'deleteBank', 'getBankQuestions',
  'listSessions', 'getSessionMeta', 'putSession', 'getSession', 'getSessionItems',
  'putAns', 'getAns', 'delAns', 'putGradedItems', 'removeSession', 'upsertSessionIndex',
  'createPaper', 'getPaperState', 'saveAnswer', 'summarizeSession', 'gradeAndSubmit', 'getResult',
  'toggleMarkByPos', 'toggleHardByPos', 'hardQidsOfBank',
  'hardOverview', 'hardMap', 'listHard', 'addHard', 'removeHard',
  'practiceRecords', 'examRecords',
];

const api = { setDeps, reset, get raw() { return build(); } };
for (const name of ASYNC) {
  api[name] = function () {
    const args = arguments;
    return new Promise((resolve, reject) => {
      try {
        const r = build()[name].apply(null, args);
        resolve(r);
      } catch (e) {
        reject(e);
      }
    });
  };
}

module.exports = api;
