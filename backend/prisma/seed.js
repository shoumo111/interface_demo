/**
 * 种子数据脚本：初始化用户数据（含默认密码 + 管理员账号）
 * 运行方式：npm run seed
 * - 普通用户默认密码：123456
 * - 管理员：
 *   - admin   / admin123  一级管理员（可看全部数据，含管理员信息和用户密码）
 *   - admin2  / admin123  二级管理员
 *   - admin3  / admin123  二级管理员
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// 默认密码（普通用户）
const DEFAULT_PASSWORD = '123456';
// 管理员默认密码
const ADMIN_PASSWORD = 'admin123';

const admins = [
  { studentId: 'admin', name: '超级管理员', role: 'admin', adminLevel: 1, password: ADMIN_PASSWORD },
  { studentId: 'admin2', name: '二级管理员·张', role: 'admin', adminLevel: 2, password: ADMIN_PASSWORD },
  { studentId: 'admin3', name: '二级管理员·李', role: 'admin', adminLevel: 2, password: ADMIN_PASSWORD },
];

const teachers = [
  { studentId: 'T001', name: '张伟', role: 'teacher', phone: '13800000001', email: 'zhangwei@campus.edu' },
  { studentId: 'T002', name: '李娜', role: 'teacher', phone: '13800000002', email: 'lina@campus.edu' },
  { studentId: 'T003', name: '王强', role: 'teacher', phone: '13800000003', email: 'wangqiang@campus.edu' },
];

const students = [
  // 大四
  { studentId: '2023001', name: '陈晨', role: 'student', grade: '大四', major: '计算机科学与技术', className: '计科2301', position: '学习委员' },
  { studentId: '2023002', name: '刘洋', role: 'student', grade: '大四', major: '计算机科学与技术', className: '计科2301' },
  { studentId: '2023003', name: '赵敏', role: 'student', grade: '大四', major: '软件工程', className: '软工2301' },
  // 大三
  { studentId: '2024001', name: '孙悦', role: 'student', grade: '大三', major: '计算机科学与技术', className: '计科2302', position: '学生会会长' },
  { studentId: '2024002', name: '周杰', role: 'student', grade: '大三', major: '信息管理与信息系统', className: '信管2301' },
  { studentId: '2024003', name: '吴倩', role: 'student', grade: '大三', major: '会计学', className: '会计2301' },
  // 大二
  { studentId: '2025001', name: '郑爽', role: 'student', grade: '大二', major: '计算机科学与技术', className: '计科2401', position: '社团社长' },
  { studentId: '2025002', name: '王磊', role: 'student', grade: '大二', major: '软件工程', className: '软工2401' },
  { studentId: '2025003', name: '冯雪', role: 'student', grade: '大二', major: '汉语言文学', className: '中文2401' },
  // 大一
  { studentId: '2026001', name: '蒋涛', role: 'student', grade: '大一', major: '计算机科学与技术', className: '计科2501', position: '班长' },
  { studentId: '2026002', name: '沈梦', role: 'student', grade: '大一', major: '数学与应用数学', className: '数学2501' },
  { studentId: '2026003', name: '韩磊', role: 'student', grade: '大一', major: '电子商务', className: '电商2501' },
];

async function main() {
  const all = [...admins, ...teachers, ...students];

  for (const user of all) {
    const { password, ...rest } = user;
    const data = {
      ...rest,
      password: await bcrypt.hash(password || DEFAULT_PASSWORD, 10),
    };
    await prisma.user.upsert({
      where: { studentId: user.studentId },
      update: data,
      create: data,
    });
  }

  const [adminCount, teacherCount, studentCount] = await Promise.all([
    prisma.user.count({ where: { role: 'admin' } }),
    prisma.user.count({ where: { role: 'teacher' } }),
    prisma.user.count({ where: { role: 'student' } }),
  ]);

  console.log(`✅ 种子数据完成：管理员 ${adminCount} 人，教师 ${teacherCount} 人，学生 ${studentCount} 人`);
  console.log(`   普通用户默认密码：${DEFAULT_PASSWORD}；管理员密码：${ADMIN_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error('❌ 种子数据失败:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
