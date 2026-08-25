const express = require('express');
const prisma = require('../prisma');
const { resolveAudience } = require('../audience');
const { logUsage } = require('../usage');
const { requireAdmin } = require('./admin');

const router = express.Router();

/**
 * 发送权限校验：
 * 1. 学生需担任职务（如社长、会长等）才能发送通知
 * 2. 学生不能向教师发送通知
 */
async function assertCanSend(sender, userIds) {
  if (sender.role !== 'student') return; // 教师不受限制
  if (!sender.position) {
    const err = new Error('权限不足：学生需担任职务（如社长、会长等）才能发送通知');
    err.statusCode = 403;
    throw err;
  }
  if (userIds.length > 0) {
    const teacherCount = await prisma.user.count({
      where: { id: { in: userIds }, role: 'teacher' },
    });
    if (teacherCount > 0) {
      const err = new Error('权限不足：学生不能向教师发送通知');
      err.statusCode = 403;
      throw err;
    }
  }
}

/**
 * POST /api/notifications
 * body: {
 *   senderId, title, content,
 *   audience,            // 目标人群描述（见 src/audience.js）
 *   location?, eventTime?, notes?,
 *   status?              // 'sent'（默认，立即发送）| 'draft'（草稿）
 * }
 */
router.post('/', async (req, res, next) => {
  try {
    const { senderId, title, content, audience, location, eventTime, notes, status } = req.body || {};
    if (!senderId) return res.status(400).json({ error: '缺少发送者 senderId' });
    if (!title) return res.status(400).json({ error: '缺少标题 title' });
    if (!content) return res.status(400).json({ error: '缺少内容 content' });
    if (!audience) return res.status(400).json({ error: '缺少目标人群 audience' });

    const sender = await prisma.user.findUnique({ where: { id: Number(senderId) } });
    if (!sender) return res.status(404).json({ error: '发送者不存在' });

    const isDraft = status === 'draft';
    let description = String(audience).trim();
    let userIds = [];

    if (!isDraft) {
      // 正式发送：解析受众、排除发送者本人、校验权限后创建收件人
      const resolved = await resolveAudience(audience);
      // 不发送给自己
      userIds = resolved.userIds.filter((uid) => uid !== Number(senderId));
      description = resolved.description;
      await assertCanSend(sender, userIds);
    }

    const notification = await prisma.notification.create({
      data: {
        title,
        content,
        audience: description,
        location: location || null,
        eventTime: eventTime || null,
        notes: notes || null,
        status: isDraft ? 'draft' : 'sent',
        sentAt: isDraft ? null : new Date(),
        senderId: Number(senderId),
        recipients: isDraft
          ? undefined
          : { create: userIds.map((userId) => ({ userId })) },
      },
      include: {
        sender: { select: { id: true, name: true, studentId: true, role: true } },
        recipients: { include: { user: true } },
      },
    });

    const recipientCount = notification.recipients.length;
    logUsage(
      Number(senderId),
      isDraft ? 'save_draft' : 'send_notification',
      isDraft
        ? `保存草稿「${notification.title}」`
        : `发送通知「${notification.title}」→ ${description}（${recipientCount} 人）`
    );

    res.status(201).json({ ...notification, recipientCount });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/notifications
 * 全部通知列表（后台管理用，需管理员）
 * query: keyword, status
 */
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const { keyword, status } = req.query;
    const where = {};
    if (status) where.status = status;
    if (keyword) {
      where.OR = [
        { title: { contains: keyword } },
        { content: { contains: keyword } },
        { audience: { contains: keyword } },
      ];
    }
    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        sender: { select: { id: true, name: true, studentId: true, role: true } },
        _count: { select: { recipients: true } },
        recipients: { where: { isRead: true }, select: { id: true } },
      },
    });
    let list = notifications.map((n) => ({
      ...n,
      recipientCount: n._count.recipients,
      readCount: n.recipients.length,
      _count: undefined,
    }));
    // 二级管理员看不到管理员账号发出的通知
    if (req.admin && req.admin.adminLevel !== 1) {
      list = list.filter((n) => !n.sender || n.sender.role !== 'admin');
    }
    res.json(list);
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/notifications/received?userId=1&unread=true
 * 我收到的通知（含已读状态）
 */
