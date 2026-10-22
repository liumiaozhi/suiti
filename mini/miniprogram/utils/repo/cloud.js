// 云开发实现（P6 接入）。现在只做占位：任何调用都明确报错，
// 免得页面误以为拿到了数据。
//
// 接入时需要做的：
//   * 集合 banks / questions / sessions / hard_questions / meta
//   * 权限一律"仅创建者可读写"，不要在客户端过滤 openid（可伪造）
//   * 客户端 limit 只有 20，批量读写必须走云函数（云函数返回 ≤1MB，按 200 分批）
//   * hard_questions 用确定性 _id = `${bankId}:${qid}`，天然去重

const { UserError } = require('../../core/errors');

function notReady() {
  throw UserError('云开发尚未开通，当前使用本机存储（设置页可切换）');
}

function createCloudRepo() {
  const stub = () => notReady();
  return {
    SCHEMA: 1,
    init: stub, getEnv: stub,
    listBanks: stub, getBank: stub, createBank: stub, deleteBank: stub, getBankQuestions: stub,
    listSessions: stub, getSessionMeta: stub, putSession: stub, getSession: stub, getSessionItems: stub,
    putAns: stub, getAns: stub, delAns: stub, putGradedItems: stub, removeSession: stub, upsertSessionIndex: stub,
    createPaper: stub, getPaperState: stub, saveAnswer: stub, summarizeSession: stub, gradeAndSubmit: stub, getResult: stub,
    toggleMarkByPos: stub, toggleHardByPos: stub, hardQidsOfBank: stub,
    hardOverview: stub, hardMap: stub, listHard: stub, addHard: stub, removeHard: stub,
    practiceRecords: stub, examRecords: stub,
  };
}

module.exports = { createCloudRepo };
