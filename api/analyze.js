const https = require('https');

// Helper: fetch website via allorigins proxy
function fetchWebsite(url) {
  return new Promise((resolve) => {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    https.get(proxyUrl, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data).contents || ''); }
        catch(e) { resolve(''); }
      });
    }).on('error', () => resolve(''))
      .on('timeout', () => resolve(''));
  });
}

// Helper: strip HTML
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
    .trim()
    .substring(0, 4000);
}

// Helper: call Claude
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

// Helper: generate image with GPT-image-1
function generateImage(prompt, openaiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'gpt-image-1',
      prompt: prompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard'
    });
    const options = {
      hostname: 'api.openai.com',
      path: '/v1/images/generations',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 30000
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          // gpt-image-1 returns base64
          const imageData = json.data?.[0]?.b64_json || null;
          const imageUrl = json.data?.[0]?.url || null;
          resolve({ imageData, imageUrl, raw: json });
        } catch(e) { reject(new Error('Invalid JSON from OpenAI')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('OpenAI timeout')); });
    req.write(body);
    req.end();
  });
}

// Helper: build image prompt from post context
function buildImagePrompt(post, companyName, industry, imgStyle) {
  const styleMap = {
    people: 'professional photo of a real person, photorealistic, natural lighting, studio quality',
    lifestyle: 'lifestyle photography, natural setting, warm tones, photorealistic',
    product: 'professional product photography, clean background, studio lighting, commercial quality',
    business: 'professional business setting, modern office, corporate photography',
    food: 'professional food photography, beautiful plating, appetizing, restaurant quality',
    abstract: 'creative abstract visual, vibrant colors, modern graphic design'
  };
  const style = styleMap[imgStyle] || styleMap.people;
  const platform = post.platform || 'instagram';
  const text = post.text || '';

  // Extract key visual idea from post text
  const idea = text.substring(0, 100).replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, '').trim();

  return `${style}, for ${platform} social media post, ${companyName || 'brand'} company in ${industry || 'business'} industry, Arabic market, high quality commercial photography, no text in image, suitable for social media marketing. Context: ${idea}. Aspect ratio 1:1.`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const { url, companyName, industry, description, country, audience,
    competitors, goals, mode, platforms, tone, count,
    analysisData, customTopic, imgStyle, post } = req.body || {};

  try {

    // ── ANALYZE MODE ──────────────────────────────────────────
    if (mode === 'analyze') {
      if (!anthropicKey) return res.status(500).json({ error: 'Anthropic API key not configured' });

      let websiteText = '';
      if (url) {
        const cleanUrl = url.startsWith('http') ? url : 'https://' + url;
        const html = await fetchWebsite(cleanUrl);
        websiteText = extractText(html);
      }

      const websiteSection = websiteText
        ? `\n\nتم جلب محتوى الموقع بنجاح:\n"""\n${websiteText}\n"""\nاستخدم هذا المحتوى الحقيقي في تحليلك.`
        : '\n\nلم يتم جلب محتوى الموقع، استخدم المعلومات المدخلة فقط.';

      const prompt = `أنت خبير تسويق رقمي ومحلل أعمال محترف متخصص في السوق العربي.

معلومات الشركة:
- الاسم: ${companyName || 'غير محدد'}
- المجال: ${industry || 'غير محدد'}
- الوصف: ${description || 'غير محدد'}
- الموقع: ${url || 'غير متاح'}
- السوق: ${country || 'الشرق الأوسط'}
- الجمهور: ${audience || 'غير محدد'}
- المنافسون: ${competitors || 'غير محددين'}
- الأهداف: ${(goals || []).join('، ')}
${websiteSection}

أعطني JSON فقط:
{
  "scores": { "market_opportunity": 85, "content_potential": 90, "competition_level": 65 },
  "summary": "ملخص تنفيذي دقيق (3-4 جمل)",
  "website_fetched": ${!!websiteText},
  "products_services": {
    "main": ["منتج/خدمة1", "منتج2", "منتج3"],
    "unique_value": "ما يميز هذه الشركة تحديداً"
  },
  "target_audience": {
    "primary": "الجمهور الأساسي",
    "secondary": "الجمهور الثانوي",
    "pain_points": ["مشكلة1", "مشكلة2", "مشكلة3"],
    "desires": ["رغبة1", "رغبة2", "رغبة3"]
  },
  "market_analysis": {
    "opportunities": ["فرصة1", "فرصة2", "فرصة3"],
    "challenges": ["تحدي1", "تحدي2"],
    "competitor_weaknesses": ["نقطة ضعف1", "نقطة ضعف2"]
  },
  "content_strategy": {
    "best_topics": ["موضوع1", "موضوع2", "موضوع3", "موضوع4"],
    "content_pillars": ["ركيزة1", "ركيزة2", "ركيزة3"],
    "recommended_tone": "النبرة الأنسب",
    "posting_frequency": "التوصية المناسبة",
    "content_ideas": ["فكرة1", "فكرة2", "فكرة3"]
  },
  "strengths": ["قوة1", "قوة2", "قوة3"],
  "recommendations": ["توصية1", "توصية2", "توصية3"]
}`;

      const claudeRes = await callClaude(prompt, anthropicKey);
      const txt = (claudeRes.content || []).map(c => c.text || '').join('');
      const match = txt.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Could not parse analysis');
      const analysis = JSON.parse(match[0]);
      analysis.website_fetched = !!websiteText;
      return res.status(200).json({ success: true, analysis });
    }

    // ── GENERATE TEXT MODE ─────────────────────────────────────
    if (mode === 'generate') {
      if (!anthropicKey) return res.status(500).json({ error: 'Anthropic API key not configured' });

      const ctx = analysisData ? `
بناءً على التحليل:
- نقاط الألم: ${(analysisData.target_audience?.pain_points || []).join('، ')}
- الرغبات: ${(analysisData.target_audience?.desires || []).join('، ')}
- أفضل المواضيع: ${(analysisData.content_strategy?.best_topics || []).join('، ')}
- أفكار المحتوى: ${(analysisData.content_strategy?.content_ideas || []).join('، ')}
- القيمة المميزة: ${analysisData.products_services?.unique_value || ''}
` : '';

      const prompt = `أنت خبير تسويق رقمي للسوق العربي.

الشركة: ${companyName || 'شركتك'} | المجال: ${industry || 'أعمال'} | السوق: ${country || 'الشرق الأوسط'} | الجمهور: ${audience || 'عام'}
${ctx}${customTopic ? `التركيز: ${customTopic}` : ''}

أنشئ ${count || 5} منشورات لمنصات: ${(platforms || ['instagram']).join(' و ')}. النبرة: ${tone || 'احترافي'}.

JSON array فقط:
[{"platform":"المنصة","text":"نص المنشور مع إيموجي","hashtags":["هاشتاق1","هاشتاق2","هاشتاق3","هاشتاق4","هاشتاق5"],"image_prompt":"وصف الصورة المثالية للمنشور بالإنجليزية في جملة واحدة"}]

- كل منشور مختلف تماماً
- اذكر اسم الشركة وخدماتها
- أضف image_prompt لكل منشور: وصف إنجليزي للصورة المثالية
- الهاشتاقات بدون #`;

      const claudeRes = await callClaude(prompt, anthropicKey);
      const txt = (claudeRes.content || []).map(c => c.text || '').join('');
      const match = txt.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('Could not parse posts');
      const posts = JSON.parse(match[0]);
      return res.status(200).json({ success: true, posts });
    }

    // ── GENERATE IMAGE MODE ────────────────────────────────────
    if (mode === 'generate_image') {
      if (!openaiKey) return res.status(500).json({ error: 'OpenAI API key not configured' });

      const imagePrompt = post?.image_prompt
        ? `Professional photorealistic photo for social media: ${post.image_prompt}. No text in image. Commercial quality, 1:1 aspect ratio.`
        : buildImagePrompt(post || {}, companyName, industry, imgStyle || 'people');

      const result = await generateImage(imagePrompt, openaiKey);

      if (result.imageData) {
        return res.status(200).json({
          success: true,
          image: `data:image/png;base64,${result.imageData}`,
          type: 'base64'
        });
      } else if (result.imageUrl) {
        return res.status(200).json({
          success: true,
          image: result.imageUrl,
          type: 'url'
        });
      } else {
        throw new Error('No image returned from OpenAI');
      }
    }

    return res.status(400).json({ error: 'Invalid mode' });

  } catch(e) {
    console.error('Qantara Error:', e.message, e.stack);
    return res.status(500).json({ error: e.message });
  }
};
