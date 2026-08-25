const express = require('express');
const prisma = require('../prisma');
const { logUsage } = require('../usage');
const { requireAdmin } = require('./admin');
const { hashPassword, sanitizeUser } = require('../auth');

const router = express.Router();

/** 当前管理员是否为一级管理员（可看管理员信息 / 用户密码） */
function isLevel1(req) {
  return req.admin && req.admin.adminLevel === 1;
}

/**
 * GET /api/users  用户列表（后台管理，需管理员）
 * query: keyword, role, grade, major, className（模糊匹配）
 * - 一级管理员：可看到全部用户（含管理员）及密码字段
 * - 二级管理员：看不到管理员账号，也看不到密码字段
 */
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const { keyword, role, grade, major, className } = req.query;
    const where = {};
    if (!isLevel1(req)) where.role = { not: 'admin' }; // 二级管理员看不到管理员
    if (role) where.role = role;
    if (grade) where.grade = { contains: grade };
    if (major) where.major = { contains: major };
    if (className) where.className = { contains: className };
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { studentId: { contains: keyword } },
        { major: { contains: keyword } },
        { className: { contains: keyword } },
      ];
    }
    const users = await prisma.user.findMany({ where, orderBy: { studentId: 'asc' } });
    res.json(isLevel1(req) ? users : users.map(sanitizeUser));
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/users/:id  用户详情（后台管理，需管理员）
 */
router.get('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: '无效的用户 ID' });
    }
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (!isLevel1(req) && user.role === 'admin') {
      return res.status(403).json({ error: '权限不足：无权查看管理员信息' });
    }
    res.json(isLevel1(req) ? user : sanitizeUser(user));
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/users  新增用户（后台管理用，需管理员）
 * body: { studentId, name, role?, adminLevel?, password?, grade?, major?, className?, position?, phone?, email? }
 * - 创建管理员（role=admin）仅限一级管理员
 * - 二级管理员不可创建/管理管理员账号
 */
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { studentId, name, role, adminLevel, password, grade, major, className, position, phone, email } = req.body || {};
    if (!studentId || !name) {
      return res.status(400).json({ error: '缺少学号/工号 studentId 或姓名 name' });
    }
    const newRole = role || 'student';
    if (newRole === 'admin' && !isLevel1(req)) {
      return res.status(403).json({ error: '权限不足：仅一级管理员可创建管理员账号' });
    }
    const sid = String(studentId).trim();
    const dup = await prisma.user.findUnique({ where: { studentId: sid } });
    if (dup) return res.status(400).json({ error: '学号/工号已存在' });

    const data = {
      studentId: sid,
      name,
      role: newRole,
      grade: grade || null,
      major: major || null,
      className: className || null,
      position: position || null,
      phone: phone || null,
      email: email || null,
    };
    if (newRole === 'admin') data.adminLevel = adminLevel === 1 ? 1 : 2;
    if (password) data.password = await hashPassword(password);

    const user = await prisma.user.create({ data });
    logUsage(user.id, 'create_user', `新增用户 ${user.name}（${sid}）`);
    res.status(201).json(isLevel1(req) ? user : sanitizeUser(user));
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /api/users/:id  编辑用户（后台管理用，需管理员）
 * body: { studentId?, name?, role?, adminLevel?, password?, grade?, major?, className?, position?, phone?, email? }
 */
router.patch('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { studentId, name, role, adminLevel, password, grade, major, className, position, phone, email } = req.body || {};
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: '用户不存在' });

    // 二级管理员不可编辑管理员账号
    if (!isLevel1(req) && existing.role === 'admin') {
      return res.status(403).json({ error: '权限不足：无权编辑管理员账号' });
    }

    const data = {};
    if (studentId !== undefined) data.studentId = String(studentId).trim();
    if (name !== undefined) data.name = name;
    if (role !== undefined) {
      if (role === 'admin' && !isLevel1(req)) {
        return res.status(403).json({ error: '权限不足：仅一级管理员可设置管理员账号' });
      }
      data.role = role;
    }
    if (adminLevel !== undefined) {
      if (!isLevel1(req)) {
        return res.status(403).json({ error: '权限不足：仅一级管理员可设置管理员级别' });
      }
      data.adminLevel = Number(adminLevel) === 1 ? 1 : 2;
    }
    if (password) data.password = await hashPassword(password);
    if (grade !== undefined) data.grade = grade || null;
    if (major !== undefined) data.major = major || null;
    if (className !== undefined) data.className = className || null;
    if (position !== undefined) data.position = position || null;
    if (phone !== undefined) data.phone = phone || null;
    if (email !== undefined) data.email = email || null;

    if (data.studentId) {
      const dup = await prisma.user.findUnique({ where: { studentId: data.studentId } });
      if (dup && dup.id !== id) return res.status(400).json({ error: '学号/工号已存在' });
    }

    const user = await prisma.user.update({ where: { id }, data });
    logUsage(id, 'update_user', `编辑用户 ${user.name}（${user.studentId}）`);
    res.json(isLevel1(req) ? user : sanitizeUser(user));
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /api/users/:id  删除用户（后台管理用，需管理员）
 * 级联删除：其发出的通知（及收件人）、其收件记录、其使用记录
 * 二级管理员不可删除管理员账号
 */
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: '用户不存在' });
    if (!isLevel1(req) && existing.role === 'admin') {
      return res.status(403).json({ error: '权限不足：无权删除管理员账号' });
    }

    const sentIds = (
      await prisma.notification.findMany({ where: { senderId: id }, select: { id: true } })
    ).map((n) => n.id);

    const ops = [
      prisma.recipient.deleteMany({ where: { userId: id } }),
      prisma.usageLog.deleteMany({ where: { userId: id } }),
    ];
    if (sentIds.length > 0) {
      ops.push(prisma.recipient.deleteMany({ where: { notificationId: { in: sentIds } } }));
      ops.push(prisma.notification.deleteMany({ where: { senderId: id } }));
    }
    ops.push(prisma.user.delete({ where: { id } }));
    await prisma.$transaction(ops);

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
