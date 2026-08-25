/**
 * 密码工具：哈希、校验、脱敏
 */
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

/** 明文密码 → bcrypt 哈希 */
async function hashPassword(plain) {
  return bcrypt.hash(String(plain), SALT_ROUNDS);
}

/** 校验明文密码是否匹配哈希 */
async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(String(plain), hash);
}

/** 从用户对象中移除密码等敏感字段（返回新对象，不修改原对象） */
function sanitizeUser(user) {
  if (!user) return user;
  const { password, ...rest } = user;
  return rest;
}

module.exports = { hashPassword, verifyPassword, sanitizeUser };
