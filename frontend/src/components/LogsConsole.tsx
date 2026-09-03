import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  Trash2,
  Pause,
  Play,
  Download,
  Search,
  RefreshCw,
  Zap,
  Radio,
  Bot,
  Activity,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Copy,
} from 'lucide-react';
import { LogEntry } from '../types';
import { TelegramService } from '../services/telegramService';
import { engine } from '../services/engineService';
import { useToast } from '../context/ToastContext';

interface LogsConsoleProps {
  logs: LogEntry[];
  onClear: () => void;
}

export const LogsConsole: React.FC<LogsConsoleProps> = ({ logs, onClear }) => {
  const toast = useToast();
  const [filterLevel, setFilterLevel] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [pinging, setPinging] = useState<boolean>(false);
  const [fetchingUpdates, setFetchingUpdates] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState<boolean>(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const filteredLogs = logs.filter((item) => {
    const matchesLevel = filterLevel === 'ALL' || item.level === filterLevel;
    const matchesSearch =
      searchTerm === '' ||
      item.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.source.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesLevel && matchesSearch;
  });

  const getLevelBadge = (level: string) => {
    switch (level) {
      case 'ERROR':
        return 'text-rose-400 bg-rose-950/80 border-rose-800/80';
      case 'WARN':
        return 'text-amber-400 bg-amber-950/80 border-amber-800/80';
      case 'DEBUG':
        return 'text-cyan-400 bg-cyan-950/80 border-cyan-800/80';
      default:
        return 'text-emerald-400 bg-emerald-950/80 border-emerald-800/80';
    }
  };

  const handleLiveTelegramPing = async () => {
    const token = TelegramService.getSavedToken();
    if (!token) {
      engine.addLog('ERROR', '❌ لم يتم العثور على توكن البوت! يرجى إدخال التوكن في شاشة الإعدادات أولاً.', 'telegram_bot.py');
      return;
    }

    setPinging(true);
    const startTime = performance.now();
    engine.addLog('INFO', `📡 [PING] إرسال طلب فحص حي إلى Telegram API (https://api.telegram.org/bot.../getMe)...`, 'telegram_bot.py');

    try {
      const res = await TelegramService.testToken(token);
      const duration = Math.round(performance.now() - startTime);

      if (res.ok && res.bot) {
        engine.addLog(
          'INFO',
          `✅ [200 OK - ${duration}ms] اتصال حقيقي وناجح بـ @${res.bot.username || res.bot.first_name} (ID: ${res.bot.id}, can_join_groups: ${res.bot.can_join_groups})`,
          'telegram_bot.py'
        );

        // Also check webhook status
        const wh = await TelegramService.getWebhookInfo(token);
        if (wh.ok && wh.info) {
          engine.addLog(
            'DEBUG',
            `ℹ️ [WebhookInfo] url="${wh.info.url || 'none (direct polling mode)'}", pending_updates=${wh.info.pending_update_count}`,
            'telegram_bot.py'
          );
        }
      } else {
        engine.addLog('ERROR', `❌ [Error - ${duration}ms] فشل الاتصال: ${res.error}`, 'telegram_bot.py');
      }
    } catch (err: any) {
      engine.addLog('ERROR', `❌ فشل الاتصال بخادم تيليجرام: ${err?.message || err}`, 'telegram_bot.py');
    } finally {
      setPinging(false);
    }
  };

  const handleFetchUpdatesLive = async () => {
    const token = TelegramService.getSavedToken();
    if (!token) {
      engine.addLog('ERROR', '❌ لم يتم العثور على توكن البوت في الإعدادات.', 'telegram_bot.py');
      return;
    }

    setFetchingUpdates(true);
    engine.addLog('INFO', '📥 [GetUpdates] طلب آخر الرسائل والتحديثات الحقيقية من تيليجرام...', 'telegram_bot.py');

    try {
      const res = await TelegramService.getUpdates(token, 10);
      if (res.ok && res.updates) {
        engine.addLog('INFO', `✅ تم استلام ${res.updates.length} تحديث/رسالة من خوادم تيليجرام`, 'telegram_bot.py');

        if (res.updates.length === 0) {
          engine.addLog('DEBUG', 'ℹ️ لا توجد رسائل معلقة حالياً في قائمة الانتظار على تيليجرام', 'telegram_bot.py');
        } else {
          for (const u of res.updates) {
            const msg = u.message || u.channel_post || u.edited_message;
            if (msg) {
              const urls = TelegramService.extractUrlsFromMessage(msg);
              const sender = msg.from?.username ? `@${msg.from.username}` : msg.from?.first_name || String(msg.chat.id);
              engine.addLog(
                'INFO',
                `📩 رسالة من ${sender} (ChatID: ${msg.chat.id}) | النص: "${msg.text || msg.caption || '[وسائط]'}" | روابط مستخرجة: [${urls.join(', ') || 'لا يوجد'}]`,
                'telegram_bot.py'
              );
            }
          }
        }
      } else {
        engine.addLog('ERROR', `❌ خطأ في جلب التحديثات: ${res.error}`, 'telegram_bot.py');
      }
    } catch (err: any) {
      engine.addLog('ERROR', `❌ خطأ في الاتصال: ${err?.message || err}`, 'telegram_bot.py');
    } finally {
      setFetchingUpdates(false);
    }
  };

  const handleExport = () => {
    const text = filteredLogs
      .map((l) => `[${l.timestamp}] [${l.level}] [${l.source}]: ${l.message}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `smart_creators_bot_logs_${new Date().toISOString().slice(0, 19)}.log`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyLog = (log: LogEntry) => {
    navigator.clipboard.writeText(`[${log.timestamp}] [${log.level}] [${log.source}]: ${log.message}`);
    setCopiedId(log.id);
    toast.info('تم نسخ السطر 📋');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyAllLogs = () => {
    if (filteredLogs.length === 0) {
      toast.warning('لا توجد سجلات لنسخها');
      return;
    }
    const text = filteredLogs
      .map((l) => `[${l.timestamp}] [${l.level}] [${l.source}]: ${l.message}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    toast.success(
      'تم نسخ كافة السجلات بنجاح! 📋',
      `تم نسخ ${filteredLogs.length} سطر من سجلات العمليات والـ API إلى الحافظة.`
    );
    setTimeout(() => setCopiedAll(false), 2500);
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-lg flex flex-col h-[680px]">
      {/* Console Top Toolbar */}
      <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-bold text-slate-200">سجل الأحداث والعمليات الحقيقية المباشر (Console Logs)</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono font-bold">
            {filteredLogs.length} سجل حقيقي
          </span>
        </div>

        {/* Live Actions & Real Telegram API Trigger Buttons */}
        <div className="flex items-center flex-wrap gap-2 text-xs">
          {/* Copy All Logs Button */}
          <button
            type="button"
            onClick={handleCopyAllLogs}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium transition-all shadow-xs ${
              copiedAll
                ? 'bg-emerald-950 text-emerald-300 border-emerald-500 shadow-emerald-950'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500 hover:border-indigo-400 shadow-indigo-950'
            }`}
            title="نسخ جميع السجلات المعروضة في الحافظة لإرسالها"
          >
            {copiedAll ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-bold">تم نسخ السجلات!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span className="font-bold">نسخ كل السجلات (Copy Logs)</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleLiveTelegramPing}
            disabled={pinging}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-950 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/80 transition-colors font-medium disabled:opacity-50"
            title="فحص مباشر وحقيقي للاتصال بخوادم Telegram Bot API"
          >
            <Radio className={`w-3.5 h-3.5 ${pinging ? 'animate-spin text-amber-400' : 'text-indigo-400'}`} />
            <span>{pinging ? 'جارٍ الفحص...' : 'فحص الاتصال الحي (Ping)'}</span>
          </button>

          <button
            type="button"
            onClick={handleFetchUpdatesLive}
            disabled={fetchingUpdates}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors font-medium disabled:opacity-50"
            title="طلب آخر الرسائل والتحديثات الواردة من المستخدمين في تيليجرام"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${fetchingUpdates ? 'animate-spin' : ''}`} />
            <span>{fetchingUpdates ? 'جارٍ الجلب...' : 'جلب رسائل تيليجرام'}</span>
          </button>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-2" />
            <input
              type="text"
              placeholder="تصفية السجلات..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg pr-8 pl-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-36 sm:w-44"
            />
          </div>

          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="ALL">الكل (All Levels)</option>
            <option value="INFO">INFO فقط</option>
            <option value="WARN">WARN فقط</option>
            <option value="ERROR">ERROR فقط</option>
            <option value="DEBUG">DEBUG فقط</option>
          </select>

          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 transition-colors ${
              autoScroll
                ? 'bg-indigo-950 text-indigo-300 border-indigo-800'
                : 'bg-slate-900 text-slate-400 border-slate-700'
            }`}
            title={autoScroll ? 'إيقاف التمرير التلقائي' : 'تفعيل التمرير التلقائي'}
          >
            {autoScroll ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={handleExport}
            className="p-1.5 rounded-lg bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-700 transition-colors"
            title="تصدير السجل الكامل (.log)"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onClear}
            className="p-1.5 rounded-lg bg-slate-900 text-rose-400 hover:bg-slate-800 border border-slate-700 transition-colors"
            title="مسح سجل الأحداث"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Console Output Area */}
      <div className="flex-1 bg-slate-950 p-4 font-mono text-xs overflow-y-auto space-y-1.5 text-left ltr select-text">
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-600 text-center space-y-2">
            <Terminal className="w-8 h-8 text-slate-700" />
            <p className="text-sm font-medium text-slate-500">لا توجد سجلات تطابق الفلتر الحالي.</p>
            <p className="text-xs text-slate-600">
              اضغط على زر <strong>"فحص الاتصال الحي (Ping)"</strong> أو أرسل رسالة للبوت في تيليجرام لتسجيل الأحداث الحقيقية فوراً.
            </p>
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div
              key={log.id}
              className="flex items-start gap-2 py-1 hover:bg-slate-900/70 px-2 rounded group transition-colors border border-transparent hover:border-slate-800"
            >
              <span className="text-slate-500 shrink-0 text-[11px] font-mono">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>

              <span
                className={`px-1.5 py-0.2 text-[10px] rounded font-bold border shrink-0 ${getLevelBadge(
                  log.level
                )}`}
              >
                {log.level}
              </span>

              <span className="text-indigo-400 text-[11px] shrink-0 font-medium">
                [{log.source}]
              </span>

              <span className="text-slate-200 break-all group-hover:text-white flex-1">
                {log.message}
              </span>

              <button
                type="button"
                onClick={() => handleCopyLog(log)}
                className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-slate-300 transition-opacity"
                title="نسخ السطر"
              >
                {copiedId === log.id ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
