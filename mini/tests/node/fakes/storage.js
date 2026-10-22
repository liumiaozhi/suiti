// 内存版 storage 假实现：给 Node 单测用，行为尽量贴近 wx.setStorageSync。
// 可以设一个容量上限来模拟"写满"，以验证 chunkStore 的文件降级。

function createFakeStorage(opts) {
  const o = opts || {};
  const map = new Map();
  let limitBytes = o.limitBytes || 0; // 0 = 不限

  const sizeOf = () => {
    let n = 0;
    map.forEach((v) => (n += v.length));
    return n;
  };

  function get(key, dflt) {
    if (!map.has(key)) return dflt;
    try {
      return JSON.parse(map.get(key));
    } catch (e) {
      return dflt;
    }
  }

  function set(key, value) {
    const json = JSON.stringify(value);
    if (limitBytes && sizeOf() + json.length > limitBytes) {
      const e = new Error('setStorageSync:fail exceed storage maximum size limit');
      e.errMsg = 'setStorageSync:fail exceed storage maximum size limit';
      throw e;
    }
    map.set(key, json);
    return true;
  }

  function remove(key) {
    map.delete(key);
  }

  function info() {
    return { currentKB: Math.round(sizeOf() / 1024), limitKB: limitBytes ? Math.round(limitBytes / 1024) : 10240, keys: Array.from(map.keys()) };
  }

  return { get, set, remove, info, _map: map, _size: sizeOf, setLimit: (b) => (limitBytes = b) };
}

module.exports = { createFakeStorage };
