/**
 * 受众解析模块
 *
 * 将用户输入的目标人群描述解析为具体的用户 ID 列表。
 * 支持的格式（大小写不敏感）：
 *   - 全体 / 所有人 / all                    → 全体师生
 *   - 教职工 / 老师 / 教师 / teacher          → 全体教职工
 *   - 大二 / 年级:大二 / 2024级 / 年级:2024   → 按年级匹配
 *   - 专业:计算机 / 计算机专业                 → 按专业匹配
 *   - 班级:计科2301 / 计科2301班              → 按班级匹配
 *   - 角色:教师 / role:student                → 按角色匹配
 *   - users:1,2,3 / 学号:2023001,2023002      → 指定用户
 */
const prisma = require('./prisma');

async function resolveAudience(audience) {
  const raw = String(audience || '').trim();
  if (!raw) throw new Error('audience 不能为空');

  // ---- 指定用户 ----
  if (/^users?[:：]|^学号[:：]/i.test(raw)) {
    const list = raw
      .replace(/^(users?[:：]|学号[:：])/i, '')
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const ids = [];
    for (const item of list) {
      if (/^\d+$/.test(item)) {
        ids.push(Number(item));
      } else {
        const u = await prisma.user.findUnique({ where: { studentId: item } });
        if (u) ids.push(u.id);
      }
    }
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) throw new Error(`指定用户未匹配到任何记录：${raw}`);
    return { userIds: uniqueIds, description: `指定用户（${uniqueIds.length} 人）` };
  }

  // ---- 教职工（需在"全体"之前判断，避免"全体教职工"被误判为全体）----
  if (/教职工|老师|教师|teacher/i.test(raw)) {
    const users = await prisma.user.findMany({ where: { role: 'teacher' }, select: { id: true } });
    return { userIds: users.map((u) => u.id), description: '全体教职工' };
  }

  // ---- 全体 ----
  if (/^全体|所有人|全部|^all$/i.test(raw)) {
    const users = await prisma.user.findMany({ select: { id: true } });
    return { userIds: users.map((u) => u.id), description: '全体师生' };
  }

  const where = {};
  let matched = false;

  // ---- 年级 ----
  // 支持：大二 / 大二学生 / 年级:大二 / 2024级 / 24级（年份自动映射到中文年级）
  if (/年级|大一|大二|大三|大四|级/i.test(raw)) {
    const gradeNames = ['大一', '大二', '大三', '大四'];
    let g = null;
    const g1 = raw.match(/(大一|大二|大三|大四)/);
    const g3 = raw.match(/(?:年级|grade)[:：]?\s*([^\s,，]+)/i);
    if (g1) {
      g = g1[1];
    } else if (g3 && /大一|大二|大三|大四/.test(g3[1])) {
      g = g3[1];
    } else {
      // 年份 → 年级（以当前年份为大一入学年）
      const yearMatch = raw.match(/(?:20)?(\d{2})\s*级/);
      if (yearMatch) {
        const year = yearMatch[1].length === 2 ? 2000 + Number(yearMatch[1]) : Number(yearMatch[1]);
        const diff = new Date().getFullYear() - year;
        if (diff >= 0 && diff < 4) g = gradeNames[diff];
      }
    }
    if (g) {
      where.grade = { contains: g };
      matched = true;
    }
  }

  // ---- 专业 ----
  // 支持：计算机专业 / 计算机专业学生 / 专业:计算机 / major:计算机
  if (/专业|major/i.test(raw)) {
    const structured = raw.match(/(?:专业|major)[:：]\s*([^\s,，]+)/i);
    const beforeWord = raw.match(/([\u4e00-\u9fa5A-Za-z0-9]{1,20})专业/i);
    const afterWord = raw.match(/(?:专业|major)\s*([^\s,，]+)/i);
    const m = (structured && structured[1]) || (beforeWord && beforeWord[1]) || (afterWord && afterWord[1]);
    if (m) {
      where.major = { contains: m };
      matched = true;
    }
  }

  // ---- 班级 ----
  // 支持：计科2301班 / 班级:计科2301 / class:计科2301
  if (/班级|班|class/i.test(raw)) {
    const structured = raw.match(/(?:班级|class)[:：]\s*([^\s,，]+)/i);
    const beforeWord = raw.match(/([\u4e00-\u9fa5A-Za-z0-9]{1,20})班/i);
    const afterWord = raw.match(/(?:班级|class)\s*([^\s,，]+)/i);
    const m = (structured && structured[1]) || (beforeWord && beforeWord[1]) || (afterWord && afterWord[1]);
    if (m) {
      where.className = { contains: m };
      matched = true;
    }
  }

  // ---- 角色 ----
  if (/角色|role/i.test(raw)) {
    const m = raw.match(/(?:角色|role)[:：]?\s*([^\s,，]+)/i);
    if (m) {
      where.role = /教|师|teacher/i.test(m[1]) ? 'teacher' : 'student';
      matched = true;
    }
  }

  if (!matched) {
    throw new Error(`无法识别的目标人群：${raw}`);
  }

  const users = await prisma.user.findMany({ where, select: { id: true } });
  if (users.length === 0) {
    throw new Error(`未匹配到任何用户：${raw}`);
  }
  return { userIds: users.map((u) => u.id), description: raw };
}

module.exports = { resolveAudience };
