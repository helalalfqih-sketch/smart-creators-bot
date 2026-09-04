import { FilenameUtils } from '../utils/filenameUtils';

// Translation helper service to automatically translate foreign video titles and descriptions into Arabic
export class TranslationService {
  public static containsArabic(text: string): boolean {
    return /[\u0600-\u06FF]/.test(text);
  }

  public static async translateToArabic(text: string): Promise<string> {
    const trimmed = (text || '').trim();
    if (!trimmed) return '';

    // If it's already completely Arabic, return directly
    if (/^[\u0600-\u06FF\s\d\p{P}]+$/u.test(trimmed)) {
      return trimmed;
    }

    // Method 1: Direct Google Translate Endpoint (Works universally in Node.js & Browser)
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ar&dt=t&q=${encodeURIComponent(trimmed)}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': '*/*',
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && Array.isArray(data[0])) {
          const translatedParts = data[0]
            .map((item: any) => (Array.isArray(item) && item[0] ? item[0] : ''))
            .filter(Boolean);
          const result = translatedParts.join('').trim();
          if (result) return result;
        }
      }
    } catch (e) {
      // Direct Google translate notice
    }

    // Method 2: Internal API route (Check window for browser vs Node.js)
    try {
      const isBrowser = typeof window !== 'undefined';
      const apiUrl = isBrowser ? `/api/translate?text=${encodeURIComponent(trimmed)}` : `http://localhost:3000/api/translate?text=${encodeURIComponent(trimmed)}`;
      const res = await fetch(apiUrl);
      if (res.ok) {
        const data = await res.json();
        if (data && data.translated && data.translated.trim()) {
          return data.translated.trim();
        }
      }
    } catch (e) {
      // API route fallback notice
    }

    // Method 3: MyMemory API with autodetect or Chinese pair to Arabic
    try {
      const isChinese = /[\u4e00-\u9fa5]/.test(trimmed);
      const langpair = isChinese ? 'zh-CN|ar' : 'autodetect|ar';
      const memUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=${langpair}`;
      const res = await fetch(memUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.responseData?.translatedText) {
          const trans = data.responseData.translatedText.trim();
          if (trans && trans !== trimmed && !trans.toLowerCase().includes('my memory error')) {
            return trans;
          }
        }
      }
    } catch (e) {
      // MyMemory fallback notice
    }

    return trimmed;
  }

  public static async formatArabicCaption(
    rawTitle: string = '',
    platform: string = 'TikTok',
    author?: string,
    durationSec?: number,
    formattedSize?: string,
    resolutionLabel?: string
  ): Promise<string> {
    const raw = (rawTitle || '').trim();
    const cleanMainText = FilenameUtils.stripHashtags(raw);
    const existingHashtags = FilenameUtils.extractHashtags(raw);

    let arabicTitle = '';
    if (cleanMainText) {
      arabicTitle = await this.translateToArabic(cleanMainText);
    } else {
      arabicTitle = `مقطع فيديو مميز من ${platform}`;
    }

    // Determine platform emoji & localized display
    let platformIcon = '🎬';
    let platformDisplay = platform;
    const lowerP = platform.toLowerCase();
    if (lowerP.includes('tiktok')) {
      platformIcon = '🎵';
      platformDisplay = 'TikTok • تيك توك';
    } else if (lowerP.includes('youtube')) {
      platformIcon = '🎥';
      platformDisplay = 'YouTube • يوتيوب';
    } else if (lowerP.includes('instagram')) {
      platformIcon = '📸';
      platformDisplay = 'Instagram • إنستغرام';
    } else if (lowerP.includes('twitter') || lowerP.includes('x.com')) {
      platformIcon = '🐦';
      platformDisplay = 'X (Twitter)';
    } else if (lowerP.includes('facebook')) {
      platformIcon = '👥';
      platformDisplay = 'Facebook • فيسبوك';
    } else if (lowerP.includes('douyin')) {
      platformIcon = '⚡';
      platformDisplay = 'Douyin • دوين';
    } else if (lowerP.includes('xiaohongshu') || lowerP.includes('xhslink') || lowerP.includes('redbook')) {
      platformIcon = '📕';
      platformDisplay = 'Xiaohongshu • شياوهونغشو (ريدبوك)';
    }

    // Format duration mm:ss
    let durationText = '';
    if (durationSec && durationSec > 0) {
      const mins = Math.floor(durationSec / 60);
      const secs = Math.floor(durationSec % 60);
      durationText = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    // Filter and sanitize hashtags with clean RTL spacing
    const defaultArabicTags = ['#اكسبلور', '#ترند', '#فيديو'];
    if (lowerP.includes('tiktok')) defaultArabicTags.push('#تيك_توك');
    else if (lowerP.includes('youtube')) defaultArabicTags.push('#شورتس');
    else if (lowerP.includes('instagram')) defaultArabicTags.push('#ريلز');
    else if (lowerP.includes('xiaohongshu') || lowerP.includes('xhslink') || lowerP.includes('redbook')) defaultArabicTags.push('#شياوهونغشو');

    const relevantExistingTags = existingHashtags.filter(tag => 
      this.containsArabic(tag) || /^(#fyp|#viral|#shorts|#reels|#trending)$/i.test(tag)
    );

    const combinedTags = Array.from(new Set([...relevantExistingTags, ...defaultArabicTags])).slice(0, 5);

    // Build the structured card
    let card = `🎬 <b>${arabicTitle}</b>\n`;
    card += `━━━━━━━━━━━━━━━━━━━━\n`;
    card += `📁 <b>المنصة:</b> ${platformIcon} ${platformDisplay}\n`;
    if (author && author.trim()) {
      card += `👤 <b>الناشر:</b> <code>${author.trim()}</code>\n`;
    }
    
    const metaParts: string[] = [];
    if (durationText) metaParts.push(`⏱ <b>المدة:</b> <code>${durationText}</code>`);
    if (formattedSize) metaParts.push(`📦 <b>الحجم:</b> <code>${formattedSize}</code>`);
    if (resolutionLabel) metaParts.push(`💎 <b>الدقة:</b> <code>${resolutionLabel}</code>`);
    
    if (metaParts.length > 0) {
      card += metaParts.join(' • ') + '\n';
    }

    card += `🛡️ <b>الحالة:</b> بدون علامة مائية (No Watermark) ✅\n\n`;

    if (combinedTags.length > 0) {
      card += `🏷️ <b>الوسوم:</b>\n${combinedTags.join('  ')}\n`;
    }

    return card.trim();
  }
}

