import React, { useState, useMemo } from 'react';
import {
  X,
  Users,
  Search,
  Radio,
  Terminal,
  ShieldCheck,
  Zap,
  CheckCircle2,
  AlertCircle,
  Download,
  Key,
  Layers,
  Sparkles,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from 'lucide-react';
import { engine } from '../services/engineService';
import { useToast } from '../context/ToastContext';

interface TelethonScraperModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToUsers?: () => void;
  initialTarget?: string;
}

export const TelethonScraperModal: React.FC<TelethonScraperModalProps> = ({
  isOpen,
  onClose,
  onNavigateToUsers,
  initialTarget = '',
}) => {
  const toast = useToast();
  const [target, setTarget] = useState(initialTarget || 'https://t.me/IT_comment1');
  const [limit, setLimit] = useState<number>(100);
  const [mode, setMode] = useState<'auto' | 'telethon_mtproto' | 'deep_web_bot'>('auto');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [sessionString, setSessionString] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [result, setResult] = useState<{
    channel?: any;
    members?: any[];
    saved_to_db?: number;
    mode_used?: string;
  } | null>(null);

  // Filter members by Username, ID, Name, Role
  const filteredMembers = useMemo(() => {
    if (!result?.members) return [];
    if (!memberSearchQuery.trim()) return result.members;

    const q = memberSearchQuery.trim().toLowerCase().replace(/^@/, '');
    return result.members.filter((m) => {
      const username = (m.username || '').toLowerCase();
      const id = String(m.id || '').toLowerCase();
      const firstName = (m.first_name || '').toLowerCase();
      const lastName = (m.last_name || '').toLowerCase();
      const role = (m.role || '').toLowerCase();
      const note = (m.activity_note || '').toLowerCase();

      return (
        username.includes(q) ||
        id.includes(q) ||
        firstName.includes(q) ||
        lastName.includes(q) ||
        role.includes(q) ||
        note.includes(q)
      );
    });
  }, [result?.members, memberSearchQuery]);

  if (!isOpen) return null;

  const quickPresets = [
    { label: 'قناة المناقشات', target: 'https://t.me/IT_comment1', tag: 'Supergroup' },
    { label: 'قناة تقنية المعلومات', target: 'https://t.me/UMS_IT2022', tag: 'Channel' },
    { label: 'حساب المطور @AlialFaqeh', target: '@AlialFaqeh', tag: 'User/Admin' },
    { label: 'قناة الملخصات', target: 'https://t.me/student_it2', tag: 'Channel' },
  ];

  const handleStartScraping = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!target.trim()) {
      toast.error('يرجى إدخال رابط أو معرف القناة المراد سحب أعضائها');
      return;
    }

    setIsLoading(true);
    setResult(null);
    setLogs([`🚀 بدء الاتصال وسحب الأعضاء من ${target.trim()}...`]);

    try {
      const res = await engine.scrapeChannelMembersWithTelethon({
        target: target.trim(),
        limit: Number(limit) || 100,
        mode,
        apiId: apiId ? Number(apiId) : undefined,
        apiHash: apiHash.trim() || undefined,
        sessionString: sessionString.trim() || undefined,
      });

      if (res.ok) {
        setResult(res);
        if (res.logs) setLogs(res.logs);
        toast.success(
          'اكتمل السحب بنجاح! 🎉',
          res.message || `تم سحب ${res.members?.length || 0} عضو وتخزينهم في قاعدة بيانات المستخدمين النشطة.`
        );
      } else {
        if (res.logs) setLogs(res.logs);
        toast.error('تعذر سحب أعضاء القناة', res.error || 'تأكد من صحة الرابط وأن القناة عامة');
      }
    } catch (err: any) {
      toast.error('خطأ غير متوقع', err?.message || 'فشل الاتصال بخدمة Telethon');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportCSV = () => {
    if (!result?.members || result.members.length === 0) {
      toast.info('لا توجد بيانات لتصديرها');
      return;
    }

    const headers = ['ID', 'First Name', 'Last Name', 'Username', 'Role', 'Source Channel', 'Notes', 'Discovered At'];
    const rows = result.members.map((m) => [
      m.id,
      `"${m.first_name || ''}"`,
      `"${m.last_name || ''}"`,
      m.username ? `@${m.username}` : '',
      m.role || 'Member',
      `"${m.source_channel || result.channel?.title || target}"`,
      `"${m.activity_note || ''}"`,
      m.discovered_at || new Date().toISOString(),
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const a = document.createElement('a');
    a.setAttribute('href', encodeURI(csvContent));
    a.setAttribute('download', `telethon_members_${Date.now()}.csv`);
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success('تم تصدير الأعضاء كملف CSV بنجاح');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-purple-500/40 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl my-auto text-right">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-900/60 via-indigo-900/50 to-slate-900 px-5 py-4 border-b border-purple-500/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-600/30 border border-purple-500/50 flex items-center justify-center text-purple-300 shadow-md">
              <Zap className="w-5 h-5 text-yellow-300 fill-yellow-300/30" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-white text-base sm:text-lg">سحب أعضاء القناة (Telethon MTProto)</h3>
                <span className="bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  Telethon v2.4
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                استخراج وحفظ أعضاء ومسؤولي قنوات ومجموعات تيليجرام مباشرة في قاعدة البيانات المحلية
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Channel URL Input */}
          <form onSubmit={handleStartScraping} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                رابط أو معرّف القناة / المجموعة المستهدفة:
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="https://t.me/IT_comment1 أو @UMS_IT2022 أو @AlialFaqeh"
                  className="w-full bg-slate-950 border border-purple-500/40 rounded-xl py-2.5 pl-3 pr-10 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400"
                  dir="ltr"
                  disabled={isLoading}
                />
                <Radio className="w-4 h-4 text-purple-400 absolute right-3.5 top-3 pointer-events-none" />
              </div>
            </div>

            {/* Quick preset links */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-slate-400">روابط سريعة للتجربة:</span>
              {quickPresets.map((p) => (
                <button
                  key={p.target}
                  type="button"
                  onClick={() => setTarget(p.target)}
                  className={`text-[11px] px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                    target === p.target
                      ? 'bg-purple-600/30 border-purple-400 text-purple-200 font-bold'
                      : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Settings & Limit */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  الحد الأقصى لعدد الأعضاء المطلوب جلبهم:
                </label>
                <select
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  disabled={isLoading}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-purple-500 cursor-pointer"
                >
                  <option value={50}>50 عضو (فحص سريع)</option>
                  <option value={100}>100 عضو (الافتراضي المتوازن)</option>
                  <option value={250}>250 عضو</option>
                  <option value={500}>500 عضو</option>
                  <option value={1000}>1000 عضو (سحب عميق)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  نمط المحرك والاتصال:
                </label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as any)}
                  disabled={isLoading}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-purple-500 cursor-pointer"
                >
                  <option value="auto">⚡ الوضع الذكي التلقائي (Zero-Config Deep Scraper)</option>
                  <option value="telethon_mtproto">🔌 بروتوكول Telethon MTProto المباشر</option>
                  <option value="deep_web_bot">🌐 محرك Telegram Bot & Web Open Engine</option>
                </select>
              </div>
            </div>

            {/* Advanced Telethon MTProto Credentials Toggle */}
            <div className="border-t border-slate-800/80 pt-2">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center justify-between w-full text-xs text-purple-400 hover:text-purple-300 transition-colors py-1 cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5" />
                  <span>إعدادات Telethon MTProto المتقدمة (API_ID / Hash / StringSession)</span>
                </span>
                {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showAdvanced && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-2.5 p-3 rounded-xl bg-slate-950/70 border border-purple-500/20 text-xs">
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">API ID:</label>
                    <input
                      type="text"
                      value={apiId}
                      onChange={(e) => setApiId(e.target.value)}
                      placeholder="e.g. 1234567"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-1.5 text-xs text-white font-mono"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">API HASH:</label>
                    <input
                      type="text"
                      value={apiHash}
                      onChange={(e) => setApiHash(e.target.value)}
                      placeholder="e.g. abcd1234efgh5678"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-1.5 text-xs text-white font-mono"
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Session String:</label>
                    <input
                      type="text"
                      value={sessionString}
                      onChange={(e) => setSessionString(e.target.value)}
                      placeholder="1BVts..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-1.5 text-xs text-white font-mono"
                      dir="ltr"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="pt-2 flex items-center gap-2">
              <button
                type="submit"
                disabled={isLoading || !target.trim()}
                className="flex-1 bg-gradient-to-r from-purple-600 via-indigo-600 to-sky-600 hover:from-purple-500 hover:to-sky-500 disabled:opacity-50 text-white font-bold py-2.5 px-4 rounded-xl shadow-lg shadow-purple-600/30 flex items-center justify-center gap-2 text-xs sm:text-sm transition-all cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-white" />
                    <span>جاري الاتصال وسحب الأعضاء...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 text-yellow-300 fill-yellow-300" />
                    <span>جلب الأعضاء (Telethon) وتحديث قاعدة البيانات</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Terminal Logs Window */}
          {logs.length > 0 && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono">
              <div className="flex items-center justify-between text-slate-400 border-b border-slate-800 pb-1.5 mb-2">
                <span className="flex items-center gap-1.5 text-[11px] text-purple-300 font-bold">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>سجل التنفيذ المباشر (Live Scraper Logs)</span>
                </span>
                <span className="text-[10px] text-slate-500">{logs.length} أحداث</span>
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto text-[11px] text-slate-300">
                {logs.map((log, idx) => (
                  <div key={idx} className="flex items-start gap-1.5">
                    <span className="text-purple-400 select-none">&gt;</span>
                    <span className="text-slate-200">{log}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Result Overview & Scraped Members Table */}
          {result && (
            <div className="space-y-3 pt-2">
              {/* Channel Stats Card */}
              {result.channel && (
                <div className="bg-slate-950/80 border border-purple-500/30 rounded-xl p-3.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-white text-sm">{result.channel.title}</span>
                        {result.channel.username && (
                          <span className="text-xs text-purple-300 font-mono">@{result.channel.username}</span>
                        )}
                        <span className="bg-purple-950 text-purple-300 border border-purple-700/50 text-[10px] px-1.5 py-0.5 rounded">
                          {result.channel.type}
                        </span>
                      </div>
                      {result.channel.description && (
                        <p className="text-xs text-slate-400 mt-1 whitespace-pre-line line-clamp-2">
                          {result.channel.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="bg-purple-950/60 border border-purple-500/40 px-3 py-1.5 rounded-lg text-center">
                        <div className="text-[10px] text-purple-300 font-semibold">المحفوظين بالقاعدة</div>
                        <div className="text-base font-extrabold text-white font-mono">
                          {result.members?.length || 0}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Members Table with Search Bar */}
              {result.members && result.members.length > 0 && (
                <div className="space-y-2.5">
                  {/* Top Bar: Title, Count, Actions */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                      <Users className="w-3.5 h-3.5 text-purple-400" />
                      <span>قائمة الأعضاء المستخرجين</span>
                      <span className="bg-purple-950 text-purple-300 border border-purple-800 text-[10px] px-2 py-0.5 rounded-full font-mono">
                        {memberSearchQuery ? `${filteredMembers.length} / ${result.members.length}` : result.members.length}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleExportCSV}
                        className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-2.5 py-1 rounded-lg border border-slate-700 transition-colors cursor-pointer"
                        title="تصدير جميع الأعضاء كملف CSV"
                      >
                        <Download className="w-3 h-3 text-emerald-400" />
                        <span>تصدير CSV</span>
                      </button>
                      {onNavigateToUsers && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onNavigateToUsers();
                          }}
                          className="flex items-center gap-1 bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 text-xs px-2.5 py-1 rounded-lg border border-purple-500/40 transition-colors cursor-pointer"
                        >
                          <Users className="w-3 h-3 text-purple-300" />
                          <span>عرض في جدول المستخدمين</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Member Search Bar (Telegram Username / ID / Name) */}
                  <div className="relative">
                    <input
                      type="text"
                      value={memberSearchQuery}
                      onChange={(e) => setMemberSearchQuery(e.target.value)}
                      placeholder="بحث في الأعضاء باسم المستخدم (@username)، معرّف Telegram ID، أو الاسم..."
                      className="w-full bg-slate-950/90 border border-slate-800 hover:border-purple-500/40 focus:border-purple-400 focus:ring-1 focus:ring-purple-400/50 rounded-xl py-2 pl-9 pr-9 text-xs text-white placeholder-slate-500 transition-all outline-none"
                    />
                    <Search className="w-3.5 h-3.5 text-purple-400 absolute right-3 top-2.5 pointer-events-none" />
                    {memberSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setMemberSearchQuery('')}
                        className="absolute left-2.5 top-2 p-0.5 text-slate-400 hover:text-white rounded-md transition-colors cursor-pointer"
                        title="مسح البحث"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Scraped Members Table */}
                  <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden max-h-56 overflow-y-auto">
                    {filteredMembers.length === 0 ? (
                      <div className="py-8 text-center text-slate-400 space-y-1">
                        <Search className="w-6 h-6 text-slate-600 mx-auto mb-1.5" />
                        <p className="text-xs font-semibold text-slate-300">لم يتم العثور على أعضاء مطابقين للبحث</p>
                        <p className="text-[11px] text-slate-500">جرب البحث بمعرّف مختلف أو امسح شريط البحث</p>
                      </div>
                    ) : (
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 sticky top-0 z-10 backdrop-blur-sm">
                          <tr>
                            <th className="py-2 px-3">المستخدم</th>
                            <th className="py-2 px-3">المعرف (Username / Telegram ID)</th>
                            <th className="py-2 px-3">الرتبة / الدور</th>
                            <th className="py-2 px-3">ملاحظة النشاط</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {filteredMembers.map((m, idx) => (
                            <tr key={idx} className="hover:bg-purple-950/20 transition-colors">
                              <td className="py-2 px-3 font-semibold text-white">
                                <div className="flex items-center gap-1.5">
                                  <div className="w-5 h-5 rounded-full bg-purple-900/50 border border-purple-700/50 flex items-center justify-center text-[10px] text-purple-300 shrink-0">
                                    {(m.first_name || m.username || 'U')[0]?.toUpperCase()}
                                  </div>
                                  <span className="truncate max-w-[140px]">{m.first_name || m.username || m.id}</span>
                                </div>
                              </td>
                              <td className="py-2 px-3 font-mono text-slate-300 text-[11px]" dir="ltr">
                                <div className="flex flex-col">
                                  {m.username ? (
                                    <span className="text-purple-300 font-semibold">@{m.username}</span>
                                  ) : null}
                                  <span className="text-slate-500 text-[10px]">ID: {m.id}</span>
                                </div>
                              </td>
                              <td className="py-2 px-3">
                                <span
                                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap ${
                                    m.role === 'Creator'
                                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                      : m.role === 'Admin'
                                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                                      : m.role === 'Active Commenter'
                                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                                      : 'bg-slate-800 text-slate-300'
                                  }`}
                                >
                                  {m.role === 'Creator'
                                    ? '👑 منشئ'
                                    : m.role === 'Admin'
                                    ? '🛡️ مسؤول'
                                    : m.role === 'Active Commenter'
                                    ? '💬 متفاعل'
                                    : '👤 عضو'}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-slate-400 text-[11px] truncate max-w-[180px]">
                                {m.activity_note || m.source_channel || '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-950/90 border-t border-slate-800 px-5 py-3 flex items-center justify-between">
          <span className="text-xs text-slate-400">
            يتم تخزين جميع البيانات فوراً في قاعدة بيانات المستخدمين النشطة.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
          >
            إغلاق النافذة
          </button>
        </div>
      </div>
    </div>
  );
};
