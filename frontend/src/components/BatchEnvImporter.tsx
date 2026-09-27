import React, { useState, useMemo } from 'react';
import {
  ClipboardPaste,
  FileCode,
  CheckCircle2,
  AlertCircle,
  Copy,
  Trash2,
  Sparkles,
  Layers,
  KeyRound,
  Cloud,
  Database,
  Server,
  Eye,
  EyeOff,
  Check,
  HelpCircle,
  ArrowRight,
  Sliders,
} from 'lucide-react';
import { EnvSettings } from '../types';
import { useToast } from '../context/ToastContext';

interface BatchEnvImporterProps {
  currentSettings: Partial<EnvSettings>;
  onApply: (parsed: Partial<EnvSettings>, autoSave?: boolean) => void;
  onClose?: () => void;
}

interface ParsedEntry {
  key: string;
  mappedKey: keyof EnvSettings | null;
  value: any;
  category: 'telegram' | 'storage' | 'database' | 'ai' | 'engine' | 'unknown';
  categoryLabel: string;
  isSecret: boolean;
  isValid: boolean;
}

const CATEGORY_MAP: Record<string, { cat: ParsedEntry['category']; label: string; icon: any }> = {
  // Telegram
  BOT_TOKEN: { cat: 'telegram', label: 'تيليجرام والبوت', icon: KeyRound },
  TELEGRAM_BOT_TOKEN: { cat: 'telegram', label: 'تيليجرام والبوت', icon: KeyRound },
  TELEGRAM_WEBHOOK_SECRET: { cat: 'telegram', label: 'تيليجرام والبوت', icon: KeyRound },
  WEBHOOK_MODE: { cat: 'telegram', label: 'تيليجرام والبوت', icon: KeyRound },
  AUTO_CLEAN_MESSAGES: { cat: 'telegram', label: 'تيليجرام والبوت', icon: KeyRound },

  // Storage
  MEDIA_STORAGE_DRIVER: { cat: 'storage', label: 'التخزين السحابي (R2/S3)', icon: Cloud },
  S3_ENDPOINT_URL: { cat: 'storage', label: 'التخزين السحابي (R2/S3)', icon: Cloud },
  S3_BUCKET: { cat: 'storage', label: 'التخزين السحابي (R2/S3)', icon: Cloud },
  S3_REGION: { cat: 'storage', label: 'التخزين السحابي (R2/S3)', icon: Cloud },
  S3_ACCESS_KEY_ID: { cat: 'storage', label: 'التخزين السحابي (R2/S3)', icon: Cloud },
  S3_SECRET_ACCESS_KEY: { cat: 'storage', label: 'التخزين السحابي (R2/S3)', icon: Cloud },
  S3_SIGNED_URL_TTL_SECONDS: { cat: 'storage', label: 'التخزين السحابي (R2/S3)', icon: Cloud },

  // Database / Redis
  REDIS_URL: { cat: 'database', label: 'قواعد البيانات والكاش', icon: Database },
  DATABASE_URL: { cat: 'database', label: 'قواعد البيانات والكاش', icon: Database },
  CACHE_TTL_SECONDS: { cat: 'database', label: 'قواعد البيانات والكاش', icon: Database },

  // AI
  REPLICATE_API_TOKEN: { cat: 'ai', label: 'الذكاء الاصطناعي (AI)', icon: Sparkles },
  FAL_API_KEY: { cat: 'ai', label: 'الذكاء الاصطناعي (AI)', icon: Sparkles },
  GEMINI_API_KEY: { cat: 'ai', label: 'الذكاء الاصطناعي (AI)', icon: Sparkles },

  // Engine
  DOWNLOAD_API_URL: { cat: 'engine', label: 'إعدادات المحرك والشبكة', icon: Server },
  API_HOST: { cat: 'engine', label: 'إعدادات المحرك والشبكة', icon: Server },
  API_PORT: { cat: 'engine', label: 'إعدادات المحرك والشبكة', icon: Server },
  DOWNLOAD_DIR: { cat: 'engine', label: 'إعدادات المحرك والشبكة', icon: Server },
  HTTP_TIMEOUT_SECONDS: { cat: 'engine', label: 'إعدادات المحرك والشبكة', icon: Server },
  MAX_CONCURRENT_DOWNLOADS: { cat: 'engine', label: 'إعدادات المحرك والشبكة', icon: Server },
  MAX_FILESIZE_MB: { cat: 'engine', label: 'إعدادات المحرك والشبكة', icon: Server },
  LOG_LEVEL: { cat: 'engine', label: 'إعدادات المحرك والشبكة', icon: Server },
  YTDLP_FORMAT: { cat: 'engine', label: 'إعدادات المحرك والشبكة', icon: Server },
};

