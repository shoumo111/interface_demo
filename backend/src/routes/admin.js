/**
 * 后台管理员认证（账号 + 密码，管理员账号存于 User 表，role='admin'）
 * 分级：
 *   - adminLevel 1（一级管理员）：可查看所有数据库数据（含管理员信息和用户密码）
 *   - adminLevel 2（二级管理员）：看不到管理员信息和用户密码
 * token 存内存（重启后失效，需重新登录）。
 */
const express = require('express');
const crypto = require('crypto');
const prisma = require('../prisma');
const { verifyPassword } = require('../auth');

const router = express.Router();

// token -> { userId, adminLevel }（内存，重启失效）
const sessions = new Map();

function createSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId: user.id, adminLevel: user.adminLevel || 2 });
  return token;
}

function getTokenFromReq(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || (req.body || {}).token;
}

/**
 * POST /api/admin/login
 * body: { studentId, password }
 */
router.post('/login', async (req, res, next) => {
  try {
    const { studentId, password } = req.body || {};
    if (!studentId || !password) {
      return res.status(400).json({ error: '缺少账号 studentId 或密码 password' });
    }
    const user = await prisma.user.findUnique({ where: { studentId: String(studentId).trim() } });
    if (!user || user.role !== 'admin') {
      return res.status(401).json({ error: '该账号不是管理员，无法登录后台' });
    }
    const ok = await verifyPassword(password, user.password);
    if (!ok) {
      return res.status(401).json({ error: '账号或密码错误' });
    }
    const token = createSession(user);
    res.json({
      ok: true,
      token,
      adminLevel: user.adminLevel || 2,
      user: { id: user.id, studentId: user.studentId, name: user.name, role: user.role, adminLevel: user.adminLevel },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/admin/logout  注销（可选）
 */
router.post('/logout', (req, res) => {
  const token = getTokenFromReq(req);
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

/** 中间件：校验管理员 token，并把管理员信息挂到 req.admin */
function requireAdmin(req, res, next) {
  const token = getTokenFromReq(req);
  const session = sessions.get(token);
  if (!token || !session) {
    return res.status(401).json({ error: '未授权，请先登录后台' });
  }
  req.admin = session;
  next();
}

/** 中间件：仅一级管理员可用（如查看管理员信息 / 用户密码） */
function requireLevel1(req, res, next) {
  if (!req.admin || req.admin.adminLevel !== 1) {
    return res.status(403).json({ error: '权限不足：仅一级管理员可执行此操作' });
  }
  next();
}

/** 供其它模块创建管理员会话（如用户端登录管理员时复用） */
function createAdminSession(user) {
  return createSession(user);
}

/** 校验 token 并返回会话信息（无则 undefined） */
function getAdminSession(token) {
  if (!token) return undefined;
  return sessions.get(token);
}

module.exports = { router, requireAdmin, requireLevel1, createAdminSession, getAdminSession };
