const express = require('express');
const prisma = require('../prisma');
const { requireAdmin } = require('./admin');

const router = express.Router();

/**
 * GET /api/stats  仪表盘统计（后台管理，需管理员）
 * - 一级管理员：统计全部用户（含管理员）
 * - 二级管理员：统计中排除管理员账号（看不到管理员信息）
 */
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const isL1 = req.admin.adminLevel === 1;
    const userWhere = isL1 ? {} : { role: { not: 'admin' } };
    const [userCount, studentCount, teacherCount, adminCount, notificationCount, sentCount, unreadCount, usageCount, recent] =
      await Promise.all([
        prisma.user.count({ where: userWhere }),
        prisma.user.count({ where: { role: 'student' } }),
        prisma.user.count({ where: { role: 'teacher' } }),
        prisma.user.count({ where: { role: 'admin' } }),
        prisma.notification.count(),
        prisma.notification.count({ where: { status: 'sent' } }),
        prisma.recipient.count({ where: { isRead: false } }),
        prisma.usageLog.count(),
        prisma.notification.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            sender: { select: { id: true, name: true, studentId: true, role: true } },
            _count: { select: { recipients: true } },
          },
        }),
      ]);

    res.json({
      userCount,
      studentCount,
      teacherCount,
      adminCount,
      notificationCount,
      sentCount,
      unreadCount,
      usageCount,
      recent: recent.map((n) => ({
        ...n,
        recipientCount: n._count.recipients,
        _count: undefined,
      })),
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