// Aliases for flexible user input
const KEY_ALIASES: Record<string, keyof EnvSettings> = {
  TELEGRAM_TOKEN: 'BOT_TOKEN',
  TG_BOT_TOKEN: 'BOT_TOKEN',
  BOT_API_TOKEN: 'BOT_TOKEN',
  TOKEN: 'BOT_TOKEN',
  REDIS_URI: 'REDIS_URL',
  REDIS_HOST: 'REDIS_URL',
  R2_ENDPOINT: 'S3_ENDPOINT_URL',
  S3_ENDPOINT: 'S3_ENDPOINT_URL',
  R2_BUCKET: 'S3_BUCKET',
  R2_ACCESS_KEY_ID: 'S3_ACCESS_KEY_ID',
  R2_SECRET_ACCESS_KEY: 'S3_SECRET_ACCESS_KEY',
  AWS_ACCESS_KEY_ID: 'S3_ACCESS_KEY_ID',
  AWS_SECRET_ACCESS_KEY: 'S3_SECRET_ACCESS_KEY',
  AWS_REGION: 'S3_REGION',
  REPLICATE_TOKEN: 'REPLICATE_API_TOKEN',
  REPLICATE_API_KEY: 'REPLICATE_API_TOKEN',
  FAL_KEY: 'FAL_API_KEY',
};

const SECRET_KEYS = new Set([
  'BOT_TOKEN',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'REPLICATE_API_TOKEN',
  'FAL_API_KEY',
  'GEMINI_API_KEY',
  'DATABASE_URL',
]);

