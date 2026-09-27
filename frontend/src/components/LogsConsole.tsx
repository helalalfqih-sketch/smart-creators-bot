import React, { useEffect, useRef, useState } from 'react';
import {
  Terminal,
  Trash2,
  Pause,
  Play,
  Download,
  Search,
  CheckCircle2,
  Copy,
} from 'lucide-react';
import { LogEntry } from '../types';
import { useToast } from '../context/ToastContext';

interface LogsConsoleProps {
  logs: LogEntry[];
  onClear: () => void;
}

/**
 * Read-only production flow console.
 *
 * This component never calls Telegram getUpdates/getMe and never mutates bot
 * commands or webhook state. Telegram ingestion belongs exclusively to the
 * production server poller; the dashboard only renders server-side flow logs.
 */
export const LogsConsole: React.FC<LogsConsoleProps> = ({ logs, onClear }) => {
  const toast = useToast();
  const [filterLevel, setFilterLevel] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
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

  const handleExport = () => {
    const text = filteredLogs
      .map((log) => `[${log.timestamp}] [${log.level}] [${log.source}]: ${log.message}`)
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
    void navigator.clipboard.writeText(`[${log.timestamp}] [${log.level}] [${log.source}]: ${log.message}`);
    setCopiedId(log.id);
    toast.info('تم نسخ السطر 📋');
    window.setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyAllLogs = () => {
    if (filteredLogs.length === 0) {
      toast.warning('لا توجد سجلات لنسخها');
      return;
    }
    const text = filteredLogs
      .map((log) => `[${log.timestamp}] [${log.level}] [${log.source}]: ${log.message}`)
      .join('\n');
    void navigator.clipboard.writeText(text);
    setCopiedAll(true);
    toast.success(
      'تم نسخ كافة السجلات بنجاح! 📋',
      `تم نسخ ${filteredLogs.length} سطر من سجلات العمليات إلى الحافظة.`
    );
    window.setTimeout(() => setCopiedAll(false), 2500);
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-lg flex flex-col h-[680px]">
      <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-bold text-slate-200">سجل تدفقات الإنتاج المباشر</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono font-bold">
            {filteredLogs.length} سجل
          </span>
        </div>

        <div className="flex items-center flex-wrap gap-2 text-xs">
          <button
            type="button"
            onClick={handleCopyAllLogs}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium transition-all shadow-xs ${
              copiedAll
                ? 'bg-emerald-950 text-emerald-300 border-emerald-500 shadow-emerald-950'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500 hover:border-indigo-400 shadow-indigo-950'
            }`}
            title="نسخ جميع السجلات المعروضة"
          >
            {copiedAll ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-bold">تم النسخ</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span className="font-bold">نسخ كل السجلات</span>
              </>
            )}
          </button>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-2" />
            <input
              type="text"
              placeholder="تصفية السجلات..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg pr-8 pl-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-36 sm:w-44"
            />
          </div>

          <select
            value={filterLevel}
            onChange={(event) => setFilterLevel(event.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="ALL">الكل</option>
            <option value="INFO">INFO فقط</option>
            <option value="WARN">WARN فقط</option>
            <option value="ERROR">ERROR فقط</option>
            <option value="DEBUG">DEBUG فقط</option>
          </select>

          <button
            type="button"
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
            type="button"
            onClick={handleExport}
            className="p-1.5 rounded-lg bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-700 transition-colors"
            title="تصدير السجل الكامل"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onClear}
            className="p-1.5 rounded-lg bg-slate-900 text-rose-400 hover:bg-slate-800 border border-slate-700 transition-colors"
            title="مسح سجل العرض"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 bg-slate-950 p-4 font-mono text-xs overflow-y-auto space-y-1.5 text-left ltr select-text">
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-600 text-center space-y-2">
            <Terminal className="w-8 h-8 text-slate-700" />
            <p className="text-sm font-medium text-slate-500">لا توجد سجلات تطابق الفلتر الحالي.</p>
            <p className="text-xs text-slate-600">أرسل رابطًا للبوت وستظهر تدفقات الإنتاج هنا تلقائيًا.</p>
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
                className={`px-1.5 py-0.2 text-[10px] rounded font-bold border shrink-0 ${getLevelBadge(log.level)}`}
              >
                {log.level}
              </span>

              <span className="text-indigo-400 text-[11px] shrink-0 font-medium">[{log.source}]</span>
              <span className="text-slate-200 break-all group-hover:text-white flex-1">{log.message}</span>

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
