const https = require('https');

// Helper: fetch website via allorigins proxy (works from Vercel free tier)
function fetchWebsite(url) {
  return new Promise((resolve, reject) => {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    https.get(proxyUrl, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.contents || '');
        } catch(e) {
          resolve('');
        }
      });
    }).on('error', () => resolve(''))
      .on('timeout', () => resolve(''));
  });
}

// Helper: strip HTML and extract meaningful text
function extractText(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
    .substring(0, 4000);
}

// Helper: call Claude API from backend (secure)
function callClaude(prompt, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 25000
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Invalid JSON from Claude')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Claude timeout')); });
    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const { url, companyName, industry, description, country, audience, competitors, goals, mode, platforms, tone, count, analysisData, customTopic } = req.body || {};

  try {

    // ── ANALYZE MODE ─────────────────────────────────
    if (mode === 'analyze') {
      // Actually fetch the website!
      let websiteText = '';
      if (url) {
        const cleanUrl = url.startsWith('http') ? url : 'https://' + url;
        const html = await fetchWebsite(cleanUrl);
        websiteText = extractText(html);
      }

      const websiteSection = websiteText
        ? `\n\nتم جلب محتوى الموقع الإلكتروني بنجاح. إليك النص المستخرج منه:\n"""\n${websiteText}\n"""\n\nاستخدم هذا المحتوى الحقيقي في تحليلك.`
        : '\n\nلم يتم جلب محتوى الموقع، استخدم المعلومات المدخلة فقط.';

      const prompt = `أنت خبير تسويق رقمي ومحلل أعمال محترف متخصص في السوق العربي.

معلومات الشركة:
- الاسم: ${companyName || 'غير محدد'}
- المجال: ${industry || 'غير محدد'}
- الوصف: ${description || 'غير محدد'}
- الموقع الإلكتروني: ${url || 'غير متاح'}
- السوق: ${country || 'الشرق الأوسط'}
- الجمهور: ${audience || 'غير محدد'}
- المنافسون: ${competitors || 'غير محددين'}
- الأهداف: ${(goals || []).join('، ')}
${websiteSection}

قم بتحليل شامل ودقيق بناءً على المعلومات الحقيقية المتاحة. أعطني JSON فقط بدون أي نص إضافي:
{
  "scores": { "market_opportunity": 85, "content_potential": 90, "competition_level": 65 },
  "summary": "ملخص تنفيذي دقيق مبني على المعلومات الحقيقية للشركة (3-4 جمل)",
  "website_fetched": ${!!websiteText},
  "products_services": {
    "main": ["الخدمة/المنتج الأول الحقيقي", "الثاني", "الثالث"],
    "unique_value": "ما يميز هذه الشركة تحديداً بناءً على معلوماتها الحقيقية"
  },
  "target_audience": {
    "primary": "الجمهور الأساسي المستهدف",
    "secondary": "الجمهور الثانوي",
    "pain_points": ["مشكلة حقيقية1", "مشكلة2", "مشكلة3"],
    "desires": ["رغبة حقيقية1", "رغبة2", "رغبة3"]
  },
  "market_analysis": {
    "opportunities": ["فرصة حقيقية1", "فرصة2", "فرصة3"],
    "challenges": ["تحدي حقيقي1", "تحدي2"],
    "competitor_weaknesses": ["نقطة ضعف منافس1", "نقطة ضعف2"]
  },
  "content_strategy": {
    "best_topics": ["موضوع محتوى مخصص1", "موضوع2", "موضوع3", "موضوع4"],
    "content_pillars": ["ركيزة1", "ركيزة2", "ركيزة3"],
    "recommended_tone": "النبرة الأنسب لهذه الشركة تحديداً",
    "posting_frequency": "التوصية المناسبة",
    "content_ideas": ["فكرة محتوى مخصصة1", "فكرة2", "فكرة3"]
  },
  "strengths": ["نقطة قوة حقيقية1", "نقطة قوة2", "نقطة قوة3"],
  "recommendations": ["توصية عملية ومخصصة1", "توصية2", "توصية3"]
}`;

      const claudeRes = await callClaude(prompt, apiKey);
      const txt = (claudeRes.content || []).map(c => c.text || '').join('');
      const match = txt.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Could not parse analysis');
      const analysis = JSON.parse(match[0]);
      analysis.website_fetched = !!websiteText;
      return res.status(200).json({ success: true, analysis });
    }

    // ── GENERATE MODE ─────────────────────────────────
    if (mode === 'generate') {
      const ctx = analysisData ? `
بناءً على التحليل الذكي للشركة:
- نقاط ألم الجمهور: ${(analysisData.target_audience?.pain_points || []).join('، ')}
- الرغبات: ${(analysisData.target_audience?.desires || []).join('، ')}
- أفضل مواضيع المحتوى: ${(analysisData.content_strategy?.best_topics || []).join('، ')}
- أفكار محتوى مقترحة: ${(analysisData.content_strategy?.content_ideas || []).join('، ')}
- القيمة المميزة: ${analysisData.products_services?.unique_value || ''}
- ركائز المحتوى: ${(analysisData.content_strategy?.content_pillars || []).join('، ')}
` : '';

      const prompt = `أنت خبير تسويق رقمي محترف متخصص في السوق العربي.

الشركة: ${companyName || 'شركتك'}
المجال: ${industry || 'أعمال'}
الوصف: ${description || 'لم يُحدد'}
السوق: ${country || 'الشرق الأوسط'}
الجمهور: ${audience || 'الجمهور العام'}
${ctx}
${customTopic ? `التركيز الخاص: ${customTopic}` : ''}

أنشئ بالضبط ${count || 5} منشورات مخصصة تماماً لهذه الشركة لمنصات: ${(platforms || ['instagram']).join(' و ')}.
النبرة: ${tone || 'احترافي'}.

JSON array فقط بدون أي نص إضافي:
[
  {
    "platform": "اسم المنصة",
    "text": "نص المنشور الكامل باللغة العربية مع إيموجي — مخصص تماماً لهذه الشركة",
    "hashtags": ["هاشتاق1","هاشتاق2","هاشتاق3","هاشتاق4","هاشتاق5"]
  }
]

قواعد مهمة:
- كل منشور مختلف تماماً في الزاوية والأسلوب
- اذكر اسم الشركة وخدماتها الحقيقية في المنشورات
- الهاشتاقات مخصصة للمجال والدولة
- الهاشتاقات بدون رمز # في JSON`;

      const claudeRes = await callClaude(prompt, apiKey);
      const txt = (claudeRes.content || []).map(c => c.text || '').join('');
      const match = txt.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('Could not parse posts');
      const posts = JSON.parse(match[0]);
      return res.status(200).json({ success: true, posts });
    }

    return res.status(400).json({ error: 'Invalid mode' });

  } catch(e) {
    console.error('Qantara Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
