/**
 * API 集成测试脚本（UTF-8）
 * 运行方式：node test-api.js
 */
const { PrismaClient } = require('@prisma/client');

const BASE = 'http://localhost:3001/api';

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

// 清理历史测试通知（保证可重复运行）
async function cleanup() {
  const prisma = new PrismaClient();
  await prisma.$transaction([
    prisma.recipient.deleteMany(),
    prisma.notification.deleteMany(),
  ]);
  await prisma.$disconnect();
  console.log('🧹 已清理历史测试通知');
}

function ok(name, res, check) {
  const pass = check ? check(res) : res.status < 400;
  console.log(`${pass ? '✅' : '❌'} ${name} (${res.status})`);
  if (!pass) console.log(JSON.stringify(res.data, null, 2));
  return res;
}

async function main() {
  await cleanup();

  // 1. 健康检查
  ok('健康检查', await req('GET', '/health'), (r) => r.data.ok === true);

  // 2. 登录（教师）
  const loginT = ok('教师登录 T001', await req('POST', '/auth/login', { studentId: 'T001' }), (r) => r.data.user.role === 'teacher');
  // 3. 登录（学生）
  const loginS = ok('学生登录 2025001', await req('POST', '/auth/login', { studentId: '2025001' }), (r) => r.data.user.role === 'student');

  const teacher = loginT.data.user;
  const student = loginS.data.user;

  // 4. 用户列表（按专业过滤）
  ok('用户列表-计算机专业', await req('GET', `/users?major=${encodeURIComponent('计算机')}`), (r) => Array.isArray(r.data) && r.data.length > 0);

  // 5. 发送通知 → 大二学生
  const sent = ok('发送通知-大二学生', await req('POST', '/notifications', {
    senderId: teacher.id,
    title: '体测通知',
    content: '明天下午3点，全体大二学生在操场集合进行体测，请穿运动服。',
    audience: '大二学生',
    location: '操场',
    eventTime: '明天下午3点',
    notes: '请穿运动服',
  }), (r) => r.status === 201 && r.data.recipientCount >= 2);

  // 6. 发送通知 → 全体教职工
  ok('发送通知-全体教职工', await req('POST', '/notifications', {
    senderId: teacher.id,
    title: '教职工例会',
    content: '下周一上午10点，全体教职工在行政楼会议室召开例会。',
    audience: '全体教职工',
    location: '行政楼会议室',
    eventTime: '下周一上午10点',
  }), (r) => r.status === 201 && r.data.recipientCount === 3);

  // 7. 我收到的通知
  const received = ok('收件箱-学生', await req('GET', `/notifications/received?userId=${student.id}`), (r) => Array.isArray(r.data) && r.data.length >= 1);
  if (received.data.length > 0) {
    const notifId = received.data[0].id;
    // 8. 标记已读
    ok('标记已读', await req('PATCH', `/notifications/${notifId}/read`, { userId: student.id }), (r) => r.data.ok === true);
  }

  // 9. 我发出的通知
  ok('已发送列表-教师', await req('GET', `/notifications/sent?userId=${teacher.id}`), (r) => Array.isArray(r.data) && r.data.length >= 2);

  // 10. 通知详情
  ok('通知详情', await req('GET', `/notifications/${sent.data.id}`), (r) => r.data.recipientCount >= 2);

  // 11. 统计
  ok('仪表盘统计', await req('GET', '/stats'), (r) => r.data.notificationCount >= 2 && r.data.userCount >= 15);

  // 12. 删除通知
  ok('删除通知', await req('DELETE', `/notifications/${sent.data.id}`), (r) => r.data.ok === true);

  console.log('\n🎉 全部测试完成');
}

main().catch((e) => {
  console.error('❌ 测试执行出错:', e.message);
  process.exit(1);
});
