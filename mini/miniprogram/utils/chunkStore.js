// 分块存储：**索引进 storage，正文进文件**。
//
// 微信硬限制：storage 单 key 1MB、总量 10MB；本地文件 200MB。
// 一个 1000 题的题库序列化后 0.5~1.5MB，正好压在单 key 红线上，
// 所以这里统一按 300KB 阈值分流 —— 小对象走 storage（快），大对象走文件（大）。
// 调用方只拿到一个 ref（{kind, key|path}），不关心具体落在哪。

const THRESHOLD = 300 * 1024;

function byteLength(value) {
  try {
    return JSON.stringify(value).length; // 近似值：中文按 1 字符算，偏保守
  } catch (e) {
    return Number.MAX_SAFE_INTEGER;
  }
}

function createChunkStore(storage, fs) {
  const PREFIX = 'suiti:db:';

  function put(path, value, opts) {
    const o = opts || {};
    const forceFile = !!o.forceFile;
    const big = forceFile || byteLength(value) > THRESHOLD;
    if (!big) {
      try {
        storage.set(PREFIX + path, value);
        return { kind: 'storage', key: PREFIX + path };
      } catch (e) {
        // 配额写满：降级到文件
      }
    }
    fs.writeJson(path, value);
    return { kind: 'file', path };
  }

  function get(ref, dflt) {
    if (!ref) return dflt;
    try {
      if (ref.kind === 'file') return fs.readJson(ref.path);
      return storage.get(ref.key, dflt);
    } catch (e) {
      return dflt;
    }
  }

  function del(ref) {
    if (!ref) return;
    try {
      if (ref.kind === 'file') fs.unlink(ref.path);
      else storage.remove(ref.key);
    } catch (e) {}
  }

  return { THRESHOLD, byteLength, put, get, del };
}

module.exports = { THRESHOLD, byteLength, createChunkStore };
