/**
 * Security Service
 * Implements enterprise protection: SSRF Prevention, Secret Redaction,
 * Webhook Secret Verification, and Safe Input Sanitization.
 */

export class SecurityService {
  /**
   * Validates target URL and strictly blocks SSRF (Server-Side Request Forgery)
   * Prevents requests to localhost, internal private subnets, cloud metadata IPs, and non-HTTP protocols.
   */
  public static validateSafeUrl(rawUrl: string): { isValid: boolean; sanitizedUrl?: string; error?: string } {
    if (!rawUrl || typeof rawUrl !== 'string') {
      return { isValid: false, error: 'الرابط فارغ أو غير صالح' };
    }

    const trimmed = rawUrl.trim();

    // Enforce HTTP / HTTPS protocols only
    if (!/^https?:\/\//i.test(trimmed)) {
      return { isValid: false, error: 'بروتوكول الرابط غير آمن. يجب أن يبدأ بـ http:// أو https://' };
    }

    try {
      const parsed = new URL(trimmed);
      const hostname = parsed.hostname.toLowerCase();

      // Block local and private hostnames
      const blockedHostnames = [
        'localhost',
        '127.0.0.1',
        '0.0.0.0',
        '::1',
        'internal',
        'local',
        'metadata.google.internal',
        '169.254.169.254', // AWS/GCP Instance Metadata Service
      ];

      if (blockedHostnames.includes(hostname)) {
        return { isValid: false, error: 'تم حظر الرابط لأسباب أمنية (Internal/Local Host)' };
      }

      // Block IPv4 private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16)
      const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
      const match = hostname.match(ipv4Regex);
      if (match) {
        const [_, oct1, oct2] = match.map(Number);
        if (oct1 === 10) return { isValid: false, error: 'تم حظر الوصول إلى العناوين الخاصة (10.x.x.x)' };
        if (oct1 === 127) return { isValid: false, error: 'تم حظر الوصول إلى العناوين المحلية (127.x.x.x)' };
        if (oct1 === 169 && oct2 === 254) return { isValid: false, error: 'تم حظر الوصول إلى خدمة البيانات الوصفية (169.254.x.x)' };
        if (oct1 === 172 && oct2 >= 16 && oct2 <= 31) return { isValid: false, error: 'تم حظر الوصول إلى الشبكات الداخلية (172.16-31.x.x)' };
        if (oct1 === 192 && oct2 === 168) return { isValid: false, error: 'تم حظر الوصول إلى الشبكات الخاصة (192.168.x.x)' };
        if (oct1 === 0) return { isValid: false, error: 'تم حظر الوصول إلى العنوان الصفري' };
      }

      return { isValid: true, sanitizedUrl: parsed.href };
    } catch {
      return { isValid: false, error: 'صيغة الرابط غير صحيحة' };
    }
  }

  /**
   * Secret Redaction
   * Redacts sensitive tokens (Telegram Bot Tokens, Fal/Replicate API Keys, Bearer tokens) from log messages.
   */
  public static redactSecrets(text: string): string {
    if (!text || typeof text !== 'string') return text;

    return text
      // Redact Telegram Bot Tokens (e.g. 123456789:ABCdefGHIjklMNOpqrSTUvwxYZ)
      .replace(/\b(\d{8,11}):[A-Za-z0-9_-]{30,40}\b/g, '$1:[REDACTED_BOT_TOKEN]')
      // Redact Replicate API keys (r8_...)
      .replace(/r8_[A-Za-z0-9]{32,45}/g, 'r8_[REDACTED_REPLICATE_KEY]')
      // Redact Fal API keys (fal_...)
      .replace(/fal_[A-Za-z0-9_-]{20,50}/g, 'fal_[REDACTED_FAL_KEY]')
      // Redact generic Authorization Bearer tokens
      .replace(/(Bearer\s+)[A-Za-z0-9_\-\.]{20,}/gi, '$1[REDACTED_BEARER_TOKEN]')
      // Redact URL password credentials (https://user:pass@host)
      .replace(/(https?:\/\/[^:]+:)[^@]+(@)/g, '$1[REDACTED_PASS]$2');
  }

  /**
   * Validates Telegram Webhook Secret Token
   */
  public static verifyWebhookSecret(
    receivedHeaderSecret: string | undefined | null,
    expectedSecret: string | undefined | null
  ): boolean {
    if (!expectedSecret || !expectedSecret.trim()) {
      // If no secret configured in environment, allow or warn depending on deployment mode
      return true;
    }
    if (!receivedHeaderSecret) return false;
    return receivedHeaderSecret.trim() === expectedSecret.trim();
  }

  /**
   * Sanitize filenames to prevent path traversal
   */
  public static sanitizePath(filename: string): string {
    return filename
      .replace(/^(\.\.[\/\\])+/g, '')
      .replace(/[\/\\:*?"<>|]/g, '_')
      .replace(/^\.+/, '')
      .trim();
  }
}
