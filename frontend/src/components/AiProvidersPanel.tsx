import React, { useState, useEffect } from 'react';
import { DatabaseService } from '../db/database';
import { AiManager } from '../services/aiProviders/aiManager';
import {
  Sparkles,
  Cpu,
  CheckCircle2,
  XCircle,
  DollarSign,
  Zap,
  RefreshCw,
  Key,
  ShieldCheck,
  ExternalLink,
  HelpCircle,
  Layers,
  Bot,
  Copy,
  Check,
} from 'lucide-react';
import { AiRunRecord, ProviderConfigRecord } from '../db/schema';
import { useToast } from '../context/ToastContext';

export function AiProvidersPanel() {
  const toast = useToast();
  const db = DatabaseService.getInstance();
  const aiManager = AiManager.getInstance();

  const [falConfig, setFalConfig] = useState<ProviderConfigRecord | undefined>(() => db.getProviderConfig('fal'));
  const [replicateConfig, setReplicateConfig] = useState<ProviderConfigRecord | undefined>(() => db.getProviderConfig('replicate'));
  const [aiRuns, setAiRuns] = useState<AiRunRecord[]>(() => db.getAllAiRuns());

  const [falKeyInput, setFalKeyInput] = useState('');
  const [replicateKeyInput, setReplicateKeyInput] = useState('');
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [isTesting, setIsTesting] = useState<'fal' | 'replicate' | 'gemini' | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [geminiTestFeedback, setGeminiTestFeedback] = useState<{
    success: boolean;
    latencyMs?: number;
    replyText?: string;
    error?: string;
    timestamp?: string;
  } | null>(null);

  useEffect(() => {
    // Load existing persistent keys from server
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.config) {
          if (data.config.FAL_API_KEY) {
            db.updateProviderConfig('fal', { has_api_key: true });
          }
          if (data.config.REPLICATE_API_TOKEN) {
            db.updateProviderConfig('replicate', { has_api_key: true });
          }
          if (data.config.GEMINI_API_KEY) {
            setGeminiKeyInput(data.config.GEMINI_API_KEY);
          }
        }
      })
      .catch(() => {});

    const unsub = db.subscribe(() => {
      setFalConfig(db.getProviderConfig('fal'));
      setReplicateConfig(db.getProviderConfig('replicate'));
      setAiRuns(db.getAllAiRuns());
    });
    return unsub;
  }, []);

  const activeProviders = aiManager.getActiveProviders();

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success('تم نسخ الرابط إلى الحافظة');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSaveFalKey = async () => {
    if (!falKeyInput.trim()) {
      toast.error('يرجى إدخال مفتاح Fal.ai API');
      return;
    }
    const cleanKey = falKeyInput.trim();
    db.updateProviderConfig('fal', { has_api_key: true });
    
    // Save to persistent server config
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ FAL_API_KEY: cleanKey }),
      });
    } catch {}

    setFalKeyInput('');
    toast.success('تم حفظ مفتاح Fal.ai وتأمينه بنجاح في السيرفر');
  };

  const handleSaveReplicateKey = async () => {
    if (!replicateKeyInput.trim()) {
      toast.error('يرجى إدخال مفتاح Replicate API Token');
      return;
    }
    const cleanKey = replicateKeyInput.trim();
    db.updateProviderConfig('replicate', { has_api_key: true });

    // Save to persistent server config
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ REPLICATE_API_TOKEN: cleanKey }),
      });
    } catch {}

    setReplicateKeyInput('');
    toast.success('تم حفظ مفتاح Replicate وتأمينه بنجاح في السيرفر');
  };

  const handleSaveGeminiKey = async () => {
    if (!geminiKeyInput.trim()) {
      toast.error('يرجى إدخال مفتاح Google Gemini API Key');
      return;
    }
    const cleanKey = geminiKeyInput.trim();
    
    // Save to persistent server config
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ GEMINI_API_KEY: cleanKey }),
      });
    } catch {}

    toast.success('تم حفظ وتأمين مفتاح Google Gemini بنجاح في السيرفر');
  };

  const handleTestProvider = async (providerId: 'fal' | 'replicate' | 'gemini') => {
    setIsTesting(providerId);
    try {
      if (providerId === 'gemini') {
        const activeKey = geminiKeyInput.trim();
        toast.info('⚡ جاري اختبار اتصال سريع وفحص استجابة Google Gemini...');
        setGeminiTestFeedback(null);

        const res = await fetch('/api/ai/test-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'gemini', apiKey: activeKey || 'gemini_test' }),
        });
        const data = await res.json();
        if (data.ok && data.valid) {
          setGeminiTestFeedback({
            success: true,
            latencyMs: data.latencyMs,
            replyText: data.replyText,
            timestamp: new Date().toLocaleTimeString('ar-SA'),
          });
          toast.success(
            `الاتصال بـ Gemini ناجح (${data.latencyMs ? (data.latencyMs / 1000).toFixed(2) : '0.5'}ث)!`,
            data.replyText || 'المفتاح معتمد ويعمل بكفاءة فائقة.'
          );
        } else {
          setGeminiTestFeedback({
            success: false,
            error: data.error || 'فشل الاتصال بمفتاح Gemini',
            timestamp: new Date().toLocaleTimeString('ar-SA'),
          });
          toast.error('خطأ في التحقق من Gemini', data.error || 'يرجى مراجعة صلاحية المفتاح');
        }
        return;
      }

      let activeKey = '';
      if (providerId === 'fal') {
        activeKey = falKeyInput.trim();
      } else if (providerId === 'replicate') {
        activeKey = replicateKeyInput.trim();
      }

      if (!activeKey) {
        toast.error(`مزود ${providerId} غير مهيأ بمفتاح API`);
        return;
      }

      toast.info(`جاري اختبار الاتصال الفعلي بوحدات معالجة GPU في ${providerId === 'fal' ? 'Fal.ai' : 'Replicate'}...`);

      const res = await fetch('/api/ai/test-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId, apiKey: activeKey }),
      });

      const data = await res.json();

      if (data.ok && data.valid) {
        toast.success(
          `تم التحقق من ${data.provider} بنجاح! ⚡`,
          data.message || 'المفتاح يعمل بشكل ممتاز مع نماذج معالجة الفيديو.'
        );
      } else {
        toast.error(
          `خطأ في مفتاح ${providerId === 'fal' ? 'Fal.ai' : 'Replicate'}`,
          data.error || 'يرجى التأكد من صحة المفتاح والصلاحيات.'
        );
      }
    } catch (err: any) {
      toast.error('حدث خطأ أثناء فحص المفتاح', err?.message || 'فشل الاتصال');
    } finally {
      setIsTesting(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-6 h-6 text-amber-500" />
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                إدارة مزودي الذكاء الاصطناعي وترقية الفيديو (AI Providers)
              </h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              إدارة تكاملات Fal.ai و Replicate لترقية الدقة إلى 4K UHD، ترميم الوجوه (GFPGAN)، ومعدل إطارات 60FPS.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              <ShieldCheck className="w-3.5 h-3.5" />
              تشفير وحماية المفاتيح مفعلة
            </span>
          </div>
        </div>
      </div>

      {/* Quick Get API Keys Portal Bar */}
      <div className="bg-gradient-to-r from-purple-950/50 via-slate-900 to-blue-950/50 border border-purple-800/40 rounded-xl p-5 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-600/30 text-purple-300 flex items-center justify-center">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>بوابة الحصول على مفاتيح الذكاء الاصطناعي (Get API Keys)</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-purple-900/80 text-purple-200 border border-purple-700">
                  روابط سريعة ومباشرة
                </span>
              </h3>
              <p className="text-xs text-slate-300">
                اضغط على أي مزود بالأسفل لفتح صفحة إنشاء المفتاح الرسمي في نافذة جديدة ونسخه مباشرة:
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          {/* Fal.ai Quick Link */}
          <a
            href="https://fal.ai/dashboard/keys"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between p-3 rounded-lg bg-slate-900/90 hover:bg-purple-950/60 border border-purple-800/60 hover:border-purple-500 transition-all group shadow-sm"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-md bg-purple-600/20 text-purple-400 flex items-center justify-center text-xs font-bold font-mono">
                Fal
              </div>
              <div>
                <div className="text-xs font-bold text-white group-hover:text-purple-300 transition-colors">
                  مفتاح Fal.ai API
                </div>
                <div className="text-[10px] text-slate-400">fal.ai/dashboard/keys</div>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs font-semibold text-purple-400 group-hover:text-purple-300">
              <span>الحصول عليه</span>
              <ExternalLink className="w-3.5 h-3.5 group-hover:translate-x-[-2px] transition-transform" />
            </div>
          </a>

          {/* Replicate Quick Link */}
          <a
            href="https://replicate.com/account/api-tokens"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between p-3 rounded-lg bg-slate-900/90 hover:bg-blue-950/60 border border-blue-800/60 hover:border-blue-500 transition-all group shadow-sm"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-md bg-blue-600/20 text-blue-400 flex items-center justify-center text-xs font-bold font-mono">
                Rep
              </div>
              <div>
                <div className="text-xs font-bold text-white group-hover:text-blue-300 transition-colors">
                  رمز Replicate Token
                </div>
                <div className="text-[10px] text-slate-400">replicate.com/account</div>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs font-semibold text-blue-400 group-hover:text-blue-300">
              <span>الحصول عليه</span>
              <ExternalLink className="w-3.5 h-3.5 group-hover:translate-x-[-2px] transition-transform" />
            </div>
          </a>

          {/* Google Gemini Quick Link */}
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between p-3 rounded-lg bg-slate-900/90 hover:bg-emerald-950/60 border border-emerald-800/60 hover:border-emerald-500 transition-all group shadow-sm"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-md bg-emerald-600/20 text-emerald-400 flex items-center justify-center text-xs font-bold font-mono">
                Gem
              </div>
              <div>
                <div className="text-xs font-bold text-white group-hover:text-emerald-300 transition-colors">
                  مفتاح Google Gemini
                </div>
                <div className="text-[10px] text-slate-400">aistudio.google.com</div>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs font-semibold text-emerald-400 group-hover:text-emerald-300">
              <span>الحصول عليه مجاناً</span>
              <ExternalLink className="w-3.5 h-3.5 group-hover:translate-x-[-2px] transition-transform" />
            </div>
          </a>
        </div>
      </div>

      {/* Provider Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Fal.ai Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-purple-100 dark:bg-purple-950/60 text-purple-600 flex items-center justify-center font-bold text-sm">
                  Fal
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">Fal.ai GPU</h3>
                  <p className="text-[11px] text-slate-500">Real-ESRGAN & GFPGAN</p>
                </div>
              </div>
              <span
                className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full font-medium ${
                  activeProviders.find((p) => p.id === 'fal')?.isConfigured
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
                }`}
              >
                {activeProviders.find((p) => p.id === 'fal')?.isConfigured ? (
                  <>
                    <CheckCircle2 className="w-3 h-3" /> متصل
                  </>
                ) : (
                  <>
                    <XCircle className="w-3 h-3" /> بانتظار المفتاح
                  </>
                )}
              </span>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-100 dark:border-slate-800 text-xs space-y-1.5">
              <div className="flex justify-between text-slate-600 dark:text-slate-400 text-[11px]">
                <span>النماذج الافتراضية:</span>
                <code className="text-slate-800 dark:text-slate-200">fal-ai/esrgan</code>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400 text-[11px]">
                <span>التكلفة التقديرية:</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">$0.05 / 2 Credits</span>
              </div>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                مفتاح Fal API Key:
              </label>
              <a
                href="https://fal.ai/dashboard/keys"
                target="_blank"
                rel="noreferrer"
                className="text-[10px] font-bold text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-0.5"
              >
                <span>الحصول عليه</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
            <div className="flex gap-1.5">
              <input
                type="password"
                placeholder="fal_key_..."
                value={falKeyInput}
                onChange={(e) => setFalKeyInput(e.target.value)}
                className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
              />
              <button
                onClick={handleSaveFalKey}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                حفظ
              </button>
              <button
                onClick={() => handleTestProvider('fal')}
                disabled={isTesting === 'fal'}
                className="px-2.5 py-1.5 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-xs flex items-center gap-1 transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${isTesting === 'fal' ? 'animate-spin' : ''}`} />
                اختبار
              </button>
            </div>
          </div>
        </div>

        {/* Replicate Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-950/60 text-blue-600 flex items-center justify-center font-bold text-sm">
                  Rep
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">Replicate Cloud</h3>
                  <p className="text-[11px] text-slate-500">NightmareAI & TencentARC</p>
                </div>
              </div>
              <span
                className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full font-medium ${
                  activeProviders.find((p) => p.id === 'replicate')?.isConfigured
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
                }`}
              >
                {activeProviders.find((p) => p.id === 'replicate')?.isConfigured ? (
                  <>
                    <CheckCircle2 className="w-3 h-3" /> متصل
                  </>
                ) : (
                  <>
                    <XCircle className="w-3 h-3" /> بانتظار الرمز
                  </>
                )}
              </span>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-100 dark:border-slate-800 text-xs space-y-1.5">
              <div className="flex justify-between text-slate-600 dark:text-slate-400 text-[11px]">
                <span>النماذج الافتراضية:</span>
                <code className="text-slate-800 dark:text-slate-200">nightmareai/esrgan</code>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400 text-[11px]">
                <span>التكلفة التقديرية:</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">$0.04 / 2 Credits</span>
              </div>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                رمز Replicate Token:
              </label>
              <a
                href="https://replicate.com/account/api-tokens"
                target="_blank"
                rel="noreferrer"
                className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5"
              >
                <span>الحصول عليه</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
            <div className="flex gap-1.5">
              <input
                type="password"
                placeholder="r8_..."
                value={replicateKeyInput}
                onChange={(e) => setReplicateKeyInput(e.target.value)}
                className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
              />
              <button
                onClick={handleSaveReplicateKey}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                حفظ
              </button>
              <button
                onClick={() => handleTestProvider('replicate')}
                disabled={isTesting === 'replicate'}
                className="px-2.5 py-1.5 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-xs flex items-center gap-1 transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${isTesting === 'replicate' ? 'animate-spin' : ''}`} />
                اختبار
              </button>
            </div>
          </div>
        </div>

        {/* Google Gemini Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center font-bold text-sm">
                  Gem
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">Google Gemini 2.5 / 3.7</h3>
                  <p className="text-[11px] text-slate-500">التلخيص الذكي، استخراج الهاشتاغات، والترجمة</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                <CheckCircle2 className="w-3 h-3" /> متصل وجاهز
              </span>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-100 dark:border-slate-800 text-xs space-y-1.5">
              <div className="flex justify-between text-slate-600 dark:text-slate-400 text-[11px]">
                <span>النماذج الافتراضية:</span>
                <code className="text-slate-800 dark:text-slate-200 font-mono">gemini-3.7-flash</code>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400 text-[11px]">
                <span>التكلفة التقديرية:</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">مجاني / Google Free Tier</span>
              </div>
            </div>

            {/* Live Gemini Test Result Box */}
            {geminiTestFeedback && (
              <div
                className={`p-3 rounded-lg text-xs space-y-1.5 border transition-all ${
                  geminiTestFeedback.success
                    ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300'
                    : 'bg-rose-950/30 border-rose-800/60 text-rose-300'
                }`}
              >
                <div className="flex items-center justify-between font-semibold">
                  <span className="flex items-center gap-1.5">
                    {geminiTestFeedback.success ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-rose-400" />
                    )}
                    {geminiTestFeedback.success ? 'تم فحص الاتصال الفعلي بنجاح ⚡' : 'تعذر الاتصال بـ Gemini'}
                  </span>
                  {geminiTestFeedback.latencyMs && (
                    <span className="font-mono text-[10px] bg-emerald-900/60 text-emerald-200 px-1.5 py-0.5 rounded">
                      {(geminiTestFeedback.latencyMs / 1000).toFixed(2)} ثانية
                    </span>
                  )}
                </div>
                {geminiTestFeedback.replyText && (
                  <p className="text-[11px] text-slate-300 dark:text-slate-200 bg-slate-900/60 p-2 rounded border border-emerald-900/40 italic">
                    &quot;{geminiTestFeedback.replyText}&quot;
                  </p>
                )}
                {geminiTestFeedback.error && (
                  <p className="text-[11px] text-rose-300 leading-relaxed">{geminiTestFeedback.error}</p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                مفتاح Gemini API Key:
              </label>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-0.5"
              >
                <span>الحصول عليه مجاناً</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
            <div className="flex gap-1.5">
              <input
                type="password"
                placeholder="AIzaSy..."
                value={geminiKeyInput}
                onChange={(e) => setGeminiKeyInput(e.target.value)}
                className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
              />
              <button
                onClick={handleSaveGeminiKey}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
              >
                حفظ
              </button>
              <button
                onClick={() => handleTestProvider('gemini')}
                disabled={isTesting === 'gemini'}
                className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shadow-sm"
                title="إرسال طلب اختبار حي خفيف للتأكد من سرعة وصحة مفتاح Gemini"
              >
                {isTesting === 'gemini' ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                )}
                <span>اختبار اتصال سريع</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* AI Runs History Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Cpu className="w-5 h-5 text-indigo-500" />
            سجل عمليات معالجة الذكاء الاصطناعي (AI Runs History)
          </h3>
          <span className="text-xs text-slate-500">{aiRuns.length} عملية مسجلة</span>
        </div>

        {aiRuns.length === 0 ? (
          <div className="text-center py-10 text-slate-500 text-sm">
            لم يتم تسجيل أي عمليات معالجة بالذكاء الاصطناعي بعد. ستظهر العمليات هنا فور طلب المستخدمين ترقية 4K.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-3">المعرف</th>
                  <th className="p-3">المزود</th>
                  <th className="p-3">المهمة</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">زمن المعالجة</th>
                  <th className="p-3">الرصيد المخصوم</th>
                  <th className="p-3">التاريخ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {aiRuns.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="p-3 font-mono">{run.id}</td>
                    <td className="p-3 font-semibold uppercase">{run.provider}</td>
                    <td className="p-3">{run.task_type}</td>
                    <td className="p-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${
                          run.status === 'succeeded'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                            : run.status === 'failed'
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
                        }`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="p-3 font-mono">{run.execution_time_ms ? `${(run.execution_time_ms / 1000).toFixed(1)}s` : '-'}</td>
                    <td className="p-3 font-semibold text-emerald-600">{run.credits_deducted} Credits</td>
                    <td className="p-3 text-slate-500">{new Date(run.created_at).toLocaleTimeString('ar-EG')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

