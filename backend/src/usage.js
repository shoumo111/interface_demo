/**
 * 使用记录写入模块
 * 记录"谁在什么时间做了什么操作"，供后台管理页查看。
 * 写入失败不阻塞主流程（静默降级）。
 */
const prisma = require('./prisma');

async function logUsage(userId, action, detail) {
  try {
    if (!userId) return;
    await prisma.usageLog.create({
      data: {
        userId: Number(userId),
        action: String(action),
        detail: detail || null,
      },
    });
  } catch (e) {
    console.error('[UsageLog] 写入失败:', e.message);
  }
}

module.exports = { logUsage };