router.get('/received', async (req, res, next) => {
  try {
    const userId = Number(req.query.userId);
    if (!userId) return res.status(400).json({ error: '缺少 userId' });

    const recipients = await prisma.recipient.findMany({
      where: { userId },
      orderBy: { deliveredAt: 'desc' },
      include: {
        notification: { include: { sender: { select: { id: true, name: true, studentId: true, role: true } } } },
      },
    });

    const list = recipients.map((r) => ({
      ...r.notification,
      recipientId: r.id,
      isRead: r.isRead,
      readAt: r.readAt,
      deliveredAt: r.deliveredAt,
    }));

    res.json(list);
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/notifications/sent?userId=1
 * 我发出的通知
 */
router.get('/sent', async (req, res, next) => {
  try {
    const userId = Number(req.query.userId);
    if (!userId) return res.status(400).json({ error: '缺少 userId' });

    const notifications = await prisma.notification.findMany({
      where: { senderId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { recipients: true } },
        recipients: {
          where: { isRead: true },
          select: { id: true },
        },
      },
    });

    const list = notifications.map((n) => ({
      ...n,
      recipientCount: n._count.recipients,
      readCount: n.recipients.length,
      _count: undefined,
    }));

    res.json(list);
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/notifications/:id
 * 通知详情（含收件人列表）
 */
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const notification = await prisma.notification.findUnique({
      where: { id },
      include: {
        sender: { select: { id: true, name: true, studentId: true, role: true } },
        recipients: { include: { user: true } },
      },
    });
    if (!notification) return res.status(404).json({ error: '通知不存在' });
    res.json({ ...notification, recipientCount: notification.recipients.length });
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /api/notifications/:id/read
 * body: { userId }  → 将该用户对此通知标记为已读
 */
router.patch('/:id/read', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: '缺少 userId' });

    const recipient = await prisma.recipient.findUnique({
      where: { notificationId_userId: { notificationId: id, userId: Number(userId) } },
    });
    if (!recipient) return res.status(404).json({ error: '该用户不在此通知的收件人列表中' });

    const updated = await prisma.recipient.update({
      where: { id: recipient.id },
      data: { isRead: true, readAt: new Date() },
    });

    logUsage(Number(userId), 'mark_read', `标记已读 通知#${id}`);
    res.json({ ok: true, recipient: updated });
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /api/notifications/:id
 * 编辑通知（后台管理用，需管理员）
 * body: { title?, content?, audience?, location?, eventTime?, notes?, status? }
 */
router.patch('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { title, content, audience, location, eventTime, notes, status } = req.body || {};
    const existing = await prisma.notification.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: '通知不存在' });

    const data = {};
    if (title !== undefined) data.title = title;
    if (content !== undefined) data.content = content;
    if (audience !== undefined) data.audience = audience;
    if (location !== undefined) data.location = location || null;
    if (eventTime !== undefined) data.eventTime = eventTime || null;
    if (notes !== undefined) data.notes = notes || null;
    if (status !== undefined && ['sent', 'draft'].includes(status)) data.status = status;

    const notification = await prisma.notification.update({
      where: { id },
      data,
      include: {
        sender: { select: { id: true, name: true, studentId: true, role: true } },
      },
    });

    logUsage(existing.senderId, 'update_notification', `编辑通知#${id}「${notification.title}」`);
    res.json(notification);
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /api/notifications/:id/send
 * body: { userId }  → 发送者将草稿正式发送（解析收件人）
 */
router.patch('/:id/send', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: '缺少 userId' });

    const notification = await prisma.notification.findUnique({ where: { id } });
    if (!notification) return res.status(404).json({ error: '通知不存在' });
    if (notification.senderId !== Number(userId)) {
      return res.status(403).json({ error: '只能发送自己创建的通知' });
    }
    if (notification.status === 'sent') {
      return res.status(400).json({ error: '该通知已发送，不能重复发送' });
    }

    // 发送者用户信息（用于权限校验）
    const sender = await prisma.user.findUnique({ where: { id: Number(userId) } });
    if (!sender) return res.status(404).json({ error: '发送者不存在' });

    const { userIds, description } = await resolveAudience(notification.audience);
    // 不发送给自己
    const recipients = userIds.filter((uid) => uid !== Number(userId));
    await assertCanSend(sender, recipients);

    const updated = await prisma.notification.update({
      where: { id },
      data: {
        status: 'sent',
        sentAt: new Date(),
        audience: description,
        recipients: {
          create: recipients.map((uid) => ({ userId: uid })),
        },
      },
      include: {
        sender: { select: { id: true, name: true, studentId: true, role: true } },
        recipients: { include: { user: true } },
      },
    });

    logUsage(Number(userId), 'send_draft', `草稿转发送 通知#${id}「${updated.title}」→ ${description}（${updated.recipients.length} 人）`);
    res.json({ ...updated, recipientCount: updated.recipients.length });
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /api/notifications/:id/recipient
 * body: { userId }  → 将某用户从收件人列表中移除（用于收件人删除自己的记录）
 */
router.delete('/:id/recipient', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: '缺少 userId' });

    const result = await prisma.recipient.deleteMany({
      where: { notificationId: id, userId: Number(userId) },
    });
    if (result.count === 0) {
      return res.status(404).json({ error: '该用户不在此通知的收件人列表中' });
    }

    logUsage(Number(userId), 'remove_inbox', `从收件箱移除 通知#${id}`);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /api/notifications/:id
 * 删除通知（同时删除关联的收件人记录）
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.notification.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: '通知不存在' });

    await prisma.$transaction([
      prisma.recipient.deleteMany({ where: { notificationId: id } }),
      prisma.notification.delete({ where: { id } }),
    ]);

    logUsage(existing.senderId, 'delete_notification', `删除通知#${id}「${existing.title}」`);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
