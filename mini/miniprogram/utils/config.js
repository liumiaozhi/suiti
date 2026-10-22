// 运行配置（唯一开关处）
module.exports = {
  // 数据层实现：'local' | 'cloud'。P2 之前只有 local，云开发在 P6 接入。
  repo: 'local',
  // 导出清晰度：150dpi 是体积与可读性的折中（PDF 单页约 150–300KB）
  exportDpi: 150,
  // 会话（做题场次）保留条数，超出按时间淘汰
  keepSessions: 200,
  // 导出文件保留份数
  keepExports: 5,
  // 僵尸会话清理阈值（小时）
  staleHours: 12,
  // 微信开发者工具里的环境标识，仅用于日志
  env: 'dev',
};
