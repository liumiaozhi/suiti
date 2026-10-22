// 唯一碰 wx.setStorage 的地方。
// 约定：值一律存 JSON 字符串（与参考工程一致），读取失败一律当"没有"处理。
// 配额写满时抛 QuotaError，由 chunkStore 决定降级到文件。

function QuotaError(message, detail) {
  const e = new Error(message);
  e.name = 'QuotaError';
  e.detail = detail;
  return e;
}

function isQuotaError(e) {
  if (!e) return false;
  if (e.name === 'QuotaError') return true;
  const msg = String((e && (e.errMsg || e.message)) || '');
  return /exceed|quota|storage/i.test(msg);
}

function get(key, dflt) {
  try {
    const raw = wx.getStorageSync(key);
    if (raw === '' || raw === null || raw === undefined) return dflt;
    if (typeof raw !== 'string') return raw; // 少数基础库会直接返回对象
    return JSON.parse(raw);
  } catch (e) {
    return dflt;
  }
}

function set(key, value) {
  try {
    wx.setStorageSync(key, JSON.stringify(value));
    return true;
  } catch (e) {
    if (isQuotaError(e)) throw QuotaError('本地存储空间不足', e);
    throw e;
  }
}

function remove(key) {
  try {
    wx.removeStorageSync(key);
  } catch (e) {}
}

/** 当前占用（KB），用于容量看板；拿不到就返回 -1。 */
function info() {
  try {
    const i = wx.getStorageInfoSync();
    return { currentKB: i.currentSize || 0, limitKB: i.limitSize || 0, keys: i.keys || [] };
  } catch (e) {
    return { currentKB: -1, limitKB: -1, keys: [] };
  }
}

module.exports = { QuotaError, isQuotaError, get, set, remove, info };
