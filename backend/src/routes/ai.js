const express = require('express');
const { extractInfo } = require('../aiExtract');

const router = express.Router();

/**
 * POST /api/ai/extract
 * body: { text }  通知原文
 * 返回: { source: 'ai'|'rule', result: { audience, time, location, notes } }
 * API Key 从服务端环境变量读取，前端无需携带。
 */
router.post('/extract', async (req, res, next) => {
  try {
    const text = String((req.body || {}).text || '').trim();
    if (!text) {
      return res.status(400).json({ error: '缺少通知内容 text' });
    }
    const apiKey = process.env.ZHIPU_API_KEY;
    const { source, result } = await extractInfo(text, apiKey);
    res.json({ source, result });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