export const BatchEnvImporter: React.FC<BatchEnvImporterProps> = ({
  currentSettings,
  onApply,
  onClose,
}) => {
  const toast = useToast();
  const [rawInput, setRawInput] = useState('');
  const [showSecrets, setShowSecrets] = useState(false);
  const [copied, setCopied] = useState(false);

  // Parse raw input into structured, categorized entries
  const parsedResult = useMemo(() => {
    if (!rawInput.trim()) {
      return { entries: [] as ParsedEntry[], settingsObj: {} as Partial<EnvSettings>, validCount: 0 };
    }

    const lines = rawInput.split(/\r?\n/);
    const resultObj: Partial<EnvSettings> = {};
    const entriesList: ParsedEntry[] = [];

    // Try parsing as JSON first
    const trimmed = rawInput.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const json = JSON.parse(trimmed);
        for (const [rawK, rawV] of Object.entries(json)) {
          processKeyValue(rawK, String(rawV), resultObj, entriesList);
        }
        return {
          entries: entriesList,
          settingsObj: resultObj,
          validCount: entriesList.filter((e) => e.isValid).length,
        };
      } catch {
        // Fallback to line by line parser
      }
    }

    // Line by line parser for .env, exports, and key: value
    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;

      // Strip export prefix
      if (line.startsWith('export ')) {
        line = line.substring(7).trim();
      }

      // Match KEY=VALUE or KEY: VALUE
      const match = line.match(/^([a-zA-Z0-9_.-]+)\s*[:=]\s*(.*)$/);
      if (match) {
        const rawK = match[1];
        let rawV = match[2];

        // Clean trailing comments (e.g. KEY=VAL # comment)
        const commentIdx = rawV.indexOf(' #');
        if (commentIdx !== -1) {
          rawV = rawV.substring(0, commentIdx).trim();
        }

        // Clean quotes
        rawV = rawV.trim();
        if (
          (rawV.startsWith('"') && rawV.endsWith('"')) ||
          (rawV.startsWith("'") && rawV.endsWith("'"))
        ) {
          rawV = rawV.slice(1, -1);
        }

        processKeyValue(rawK, rawV, resultObj, entriesList);
      }
    }

    return {
      entries: entriesList,
      settingsObj: resultObj,
      validCount: entriesList.filter((e) => e.isValid).length,
    };
  }, [rawInput]);

  function processKeyValue(
    rawKey: string,
    rawVal: string,
    resultObj: Partial<EnvSettings>,
    entriesList: ParsedEntry[]
  ) {
    const cleanKey = rawKey.trim().toUpperCase();
    const cleanVal = rawVal.trim();

    const mapped = (KEY_ALIASES[cleanKey] || cleanKey) as keyof EnvSettings;
    const catInfo = CATEGORY_MAP[mapped] || {
      cat: 'unknown',
      label: 'غير معروف / مخصص',
      icon: HelpCircle,
    };

    let coercedValue: any = cleanVal;
    if (cleanVal.toLowerCase() === 'true') coercedValue = true;
    else if (cleanVal.toLowerCase() === 'false') coercedValue = false;
    else if (
      (mapped === 'API_PORT' ||
        mapped === 'HTTP_TIMEOUT_SECONDS' ||
        mapped === 'MAX_CONCURRENT_DOWNLOADS' ||
        mapped === 'MAX_FILESIZE_MB' ||
        mapped === 'CACHE_TTL_SECONDS' ||
        mapped === 'S3_SIGNED_URL_TTL_SECONDS') &&
      !isNaN(Number(cleanVal)) &&
      cleanVal !== ''
    ) {
      coercedValue = Number(cleanVal);
    }

    const isValid = Boolean(CATEGORY_MAP[mapped]);
    if (isValid) {
      (resultObj as any)[mapped] = coercedValue;
    }

    entriesList.push({
      key: cleanKey,
      mappedKey: isValid ? mapped : null,
      value: coercedValue,
      category: catInfo.cat,
      categoryLabel: catInfo.label,
      isSecret: SECRET_KEYS.has(mapped) || SECRET_KEYS.has(cleanKey),
      isValid,
    });
  }

  // Handle Paste from Clipboard
  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setRawInput(text);
        toast.success('تم اللصق من الحافظة!', `تم جلب النص بنجاح (${text.split('\n').length} أسطر)`);
      } else {
        toast.warning('الحافظة فارغة', 'يرجى نسخ المفاتيح ثم المحاولة مجدداً.');
      }
    } catch {
      toast.info('تعذر الوصول للحافظة تلقائياً', 'يرجى استخدام Ctrl+V أو اللصق داخل مربع النص مباشرة.');
    }
  };

  // Generate complete clean template
  const handleInsertTemplate = () => {
    const template = `# ── Telegram ──────────────────────────────────────────────────────────────────
BOT_TOKEN=
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
WEBHOOK_MODE=false
AUTO_CLEAN_MESSAGES=true

# ── Cloudflare R2 / S3 Media Storage ──────────────────────────────────────────
MEDIA_STORAGE_DRIVER=s3
S3_ENDPOINT_URL=https://34dad04466d97745f2c9f8214c81c0f2.r2.cloudflarestorage.com
S3_BUCKET=smart-creators-media-p0
S3_REGION=auto
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_SIGNED_URL_TTL_SECONDS=900

# ── Redis Server & Queue ──────────────────────────────────────────────────────
REDIS_URL=redis://red-da07qalg1s2s73chbdd0:6379
CACHE_TTL_SECONDS=3600

# ── Real AI Cloud Enhancers (Optional) ────────────────────────────────────────
REPLICATE_API_TOKEN=
FAL_API_KEY=
GEMINI_API_KEY=

# ── Engine & Server Limits ────────────────────────────────────────────────────
DOWNLOAD_API_URL=https://api.smartcreators.bot
API_HOST=0.0.0.0
API_PORT=8000
DOWNLOAD_DIR=/tmp/downloads
MAX_CONCURRENT_DOWNLOADS=1
MAX_FILESIZE_MB=50
HTTP_TIMEOUT_SECONDS=300
LOG_LEVEL=INFO
`;
    setRawInput(template);
    toast.info('تم تحميل قالب المتغيرات النموذجي', 'يمكنك الآن ملء قيم المفاتيح وتطبيقها.');
  };

  // Export and format organized .env
  const handleCopyOrganizedEnv = () => {
    if (parsedResult.validCount === 0) {
      toast.warning('لا توجد مفاتيح صالحة للنسخ');
      return;
    }

    const categories: Record<string, string[]> = {
      telegram: ['# ── Telegram ────────────────────────────────────────'],
      storage: ['\n# ── Cloudflare R2 / S3 Storage ──────────────────────'],
      database: ['\n# ── Redis & Database ────────────────────────────────'],
      ai: ['\n# ── AI Enhancers ────────────────────────────────────'],
      engine: ['\n# ── Engine & Limits ─────────────────────────────────'],
      unknown: ['\n# ── Custom / Others ─────────────────────────────────'],
    };

    for (const entry of parsedResult.entries) {
      const cat = entry.category;
      const k = entry.mappedKey || entry.key;
      const v = typeof entry.value === 'boolean' ? String(entry.value) : entry.value;
      categories[cat]?.push(`${k}=${v}`);
    }

    const formatted = Object.values(categories)
      .filter((arr) => arr.length > 1)
      .map((arr) => arr.join('\n'))
      .join('\n');

    navigator.clipboard.writeText(formatted);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
    toast.success('تم نسخ ملف .env مرتب ومنظم!', 'تم ترتيب جميع المفاتيح وتنسيقها حسب الفئات.');
  };

  const handleApplyForm = (autoSave = false) => {
    if (parsedResult.validCount === 0) {
      toast.warning('لم يتم التعرف على أي مفاتيح صالحة', 'تأكد من تنسيق النصوص بصيغة KEY=VALUE.');
      return;
    }
    onApply(parsedResult.settingsObj, autoSave);
    toast.success(
      autoSave ? 'تم تطبيق وحفظ المفاتيح بنجاح! 🚀' : 'تم توزيع المفاتيح على الحقول بنجاح! ✨',
      `تم تحديث ${parsedResult.validCount} متغيراً في النظام.`
    );
    if (onClose) onClose();
  };

  // Group entries by category
  const groupedEntries = useMemo(() => {
    const groups: Record<string, ParsedEntry[]> = {};
    for (const entry of parsedResult.entries) {
      if (!groups[entry.categoryLabel]) {
        groups[entry.categoryLabel] = [];
      }
      groups[entry.categoryLabel].push(entry);
    }
    return groups;
  }, [parsedResult.entries]);

  return (
    <div className="bg-slate-900 border border-indigo-500/40 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shadow-inner">
            <ClipboardPaste className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white">لصق وفرز المفاتيح دفعة واحدة (Bulk .env Importer)</h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-700">
                Auto-Sort & Map
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              الصق نصوص ملف <code className="text-indigo-300 font-mono">.env</code> أو كود <code className="text-indigo-300 font-mono">JSON</code> أو أسطر المتغيرات وسيتم التعرف عليها وتوزيعها تلقائياً.
            </p>
          </div>
        </div>

        {/* Quick helper buttons */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <button
            type="button"
            onClick={handlePasteFromClipboard}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm shadow-indigo-600/30 transition-all"
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            <span>لصق من الحافظة</span>
          </button>

          <button
            type="button"
            onClick={handleInsertTemplate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-colors"
          >
            <FileCode className="w-3.5 h-3.5 text-cyan-400" />
            <span>قالب جاهز</span>
          </button>

          {rawInput && (
            <button
              type="button"
              onClick={() => setRawInput('')}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 hover:text-rose-300 text-slate-400 border border-slate-700 transition-colors"
              title="مسح النص"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Textarea Input */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <label className="font-semibold text-slate-300 flex items-center gap-1.5">
            <span>مساحة لصق المفاتيح والمتغيرات:</span>
          </label>
          <span className="text-[11px] text-slate-500">
            يدعم صيغ: <code className="text-slate-400 font-mono">KEY=VALUE</code>, <code className="text-slate-400 font-mono">KEY: VALUE</code>, <code className="text-slate-400 font-mono">JSON</code>
          </span>
        </div>

        <div className="relative">
          <textarea
            rows={7}
            placeholder={`مثال لصق مباشر:
BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ
S3_ENDPOINT_URL=https://34dad04466d97745f2c9f8214c81c0f2.r2.cloudflarestorage.com
S3_BUCKET=smart-creators-media-p0
S3_ACCESS_KEY_ID=7ebb24025...
S3_SECRET_ACCESS_KEY=44f3cf60...
REDIS_URL=redis://red-da07qalg1s2s73chbdd0:6379
REPLICATE_API_TOKEN=r8_...
MAX_CONCURRENT_DOWNLOADS=2`}
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl p-3.5 text-xs text-slate-200 font-mono focus:outline-none leading-relaxed transition-all shadow-inner"
          />
        </div>
      </div>

      {/* Live Parsed Preview & Categories */}
      {parsedResult.entries.length > 0 && (
        <div className="space-y-4 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-emerald-400" />
              <h4 className="text-xs font-bold text-white">المفاتيح المكتشفة والمرتبة تلقائياً:</h4>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                {parsedResult.validCount} مفتاح معتمد
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowSecrets(!showSecrets)}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 px-2 py-1 rounded bg-slate-800 border border-slate-700 transition-colors"
              >
                {showSecrets ? <EyeOff className="w-3 h-3 text-amber-400" /> : <Eye className="w-3 h-3 text-slate-400" />}
                <span>{showSecrets ? 'إخفاء الرموز السرية' : 'إظهار الرموز السرية'}</span>
              </button>

              <button
                type="button"
                onClick={handleCopyOrganizedEnv}
                className="flex items-center gap-1 text-[11px] text-indigo-300 hover:text-indigo-200 px-2.5 py-1 rounded bg-indigo-950/80 border border-indigo-800 transition-colors"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'تم النسخ!' : 'نسخ كـ .env مرتب'}</span>
              </button>
            </div>
          </div>

          {/* Grouped Category Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
            {Object.entries(groupedEntries).map(([catTitle, entries]) => (
              <div
                key={catTitle}
                className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-3.5 space-y-2 shadow-sm"
              >
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-800 text-xs font-bold text-slate-200">
                  <span>{catTitle}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                    {entries.length}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {entries.map((entry, idx) => {
                    const displayVal =
                      entry.isSecret && !showSecrets
                        ? '••••••••••••••••'
                        : typeof entry.value === 'boolean'
                        ? String(entry.value)
                        : String(entry.value);

                    return (
                      <div
                        key={idx}
                        className={`p-2 rounded-lg text-xs flex items-center justify-between gap-2 border font-mono ${
                          entry.isValid
                            ? 'bg-slate-900 border-slate-800/80'
                            : 'bg-rose-950/30 border-rose-900/50 text-rose-300'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-indigo-300 text-[11px] truncate">
                              {entry.mappedKey || entry.key}
                            </span>
                            {entry.mappedKey && entry.mappedKey !== entry.key && (
                              <span className="text-[9px] text-slate-500">
                                (من {entry.key})
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate mt-0.5">
                            {displayVal}
                          </div>
                        </div>

                        {entry.isValid ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        ) : (
                          <span title="مفتاح غير قياسي">
                            <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-800">
        <div className="text-xs text-slate-400 text-center sm:text-right">
          {parsedResult.validCount > 0 ? (
            <span className="text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>جاهز للتطبيق: تم التعرف على {parsedResult.validCount} متغيراً بنجاح.</span>
            </span>
          ) : (
            <span>الصق المفاتيح أعلاه لتفعيل زر التطبيق التلقائي.</span>
          )}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
            >
              إلغاء
            </button>
          )}

          <button
            type="button"
            onClick={() => handleApplyForm(false)}
            disabled={parsedResult.validCount === 0}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition-all disabled:opacity-40"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>توزيع على الحقول</span>
          </button>

          <button
            type="button"
            onClick={() => handleApplyForm(true)}
            disabled={parsedResult.validCount === 0}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/30 transition-all disabled:opacity-40"
          >
            <Check className="w-3.5 h-3.5" />
            <span>تطبيق وحفظ فوري 🚀</span>
          </button>
        </div>
      </div>
    </div>
  );
};
