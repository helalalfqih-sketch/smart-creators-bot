// Smart Creators - Gemini AI Chat & Content Advisor Service
// Powers conversational responses, script generation, advice, and non-URL queries

export interface GeminiChatResponse {
  ok: boolean;
  reply: string;
  source: 'gemini' | 'fallback';
  latencyMs?: number;
  error?: string;
}

export class GeminiChatService {
  /**
   * Sends a user query to Gemini AI to generate an intelligent Arabic response
   */
  public static async ask(prompt: string, userName?: string): Promise<GeminiChatResponse> {
    const cleanPrompt = prompt ? prompt.trim() : '';
    if (!cleanPrompt) {
      return {
        ok: false,
        reply: 'مرحباً بك! كيف يمكنني مساعدتك اليوم في صناعة المحتوى أو تحميل وتحسين الفيديوهات؟',
        source: 'fallback',
      };
    }

    const startTime = Date.now();

    // 1. Try server API endpoint (/api/ai/gemini-chat)
    try {
      const response = await fetch('/api/ai/gemini-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: cleanPrompt,
          userName: userName || 'صديقنا المبدع',
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.ok && data.reply) {
          return {
            ok: true,
            reply: data.reply,
            source: 'gemini',
            latencyMs: data.latencyMs || (Date.now() - startTime),
          };
        }
      }
    } catch {
      // Fallback to local server-side direct import if running in Node runtime
    }

    // 2. Direct server-side call if running inside Node environment
    if (typeof process !== 'undefined' && process.env) {
      try {
        const { loadPersistentConfig } = await import('./configPersistence');
        const config = loadPersistentConfig();
        const apiKey = config.GEMINI_API_KEY || process.env.GEMINI_API_KEY;

        if (apiKey && apiKey.trim().length > 5) {
          const { GoogleGenAI } = await import('@google/genai');
          const ai = new GoogleGenAI({ apiKey: apiKey.trim() });

          const systemInstruction = `أنت المساعد الذكي وخبير صناعة المحتوى لمنصة ومجتمع Smart Creators Bot (@smart_creators_bot).
مهمتك:
1. الإجابة بذكاء وإبداع واحترافية وبشكل موجز وجذاب على أي استفسار، دردشة، تحية، أسئلة حول المنصات (TikTok, YouTube, Instagram, X)، أو اقتراح أفكار وسكريبتات فيديو وهاشتاغات.
2. تحدث باللغة العربية الفصحى السلسة وبأسلوب راقٍ وودود ومساعد مع تنسيق جميل وتنسيقات مناسبة لتيليجرام.
3. إذا سأل المستخدم أو حيّاك (مثل "مرحبا كيفك" أو "أهلاً")، رحّب به بلطف واذكر باختصار قدرتك على الإجابة على أي سؤال وصناعة الأفكار بالإضافة لتحميل وفك تشفير أي فيديو 4K.
4. إذا سأل المستخدم عن كيفية التحميل، وجّهه ببساطة لإرسال رابط أي فيديو مباشرة ليتم معالجته فوراً.
5. حافظ على الإجابات مركزة، مفيدة، وخالية من الحشو الزائد.`;

          const result = await ai.models.generateContent({
            model: 'gemini-3.7-flash',
            contents: `المستخدم: ${userName || 'المستخدم'}\nالرسالة: ${cleanPrompt}`,
            config: {
              systemInstruction,
            },
          });

          const reply = result.text?.trim();
          if (reply) {
            return {
              ok: true,
              reply,
              source: 'gemini',
              latencyMs: Date.now() - startTime,
            };
          }
        }
      } catch (err: any) {
        console.warn('Direct Gemini call fallback error:', err?.message);
      }
    }

    // 3. Smart Intelligent Fallback Generator for Common Interactions
    return {
      ok: true,
      reply: this.generateSmartFallbackReply(cleanPrompt, userName),
      source: 'fallback',
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * Generates a context-aware intelligent fallback response if API is unreachable
   */
  public static generateSmartFallbackReply(prompt: string, userName?: string): string {
    const p = prompt.toLowerCase().trim();
    const name = userName ? ` ${userName}` : '';

    if (p.includes('مرحبا') || p.includes('هلا') || p.includes('سلام') || p.includes('كيفك') || p.includes('أهلا') || p.includes('اهلا')) {
      return `👋 <b>أهلاً وسهلاً بك يا${name}!</b> ✨\n\nأنا مساعدك الذكي في <b>Smart Creators</b>، جاهز دائماً لمساعدتك في الإجابة على استفساراتك، توليد أفكار المحتوى، وتحميل وترقية مقاطع الفيديو إلى <b>4K UHD 60FPS</b> بدون علامة مائية.\n\n💡 <b>كيف أساعدك الآن؟</b>\n• أرسل أي سؤال أو فكرة تريد تطويرها وسأجيبك فوراً.\n• أو أرسل رابط أي فيديو للبدء في تحميله وترقيته!`;
    }

    if (p.includes('فكرة') || p.includes('افكار') || p.includes('محتوى') || p.includes('ترند') || p.includes('سكريبت')) {
      return `🎬 <b>إليك استراتيجية ذكية لصناعة محتوى ينتشر بسرعة (Viral Content):</b>\n\n1️⃣ <b>الخطاف (Hook):</b> أول 3 ثوانٍ هي الأهم، اطرح سؤالاً غير متوقع أو مشهداً بصرياً لافتاً.\n2️⃣ <b>القيمة المضافة:</b> قدّم معلومة سريعة أو حلاً لمشكلة تهم جمهورك.\n3️⃣ <b>الدعوة للتفاعل (CTA):</b> اطلب رأيهم في التعليقات أو حفّزهم على حفظ الفيديو.\n\n✨ <i>أرسل لي الموضوع المحدد الذي تريد صناعة سكريبت له وسأقوم بصياغته لك فوراً!</i>`;
    }

    if (p.includes('كيف احمل') || p.includes('تحميل') || p.includes('تنزيل') || p.includes('رابط')) {
      return `📥 <b>طريقة التحميل فائقة السهولة:</b>\n\nفقط انسخ رابط أي مقطع من (تيك توك، يوتيوب، انستقرام، تويتر، فيسبوك) وأرسله هنا مباشرة في المحادثة!\n\n⚡ سيقوم البوت فوراً بفك التشفير، إزالة العلامة المائية، وإتاحة خيارات التحميل بدقة تصل إلى <b>4K فائق الدقة مع صوت استوديو 320k</b>.`;
    }

    if (p.includes('من انت') || p.includes('مين انت') || p.includes('من أنت') || p.includes('عنك')) {
      return `🤖 <b>أنا المساعد الذكي لمنصة Smart Creators!</b>\n\nأجمع بين محرك الذكاء الاصطناعي <b>Google Gemini</b> للتحليل والإجابة وتوليد المحتوى، ومحركات <b>GPU Cloud (Real-ESRGAN)</b> لترقية وتحسين جودة الفيديوهات إلى 4K UHD وإزالة العلامات المائية.`;
    }

    return `💡 <b>مرحباً بك يا${name}!</b>\n\nلقد استلمت استفسارك: <i>"${prompt}"</i>\n\nأنا جاهز للإجابة على كل استفساراتك، مساعدتك في صناعة وتطوير المحتوى، أو تحميل أي مقطع فيديو فور إرسال رابطه!`;
  }
}
