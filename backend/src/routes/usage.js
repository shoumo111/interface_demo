const express = require('express');
const prisma = require('../prisma');
const { requireAdmin } = require('./admin');

const router = express.Router();

/**
 * GET /api/usage  使用记录列表（后台管理，需管理员）
 * query: limit(默认200), userId, action
 * 二级管理员看不到管理员账号的使用记录
 */
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const { limit, userId, action } = req.query;
    const where = {};
    if (userId) where.userId = Number(userId);
    if (action) where.action = action;

    const logs = await prisma.usageLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit ? Math.min(Number(limit), 500) : 200,
      include: {
        user: { select: { id: true, name: true, studentId: true, role: true } },
      },
    });

    if (req.admin && req.admin.adminLevel !== 1) {
      res.json(logs.filter((l) => !l.user || l.user.role !== 'admin'));
    } else {
      res.json(logs);
    }
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /api/usage  清空使用记录（后台管理用，需管理员）
 */
router.delete('/', requireAdmin, async (req, res, next) => {
  try {
    const { count } = await prisma.usageLog.deleteMany();
    res.json({ ok: true, deleted: count });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
