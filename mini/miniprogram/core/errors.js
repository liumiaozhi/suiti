// 错误类型：与 desktop app/errors.py 对齐。
// core 里所有"用户输入有问题"的失败都抛 UserError，页面捕获后直接提示文案。

function UserError(message, code) {
  const e = new Error(message);
  e.name = 'UserError';
  e.code = code || 'BAD_INPUT';
  return e;
}

function isUserError(e) {
  return e && (e.name === 'UserError' || e.code === 'BAD_INPUT' || e.name === 'AnswerError');
}

module.exports = { UserError, isUserError };
