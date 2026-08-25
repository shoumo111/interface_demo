const express = require('express');
const prisma = require('../prisma');
const { logUsage } = require('../usage');
const { verifyPassword, sanitizeUser } = require('../auth');
const { createAdminSession } = require('./admin');

const router = express.Router();

/**
 * POST /api/auth/login
 * body: { studentId, password }
 * 账号（学号/工号）+ 密码登录。
 * - 普通用户：返回脱敏后的 user
 * - 管理员（role=admin）：额外返回 admin:true，前端据此跳转后台管理端
 */
router.post('/login', async (req, res, next) => {
  try {
    const { studentId, password } = req.body || {};
    if (!studentId || !password) {
      return res.status(400).json({ error: '缺少学号/工号 studentId 或密码 password' });
    }
    const user = await prisma.user.findUnique({ where: { studentId: String(studentId).trim() } });
    if (!user) {
      return res.status(404).json({ error: '未找到该用户，请检查学号/工号' });
    }
    if (!user.password) {
      return res.status(403).json({ error: '该账号未设置密码，请联系管理员' });
    }
    const ok = await verifyPassword(password, user.password);
    if (!ok) {
      return res.status(401).json({ error: '密码错误，请重试' });
    }
    logUsage(user.id, 'login', `登录成功（学号/工号 ${user.studentId}）`);
    const safe = sanitizeUser(user);
    if (user.role === 'admin') {
      // 管理员：额外返回后台会话 token，前端跳转后台管理端后免二次登录
      res.json({
        user: safe,
        admin: true,
        adminToken: createAdminSession(user),
        adminLevel: user.adminLevel || 2,
      });
    } else {
      res.json({ user: safe, admin: false });
    }
  } catch (e) {
    next(e);
  }
});

module.exports = router;
