/**
 * AI 信息提取模块
 * 优先调用智谱 GLM-4-Flash，失败时降级为规则提取。
 * API Key 只保存在服务端（.env 的 ZHIPU_API_KEY），不暴露给前端。
 */
const ZHIPU_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

/** 规则提取（降级方案） */
function extractInfoRule(text) {
  let audience = '未识别';
  let time = '未识别';
  let location = '未识别';
  let notes = '无';

  const gradeMap = {
    '大一': '大一新生',
    '大二': '大二学生',
    '大三': '大三学生',
    '大四': '大四毕业生',
    '全体': '全体师生',
    '老师': '全体教职工',
    '党员': '全体党员',
    '研究生': '研究生',
  };
  for (const [key, val] of Object.entries(gradeMap)) {
    if (text.includes(key)) { audience = val; break; }
  }
  if (audience === '未识别') {
    const match = text.match(/([\u4e00-\u9fa5]{1,4}(?:班|级))/);
    if (match) audience = match[1];
  }

  const timeRegex = /(明天|后天|下[周一二三四五六日]|[0-9]{1,2}[:：][0-9]{2}|[0-9]{1,2}点|[上中下]午[0-9]{1,2}点)/;
  const found = text.match(timeRegex);
  if (found) time = found[0];

  const locationRegex = /(?:在|于|前往|到)\s*([\u4e00-\u9fa5a-zA-Z0-9]{1,12}(?:教室|楼|厅|场|馆|室|办|中心|操场|广场|楼前|楼下|报告厅|会议室|堂|园|馆|院|处|科))/;
  const locMatch = text.match(locationRegex);
  if (locMatch) location = locMatch[1];

  let remaining = text;
  if (locMatch) remaining = remaining.replace(locMatch[0], '');
  if (found) remaining = remaining.replace(found[0], '');
  for (const key of Object.keys(gradeMap)) {
    remaining = remaining.replace(key, '');
  }
  const cleanRemaining = remaining.replace(/[，,。、\s]+/g, ' ').trim();
  if (cleanRemaining.length > 2 && cleanRemaining.length < 50) {
    notes = cleanRemaining;
  }

  return { audience, time, location, notes };
}

/** 智谱 AI 提取 */
async function extractWithAI(text, apiKey) {
  const response = await fetch(ZHIPU_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'glm-4-flash',
      messages: [
        {
          role: 'system',
          content: `你是一个校园通知信息提取专家。从用户输入的通知中提取以下4个字段，只返回JSON格式，不要有其他内容。
          字段说明：
          1. audience（目标人群）：如"大二学生"、"全体师生"等
          2. time（时间）：如"明天下午3点"等
          3. location（地点）：如"操场"、"会议室"等
          4. notes（备注）：其他重要信息
          如果某个字段无法识别，值设为"未识别"。
          只返回JSON，不要解释。`,
        },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
      max_tokens: 200,
    }),
  });

  if (!response.ok) {
    throw new Error(`AI 请求失败: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : content;
  const result = JSON.parse(jsonStr);

  return {
    audience: result.audience || '未识别',
    time: result.time || '未识别',
    location: result.location || '未识别',
    notes: result.notes || '无',
  };
}

/**
 * 统一入口：优先 AI，失败降级规则。
 * @returns {Promise<{ source: 'ai'|'rule', result: object }>}
 */
async function extractInfo(text, apiKey) {
  if (apiKey) {
    try {
      const result = await extractWithAI(text, apiKey);
      return { source: 'ai', result };
    } catch (e) {
      console.error('[AI 提取失败，降级规则]', e.message);
    }
  }
  return { source: 'rule', result: extractInfoRule(text) };
}

module.exports = { extractInfo, extractInfoRule };
