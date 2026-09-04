import React, { useState, useEffect } from 'react';
import {
  Users,
  UserCheck,
  UserX,
  Crown,
  Search,
  Filter,
  Send,
  Download,
  Plus,
  RefreshCw,
  MoreVertical,
  Shield,
  MessageSquare,
  Copy,
  Check,
  Trash2,
  Tv,
  Smartphone,
  Radio,
  ExternalLink,
  Sparkles,
  AlertCircle,
  Clock,
  Activity,
  Edit3,
  Zap,
  Database,
  Terminal,
  Key,
  Layers,
  Calendar,
} from 'lucide-react';
import { BotUser } from '../types';
import { engine } from '../services/engineService';
import { TelegramService } from '../services/telegramService';
import { useToast } from '../context/ToastContext';

interface UsersManagementProps {
  onRefresh?: () => void;
}

export const UsersManagement: React.FC<UsersManagementProps> = () => {
  const toast = useToast();
  const [users, setUsers] = useState<BotUser[]>(() => engine.getUsers());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'last_active' | 'downloads' | 'first_seen'>('last_active');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Modals state
  const [selectedUser, setSelectedUser] = useState<BotUser | null>(null);
  const [isMsgModalOpen, setIsMsgModalOpen] = useState(false);
  const [isBroadcastModalOpen, setIsBroadcastModalOpen] = useState(false);
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [isEditUserModalOpen, setIsEditUserModalOpen] = useState(false);
  const [isImportChatModalOpen, setIsImportChatModalOpen] = useState(false);
  const [isTelethonModalOpen, setIsTelethonModalOpen] = useState(false);

  // Telethon Member Scraper State
  const [telethonTarget, setTelethonTarget] = useState('https://t.me/IT_comment1');
  const [telethonMode, setTelethonMode] = useState<'auto' | 'telethon_mtproto' | 'deep_web_bot'>('auto');
  const [telethonLimit, setTelethonLimit] = useState(100);
  const [telethonApiId, setTelethonApiId] = useState('');
  const [telethonApiHash, setTelethonApiHash] = useState('');
  const [telethonSession, setTelethonSession] = useState('');
  const [showMtprotoCredentials, setShowMtprotoCredentials] = useState(false);
  const [isScrapingTelethon, setIsScrapingTelethon] = useState(false);
  const [telethonResult, setTelethonResult] = useState<any>(null);
  const [telethonLogs, setTelethonLogs] = useState<string[]>([]);

  // Import Channel State
  const [importChatInput, setImportChatInput] = useState('https://t.me/IT_comment1');
  const [isImportingChat, setIsImportingChat] = useState(false);
  const [importedChatResult, setImportedChatResult] = useState<any>(null);

  // Direct message state
  const [msgText, setMsgText] = useState('');
  const [isSendingMsg, setIsSendingMsg] = useState(false);

  // Broadcast state
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcastTarget, setBroadcastTarget] = useState<'all' | 'vip' | 'active'>('all');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastProgress, setBroadcastProgress] = useState<{ sent: number; total: number; failed: number } | null>(null);

  // New user form state
  const [newUserForm, setNewUserForm] = useState({
    chat_id: '',
    first_name: '',
    username: '',
    type: 'private' as const,
    status: 'active' as const,
    notes: '',
  });

  // Edit user state
  const [editUserForm, setEditUserForm] = useState<Partial<BotUser>>({});

  // Auto-Refresh State & Controls
  const [isAutoRefreshEnabled, setIsAutoRefreshEnabled] = useState(true);
  const [autoRefreshIntervalSec, setAutoRefreshIntervalSec] = useState(10);
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  useEffect(() => {
    const unsub = engine.onUsersChange((updated) => {
      setUsers(updated);
    });
    return () => unsub();
  }, []);

  // Periodic Background Auto-Refresh
  useEffect(() => {
    if (!isAutoRefreshEnabled) return;

    const timer = setInterval(() => {
      setIsAutoRefreshing(true);
      try {
        const latest = engine.getUsers();
        setUsers(latest);
        setLastRefreshedAt(new Date());
      } catch (err) {
        console.warn('Auto-refresh silent error:', err);
      } finally {
        setTimeout(() => {
          setIsAutoRefreshing(false);
        }, 750);
      }
    }, autoRefreshIntervalSec * 1000);

    return () => clearInterval(timer);
  }, [isAutoRefreshEnabled, autoRefreshIntervalSec]);

  const refreshUsers = () => {
    setIsAutoRefreshing(true);
    setUsers(engine.getUsers());
    setLastRefreshedAt(new Date());
    toast.success('تم تحديث قائمة المستخدمين');
    setTimeout(() => {
      setIsAutoRefreshing(false);
    }, 600);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    toast.info('تم نسخ المعرف إلى الحافظة');
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Toggle user status (VIP / Active / Blocked)
  const handleToggleStatus = (user: BotUser, newStatus: BotUser['status']) => {
    engine.updateUser(user.chat_id, { status: newStatus });
    toast.success(`تم تغيير حالة المستخدم إلى: ${getStatusLabel(newStatus)}`);
  };

  useEffect(() => {
    const unsub = engine.onUsersChange((updated) => {
      setUsers(updated);
    });
    return () => unsub();
  }, []);

  const handleDeleteUser = (user: BotUser) => {
    if (window.confirm(`هل أنت متأكد من حذف المستخدم (${user.first_name || user.chat_id})؟`)) {
      engine.deleteUser(user.chat_id);
      setUsers(engine.getUsers());
      onRefresh?.();
      toast.info('تم حذف المستخدم من السجل');
    }
  };

  // Send single message via Telegram API
  const handleSendDirectMessage = async () => {
    if (!selectedUser || !msgText.trim()) return;

    const token = TelegramService.getSavedToken() || engine.getSettings().BOT_TOKEN || '';

    setIsSendingMsg(true);
    try {
      const res = await TelegramService.sendMessage(token, selectedUser.chat_id, msgText);
      if (res.ok) {
        toast.success(`تم إرسال الرسالة بنجاح إلى ${selectedUser.first_name || selectedUser.chat_id}`);
        setMsgText('');
        setIsMsgModalOpen(false);
      } else {
        toast.error(`فشل الإرسال: ${res.error || 'تعذر الوصول للمستخدم'}`);
      }
    } catch (e: any) {
      toast.error(`خطأ أثناء الإرسال: ${e?.message || 'خطأ غير معروف'}`);
    } finally {
      setIsSendingMsg(false);
    }
  };

  // Broadcast message to all matching users
  const handleBroadcast = async () => {
    if (!broadcastText.trim()) return;

    const token = TelegramService.getSavedToken() || engine.getSettings().BOT_TOKEN || '';

    let targetUsers = users;
    if (broadcastTarget === 'vip') {
      targetUsers = users.filter((u) => u.status === 'vip');
    } else if (broadcastTarget === 'active') {
      targetUsers = users.filter((u) => u.status !== 'blocked');
    }

    if (targetUsers.length === 0) {
      toast.error('لا يوجد مستخدمين مطابقين لمعايير الإذاعة');
      return;
    }

    setIsBroadcasting(true);
    let sentCount = 0;
    let failedCount = 0;
    setBroadcastProgress({ sent: 0, total: targetUsers.length, failed: 0 });

    for (const u of targetUsers) {
      try {
        const res = await TelegramService.sendMessage(token, u.chat_id, broadcastText);
        if (res.ok) {
          sentCount++;
        } else {
          failedCount++;
        }
      } catch {
        failedCount++;
      }
      setBroadcastProgress({ sent: sentCount, total: targetUsers.length, failed: failedCount });
      // Small delay to respect Telegram flood limits
      await new Promise((r) => setTimeout(r, 150));
    }

    setIsBroadcasting(false);
    toast.success(`تمت الإذاعة بنجاح! أُرسلت لـ ${sentCount} مستخدم (فشل: ${failedCount})`);
    setBroadcastText('');
    setTimeout(() => {
      setIsBroadcastModalOpen(false);
      setBroadcastProgress(null);
    }, 2000);
  };

  // Add manual user
  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserForm.chat_id.trim()) {
      toast.error('يرجى إدخال معرف الدردشة (Chat ID)');
      return;
    }

    const created = engine.recordUserActivity(
      newUserForm.chat_id.trim(),
      {
        username: newUserForm.username ? newUserForm.username.replace('@', '') : undefined,
        first_name: newUserForm.first_name || 'مستخدم جديد',
        type: newUserForm.type,
      },
      'Manual',
      true
    );

    if (newUserForm.status !== 'active') {
      engine.updateUser(created.chat_id, { status: newUserForm.status, notes: newUserForm.notes });
    }

    toast.success('تمت إضافة المستخدم بنجاح');
    setIsAddUserModalOpen(false);
    setNewUserForm({
      chat_id: '',
      first_name: '',
      username: '',
      type: 'private',
      status: 'active',
      notes: '',
    });
  };

  // Import Telegram Channel / Supergroup
  const handleImportChat = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!importChatInput.trim()) {
      toast.error('يرجى كتابة رابط أو معرف القناة / المجموعة');
      return;
    }

    setIsImportingChat(true);
    setImportedChatResult(null);

    try {
      const res = await engine.importTelegramChat(importChatInput.trim());
      if (res.ok && res.chat) {
        setImportedChatResult(res.chat);
        setUsers(engine.getUsers());
        toast.success(res.message || 'تم جلب بيانات القناة بنجاح!');
      } else {
        toast.error(res.error || 'تعذر جلب بيانات القناة، تأكد من صحة الرابط');
      }
    } catch (err: any) {
      toast.error(err?.message || 'فشل الاتصال بخوادم تيليجرام');
    } finally {
      setIsImportingChat(false);
    }
  };

  // Run Telethon Scraper for Channel & Group Members
  const handleRunTelethonScraper = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!telethonTarget.trim()) {
      toast.error('يرجى إدخال رابط أو معرف القناة المراد سحب أعضائها');
      return;
    }

    setIsScrapingTelethon(true);
    setTelethonResult(null);
    setTelethonLogs([`🚀 بدء الاتصال وسحب الأعضاء من ${telethonTarget.trim()}...`]);

    try {
      const res = await engine.scrapeChannelMembersWithTelethon({
        target: telethonTarget.trim(),
        mode: telethonMode,
        limit: Number(telethonLimit) || 100,
        apiId: telethonApiId ? Number(telethonApiId) : undefined,
        apiHash: telethonApiHash.trim() || undefined,
        sessionString: telethonSession.trim() || undefined,
      });

      if (res.ok) {
        setTelethonResult(res);
        if (res.logs) {
          setTelethonLogs(res.logs);
        }
        setUsers(engine.getUsers());
        toast.success(res.message || `تم سحب ${res.members?.length || 0} عضو وتخزينهم في قاعدة البيانات بنجاح!`);
      } else {
        toast.error(res.error || 'تعذر سحب أعضاء القناة');
        if (res.logs) setTelethonLogs(res.logs);
      }
    } catch (err: any) {
      toast.error(err?.message || 'حدث خطأ غير متوقع أثناء الاتصال بـ Telethon');
    } finally {
      setIsScrapingTelethon(false);
    }
  };

  // Save edited user
  const handleSaveEditUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    engine.updateUser(selectedUser.chat_id, editUserForm);
    toast.success('تم حفظ التعديلات');
    setIsEditUserModalOpen(false);
  };

  // Export JSON / CSV
  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(users, null, 2));
    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', `smart_creators_users_${Date.now()}.json`);
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success('تم تصدير قاعدة بيانات المستخدمين (JSON)');
  };

  const handleExportCSV = () => {
    const headers = ['Chat ID', 'First Name', 'Username', 'Type', 'Status', 'Total Downloads', 'Success Downloads', 'First Seen', 'Last Active', 'Platforms'];
    const rows = users.map((u) => [
      u.chat_id,
      `"${u.first_name || ''}"`,
      u.username ? `@${u.username}` : '',
      u.type,
      u.status,
      u.total_downloads,
      u.successful_downloads,
      u.first_seen,
      u.last_active,
      `"${(u.platforms_used || []).join(', ')}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const a = document.createElement('a');
    a.setAttribute('href', encodeURI(csvContent));
    a.setAttribute('download', `smart_creators_users_${Date.now()}.csv`);
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success('تم تصدير بيانات المستخدمين (CSV)');
  };

  // Filtered and Sorted Users
  const filteredUsers = users
    .filter((u) => {
      const q = searchQuery.toLowerCase().trim();
      const matchQuery =
        !q ||
        String(u.chat_id).toLowerCase().includes(q) ||
        (u.first_name && u.first_name.toLowerCase().includes(q)) ||
        (u.username && u.username.toLowerCase().includes(q)) ||
        (u.title && u.title.toLowerCase().includes(q)) ||
        (u.notes && u.notes.toLowerCase().includes(q));

      const matchStatus = statusFilter === 'all' || u.status === statusFilter;
      const matchType = typeFilter === 'all' || u.type === typeFilter;

      return matchQuery && matchStatus && matchType;
    })
    .sort((a, b) => {
      if (sortBy === 'downloads') return b.total_downloads - a.total_downloads;
      if (sortBy === 'first_seen') return new Date(b.first_seen).getTime() - new Date(a.first_seen).getTime();
      return new Date(b.last_active).getTime() - new Date(a.last_active).getTime();
    });

  // Calculate quick stats
  const totalUsersCount = users.length;
  const activeUsersCount = users.filter((u) => u.status === 'active').length;
  const vipUsersCount = users.filter((u) => u.status === 'vip').length;
  const blockedUsersCount = users.filter((u) => u.status === 'blocked').length;
  const totalRequests = users.reduce((acc, u) => acc + (u.total_downloads || 0), 0);

  // Scraped & Channel specific members
  const scrapedAndImportedMembers = users.filter(
    (u) =>
      u.role ||
      (u.notes &&
        (u.notes.includes('مستخرج') ||
          u.notes.includes('Telethon') ||
          u.notes.includes('مشرف') ||
          u.notes.includes('منشئ') ||
          u.notes.includes('متفاعل') ||
          u.notes.includes('وصف'))) ||
      String(u.chat_id).startsWith('user_') ||
      String(u.chat_id).startsWith('author_') ||
      String(u.chat_id).startsWith('-')
  );
  const totalFetchedMembersCount = scrapedAndImportedMembers.length > 0 ? scrapedAndImportedMembers.length : totalUsersCount;
  const connectedChannelsCount = users.filter(
    (u) => u.type === 'channel' || u.type === 'group' || u.type === 'supergroup' || String(u.chat_id).startsWith('-')
  ).length;
  const totalAudienceReach = users.reduce((acc, u) => acc + (u.member_count || 0), 0);

  // Latest update date calculation
  const latestUpdateISO = users.reduce<string>((latest, u) => {
    const candidate = u.last_active || u.first_seen;
    if (!candidate) return latest;
    if (!latest) return candidate;
    return new Date(candidate).getTime() > new Date(latest).getTime() ? candidate : latest;
  }, '');

  const formatFullDate = (isoString?: string) => {
    if (!isoString) return 'الآن';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  const getStatusLabel = (status: BotUser['status']) => {
    switch (status) {
      case 'vip':
        return 'عضو مميز VIP';
      case 'blocked':
        return 'محظور Blocked';
      case 'admin':
        return 'مسؤول Admin';
      default:
        return 'نشط Active';
    }
  };

  const formatRelativeTime = (isoString?: string) => {
    if (!isoString) return 'غير محدد';
    try {
      const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
      if (diff < 60) return 'الآن';
      if (diff < 3600) return `منذ ${Math.floor(diff / 60)} دقيقة`;
      if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} ساعة`;
      return `منذ ${Math.floor(diff / 86400)} يوم`;
    } catch {
      return isoString;
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Top Header Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl relative overflow-hidden backdrop-blur-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1 sm:mb-2">
              <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0 shadow-inner">
                <Users className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight flex items-center gap-2 flex-wrap">
                  <span>لوحة مستخدمي البوت</span>
                  <span className="text-[11px] bg-indigo-950 text-indigo-300 border border-indigo-800/80 px-2 py-0.5 rounded-full font-semibold">
                    {totalUsersCount} مشترك
                  </span>
                </h1>
                <p className="text-xs text-slate-400 line-clamp-1 sm:line-clamp-none">
                  إدارة المشتركين، ترقية العضويات، إرسال إذاعات جماعية ورسائل عبر Telegram API
                </p>
              </div>
            </div>
          </div>

          {/* Quick Actions Responsive Grid */}
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full lg:w-auto">
            <button
              onClick={() => {
                setTelethonTarget('https://t.me/IT_comment1');
                setTelethonResult(null);
                setTelethonLogs([]);
                setIsTelethonModalOpen(true);
              }}
              className="col-span-2 sm:col-span-1 flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/25 transition-all cursor-pointer min-h-[40px] border border-purple-400/30"
            >
              <Zap className="w-3.5 h-3.5 text-yellow-300 fill-yellow-300/30" />
              <span>سحب أعضاء القناة (Telethon)</span>
            </button>

            <button
              onClick={() => {
                setImportChatInput('https://t.me/IT_comment1');
                setImportedChatResult(null);
                setIsImportChatModalOpen(true);
              }}
              className="col-span-2 sm:col-span-1 flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white text-xs font-semibold shadow-lg shadow-sky-600/20 transition-all cursor-pointer min-h-[40px]"
            >
              <Radio className="w-3.5 h-3.5 text-sky-200" />
              <span>جلب بيانات قناة</span>
            </button>

            <button
              onClick={() => setIsBroadcastModalOpen(true)}
              className="col-span-2 sm:col-span-1 flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold border border-slate-700 transition-all cursor-pointer min-h-[40px]"
            >
              <Send className="w-3.5 h-3.5 text-indigo-400" />
              <span>إذاعة جماعية</span>
            </button>

            <button
              onClick={() => setIsAddUserModalOpen(true)}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-all cursor-pointer min-h-[40px]"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-400" />
              <span>إضافة مستخدم</span>
            </button>

            <div className="flex items-center bg-slate-800 border border-slate-700 rounded-xl overflow-hidden min-h-[40px]">
              <button
                onClick={handleExportJSON}
                title="تصدير بصيغة JSON"
                className="flex-1 sm:flex-initial px-2.5 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors flex items-center justify-center gap-1"
              >
                <Download className="w-3.5 h-3.5 text-cyan-400" />
                <span>JSON</span>
              </button>
              <div className="w-[1px] h-4 bg-slate-700" />
              <button
                onClick={handleExportCSV}
                title="تصدير بصيغة CSV"
                className="flex-1 sm:flex-initial px-2.5 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors flex items-center justify-center gap-1"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span>CSV</span>
              </button>
            </div>

            {/* Auto-Refresh Toggle and Interval Selector */}
            <div className="flex items-center bg-slate-800 border border-slate-700 rounded-xl min-h-[40px] px-2 py-1 gap-1.5 shadow-sm">
              <button
                type="button"
                onClick={() => {
                  const nextState = !isAutoRefreshEnabled;
                  setIsAutoRefreshEnabled(nextState);
                  if (nextState) {
                    toast.success(`تم تفعيل التحديث التلقائي للجدول (كل ${autoRefreshIntervalSec} ثوانٍ)`);
                  } else {
                    toast.info('تم إيقاف التحديث التلقائي مؤقتاً');
                  }
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  isAutoRefreshEnabled
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                }`}
                title="تشغيل / إيقاف التحديث التلقائي الدوري لقائمة الأعضاء"
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isAutoRefreshEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                  }`}
                />
                <span className="text-[11px] sm:text-xs">تحديث تلقائي: {isAutoRefreshEnabled ? 'مفعل' : 'معطل'}</span>
              </button>

              {isAutoRefreshEnabled && (
                <select
                  value={autoRefreshIntervalSec}
                  onChange={(e) => {
                    const sec = Number(e.target.value);
                    setAutoRefreshIntervalSec(sec);
                    toast.info(`تم ضبط دورة التحديث التلقائي إلى: كل ${sec} ثوانٍ`);
                  }}
                  className="bg-slate-900 border border-slate-700 text-slate-200 text-[11px] rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-500 cursor-pointer font-mono"
                  title="تغيير فترة التحديث التلقائي"
                >
                  <option value={5}>5 ثوانٍ</option>
                  <option value={10}>10 ثوانٍ</option>
                  <option value={30}>30 ثانية</option>
                  <option value={60}>60 ثانية</option>
                </select>
              )}

              {/* Manual Refresh & Mini Spinner */}
              <button
                onClick={refreshUsers}
                disabled={isAutoRefreshing}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                title="تحديث يدوي فوري للبيانات"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isAutoRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
              </button>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3 mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-slate-800/80">
          <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 sm:p-3.5">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-[11px] sm:text-xs font-medium">إجمالي المستخدمين</span>
              <Users className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <div className="text-lg sm:text-xl font-bold text-white tracking-tight">{totalUsersCount}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">مسجلين في الذاكرة</div>
          </div>

          <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 sm:p-3.5">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-[11px] sm:text-xs font-medium">النشطين</span>
              <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-lg sm:text-xl font-bold text-emerald-400 tracking-tight">{activeUsersCount}</div>
            <div className="text-[10px] text-emerald-500/80 mt-0.5">حالة نشطة ومصرحة</div>
          </div>

          <div className="bg-slate-950/70 border border-amber-900/40 rounded-xl p-3 sm:p-3.5 shadow-sm shadow-amber-500/5">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-[11px] sm:text-xs font-medium text-amber-300">أعضاء VIP المميزين</span>
              <Crown className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-lg sm:text-xl font-bold text-amber-400 tracking-tight">{vipUsersCount}</div>
            <div className="text-[10px] text-amber-500/80 mt-0.5">أولوية فائقة وسرعة قصوى</div>
          </div>

          <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 sm:p-3.5">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-[11px] sm:text-xs font-medium">المحظورين</span>
              <UserX className="w-3.5 h-3.5 text-red-400" />
            </div>
            <div className="text-lg sm:text-xl font-bold text-red-400 tracking-tight">{blockedUsersCount}</div>
            <div className="text-[10px] text-red-500/80 mt-0.5">ممنوعين من الاستخدام</div>
          </div>

          <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 sm:p-3.5 col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-[11px] sm:text-xs font-medium">إجمالي الطلبات</span>
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div className="text-lg sm:text-xl font-bold text-cyan-400 tracking-tight">{totalRequests}</div>
            <div className="text-[10px] text-cyan-500/80 mt-0.5">عمليات معالجة</div>
          </div>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 sm:p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5 sm:gap-3 shadow-lg">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالاسم، @username، أو Chat ID..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-9 pl-8 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>

        {/* Filters and Auto-Refresh Indicator */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
          {/* Active Auto-Refresh indicator chip */}
          {isAutoRefreshing && (
            <div className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-xs font-medium shadow-sm shadow-cyan-500/10 shrink-0">
              <RefreshCw className="w-3 h-3 animate-spin text-cyan-400" />
              <span>تحديث تلقائي في الخلفية...</span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 flex-1">
            {/* Status Filter */}
            <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 px-2 py-2 rounded-xl text-xs text-slate-300">
              <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-transparent text-[11px] sm:text-xs text-white focus:outline-none cursor-pointer w-full"
              >
                <option value="all" className="bg-slate-900 text-white">كل الحالات</option>
                <option value="active" className="bg-slate-900 text-white">النشطين</option>
                <option value="vip" className="bg-slate-900 text-white">أعضاء VIP</option>
                <option value="blocked" className="bg-slate-900 text-white">المحظورين</option>
              </select>
            </div>

            {/* Type Filter */}
            <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 px-2 py-2 rounded-xl text-xs text-slate-300">
              <Smartphone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="bg-transparent text-[11px] sm:text-xs text-white focus:outline-none cursor-pointer w-full"
              >
                <option value="all" className="bg-slate-900 text-white">كل الأنواع</option>
                <option value="private" className="bg-slate-900 text-white">خاص</option>
                <option value="channel" className="bg-slate-900 text-white">قنوات</option>
                <option value="group" className="bg-slate-900 text-white">مجموعات</option>
              </select>
            </div>

            {/* Sort */}
            <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 px-2 py-2 rounded-xl text-xs text-slate-300">
              <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-transparent text-[11px] sm:text-xs text-white focus:outline-none cursor-pointer w-full"
              >
                <option value="last_active" className="bg-slate-900 text-white">آخر نشاط</option>
                <option value="downloads" className="bg-slate-900 text-white">الأكثر تحميلاً</option>
                <option value="first_seen" className="bg-slate-900 text-white">تاريخ الانضمام</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Fetched Members & Last Data Update Stats Banner Card */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-purple-500/30 rounded-2xl p-4 sm:p-5 shadow-xl relative overflow-hidden backdrop-blur-md">
        {/* Ambient background glows */}
        <div className="absolute -top-12 -left-12 w-48 h-48 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-12 -right-12 w-48 h-48 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Summary & Header */}
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-sky-500 text-white flex items-center justify-center shadow-lg shadow-purple-600/30 shrink-0">
              <Zap className="w-6 h-6 text-yellow-300 fill-yellow-300/30" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-bold text-white tracking-tight flex items-center gap-2">
                  <span>إحصائيات الأعضاء المجلوبين ومزامنة البيانات</span>
                </h2>
                <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  قاعدة البيانات نشطة ومتزامنة
                </span>
                {isAutoRefreshEnabled && (
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 transition-all ${
                    isAutoRefreshing
                      ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/40 shadow-sm shadow-cyan-500/20'
                      : 'bg-indigo-950/80 text-indigo-300 border border-indigo-800/60'
                  }`}>
                    <RefreshCw className={`w-2.5 h-2.5 ${isAutoRefreshing ? 'animate-spin text-cyan-300' : 'text-indigo-400'}`} />
                    <span>{isAutoRefreshing ? 'تحديث دوري نشط...' : `تحديث تلقائي كل ${autoRefreshIntervalSec}ث`}</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                مجموع الحسابات والأعضاء المكتشفين من القنوات والمجموعات عبر Telethon MTProto ومحرك البوت
              </p>
            </div>
          </div>

          {/* Metrics & Last Update Time */}
          <div className="grid grid-cols-2 sm:flex sm:items-center gap-2.5 sm:gap-3 shrink-0">
            {/* Stat 1: Total Scraped / Fetched */}
            <div className="bg-slate-950/80 border border-purple-500/30 rounded-xl px-3.5 py-2.5 min-w-[130px]">
              <div className="text-[10px] font-semibold text-purple-300 flex items-center gap-1 mb-0.5">
                <Users className="w-3 h-3 text-purple-400" />
                <span>الأعضاء المجلوبين</span>
              </div>
              <div className="text-lg sm:text-xl font-extrabold text-white flex items-baseline gap-1">
                <span className="text-purple-300 font-mono">{totalFetchedMembersCount}</span>
                <span className="text-[10px] text-slate-400 font-normal">عضو ومسؤول</span>
              </div>
            </div>

            {/* Stat 2: Audience Reach */}
            {totalAudienceReach > 0 && (
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2.5 min-w-[120px]">
                <div className="text-[10px] font-semibold text-sky-300 flex items-center gap-1 mb-0.5">
                  <Radio className="w-3 h-3 text-sky-400" />
                  <span>جمهور القنوات</span>
                </div>
                <div className="text-lg sm:text-xl font-extrabold text-white flex items-baseline gap-1">
                  <span className="text-sky-300 font-mono">{totalAudienceReach}</span>
                  <span className="text-[10px] text-slate-400 font-normal">مشترك</span>
                </div>
              </div>
            )}

            {/* Stat 3: Last Data Update Date & Relative Time */}
            <div className="col-span-2 sm:col-span-1 bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2.5 min-w-[170px] relative">
              {isAutoRefreshing && (
                <span className="absolute top-2 left-2 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500" />
                </span>
              )}
              <div className="text-[10px] font-semibold text-slate-400 flex items-center justify-between gap-1 mb-0.5">
                <span className="flex items-center gap-1 text-slate-300">
                  <Clock className="w-3 h-3 text-indigo-400" />
                  <span>آخر تحديث للبيانات</span>
                </span>
                <span className="text-[10px] text-emerald-400 font-medium font-mono">
                  {formatRelativeTime(latestUpdateISO)}
                </span>
              </div>
              <div className="text-xs font-bold text-slate-200 mt-0.5 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{formatFullDate(latestUpdateISO)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Users Container */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-xl relative">
        {/* Subtle Animated Top Loading Bar during Background Refresh */}
        {isAutoRefreshing && (
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-pulse z-30 pointer-events-none" />
        )}
        {filteredUsers.length === 0 ? (
          <div className="p-8 sm:p-12 text-center">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-slate-800/80 border border-slate-700 mx-auto flex items-center justify-center text-slate-500 mb-3 sm:mb-4">
              <Users className="w-7 h-7 sm:w-8 sm:h-8" />
            </div>
            <h3 className="text-sm sm:text-base font-bold text-white mb-1">لا يوجد مستخدمين مطابقين</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto mb-5">
              {searchQuery || statusFilter !== 'all' || typeFilter !== 'all'
                ? 'جرب تعديل كلمات البحث أو الفلاتر المحددة لعرض المستخدمين.'
                : 'لم يقم أي مستخدم بإرسال روابط للبوت حتى الآن، أو يمكنك إضافة مستخدم يدوياً.'}
            </p>
            <button
              onClick={() => setIsAddUserModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة مستخدم جديد الآن</span>
            </button>
          </div>
        ) : (
          <>
            {/* MOBILE VIEW: VIP User Cards (Hidden on Desktop) */}
            <div className="block md:hidden divide-y divide-slate-800/80">
              {filteredUsers.map((user) => {
                const isVip = user.status === 'vip';
                const isBlocked = user.status === 'blocked';
                const isAdmin = user.status === 'admin';
                const isChannel = user.type === 'channel' || String(user.chat_id).startsWith('-100');

                return (
                  <div key={String(user.chat_id)} className="p-4 space-y-3 hover:bg-slate-800/30 transition-colors">
                    {/* User Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div
                            className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow-inner ${
                              isVip
                                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 ring-2 ring-amber-500/20'
                                : isBlocked
                                ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                                : isChannel
                                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                                : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40'
                            }`}
                          >
                            {isChannel ? (
                              <Tv className="w-4 h-4" />
                            ) : isVip ? (
                              <Crown className="w-4 h-4" />
                            ) : isBlocked ? (
                              <UserX className="w-4 h-4" />
                            ) : (
                              (user.first_name || user.username || 'U').charAt(0).toUpperCase()
                            )}
                          </div>
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-900 ${
                              isBlocked ? 'bg-red-500' : 'bg-emerald-500'
                            }`}
                          />
                        </div>

                        <div>
                          <div className="font-bold text-white text-sm flex items-center gap-1.5 flex-wrap">
                            <span>{user.title || user.first_name || 'مستخدم مجهول'}</span>
                            {user.last_name && <span className="text-slate-400 text-xs">{user.last_name}</span>}
                            {user.role && (
                              <span className="bg-purple-500/10 text-purple-300 border border-purple-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded">
                                👑 {user.role}
                              </span>
                            )}
                            {user.member_count !== undefined && user.member_count > 0 && (
                              <span className="bg-sky-500/10 text-sky-300 border border-sky-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1">
                                <Users className="w-2.5 h-2.5" />
                                {user.member_count} عضو
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5 flex-wrap">
                            {user.username ? (
                              <a
                                href={`https://t.me/${user.username}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5 hover:underline font-mono"
                              >
                                @{user.username}
                                <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                              </a>
                            ) : (
                              <span className="text-slate-500">{isChannel ? 'قناة' : 'خاص'}</span>
                            )}
                            {user.linked_chat_title && (
                              <span className="text-indigo-300 text-[10px] bg-indigo-950/60 px-1 py-0.5 rounded border border-indigo-500/30">
                                🔗 {user.linked_chat_title}
                              </span>
                            )}
                            <span className="text-slate-600">•</span>
                            <span className="text-slate-400 text-[11px]">{formatRelativeTime(user.last_active)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Status Tag */}
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border shrink-0 ${
                          isVip
                            ? 'bg-amber-950/80 text-amber-300 border-amber-600/80 shadow-sm shadow-amber-500/10'
                            : isBlocked
                            ? 'bg-red-950/80 text-red-300 border-red-700/80'
                            : isAdmin
                            ? 'bg-purple-950/80 text-purple-300 border-purple-700/80'
                            : 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isVip ? 'bg-amber-400' : isBlocked ? 'bg-red-400' : 'bg-emerald-400'
                          }`}
                        />
                        {getStatusLabel(user.status)}
                      </span>
                    </div>

                    {/* Chat ID & Metrics info */}
                    <div className="flex items-center justify-between bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 text-[11px]">Chat ID:</span>
                        <button
                          onClick={() => handleCopy(String(user.chat_id))}
                          className="font-mono text-indigo-300 bg-indigo-950/40 border border-indigo-800/60 hover:bg-indigo-900/40 px-2 py-0.5 rounded-md flex items-center gap-1 text-[11px]"
                        >
                          <span>{user.chat_id}</span>
                          {copiedId === String(user.chat_id) ? (
                            <Check className="w-2.5 h-2.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-2.5 h-2.5 text-slate-400" />
                          )}
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-slate-300 font-bold">{user.total_downloads || 0} عملية</span>
                        {user.successful_downloads > 0 && (
                          <span className="text-[10px] text-emerald-400 font-semibold">({user.successful_downloads} ناجح)</span>
                        )}
                      </div>
                    </div>

                    {/* Platforms Used */}
                    {user.platforms_used && user.platforms_used.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-[10px] text-slate-500">المنصات:</span>
                        {user.platforms_used.map((p, idx) => (
                          <span
                            key={idx}
                            className="bg-slate-950 text-slate-300 border border-slate-800 text-[10px] px-1.5 py-0.2 rounded font-medium"
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Mobile Actions Bar */}
                    <div className="grid grid-cols-4 gap-1.5 pt-1">
                      <button
                        onClick={() => {
                          setSelectedUser(user);
                          setIsMsgModalOpen(true);
                        }}
                        className="flex items-center justify-center gap-1 py-2 px-2 rounded-xl bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600 hover:text-white text-xs font-semibold transition-colors"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>مراسلة</span>
                      </button>

                      <button
                        onClick={() => handleToggleStatus(user, isVip ? 'active' : 'vip')}
                        className={`flex items-center justify-center gap-1 py-2 px-2 rounded-xl border text-xs font-semibold transition-colors ${
                          isVip
                            ? 'bg-amber-600/20 text-amber-300 border-amber-500/40 hover:bg-slate-800'
                            : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-amber-400'
                        }`}
                      >
                        <Crown className="w-3.5 h-3.5 text-amber-400" />
                        <span>{isVip ? 'إلغاء VIP' : 'ترقية VIP'}</span>
                      </button>

                      <button
                        onClick={() => handleToggleStatus(user, isBlocked ? 'active' : 'blocked')}
                        className={`flex items-center justify-center gap-1 py-2 px-2 rounded-xl border text-xs font-semibold transition-colors ${
                          isBlocked
                            ? 'bg-red-600/20 text-red-300 border-red-500/40 hover:bg-slate-800'
                            : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-red-400'
                        }`}
                      >
                        <UserX className="w-3.5 h-3.5 text-red-400" />
                        <span>{isBlocked ? 'فك الحظر' : 'حظر'}</span>
                      </button>

                      <button
                        onClick={() => {
                          setSelectedUser(user);
                          setEditUserForm({ ...user });
                          setIsEditUserModalOpen(true);
                        }}
                        className="flex items-center justify-center gap-1 py-2 px-2 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 hover:text-white text-xs font-semibold transition-colors"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-cyan-400" />
                        <span>تعديل</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* DESKTOP VIEW: Full Data Table (Hidden on Mobile) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 font-semibold">
                  <tr>
                    <th className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        <span>المستخدم / القناة</span>
                        {isAutoRefreshing && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 text-[10px] font-normal border border-cyan-500/20 animate-pulse">
                            <RefreshCw className="w-2.5 h-2.5 animate-spin text-cyan-400" />
                            <span>مزامنة...</span>
                          </span>
                        )}
                      </div>
                    </th>
                    <th className="py-3.5 px-4">معرف الدردشة (Chat ID)</th>
                    <th className="py-3.5 px-4">الحالة</th>
                    <th className="py-3.5 px-4">التحميلات</th>
                    <th className="py-3.5 px-4">المنصات</th>
                    <th className="py-3.5 px-4">آخر نشاط</th>
                    <th className="py-3.5 px-4 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredUsers.map((user) => {
                    const isVip = user.status === 'vip';
                    const isBlocked = user.status === 'blocked';
                    const isAdmin = user.status === 'admin';
                    const isChannel = user.type === 'channel' || String(user.chat_id).startsWith('-100');

                    return (
                      <tr
                        key={String(user.chat_id)}
                        className="hover:bg-slate-800/40 transition-colors group"
                      >
                        {/* User Info */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="relative">
                              <div
                                className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm shadow-inner ${
                                  isVip
                                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                                    : isBlocked
                                    ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                                    : isChannel
                                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                                    : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40'
                                }`}
                              >
                                {isChannel ? (
                                  <Tv className="w-4 h-4" />
                                ) : isVip ? (
                                  <Crown className="w-4 h-4" />
                                ) : isBlocked ? (
                                  <UserX className="w-4 h-4" />
                                ) : (
                                  (user.first_name || user.username || 'U').charAt(0).toUpperCase()
                                )}
                              </div>
                              <span
                                className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-900 ${
                                  isBlocked ? 'bg-red-500' : 'bg-emerald-500'
                                }`}
                              />
                            </div>

                            <div>
                              <div className="font-semibold text-white flex items-center gap-1.5 flex-wrap">
                                <span>{user.title || user.first_name || 'مستخدم مجهول'}</span>
                                {user.last_name && <span className="text-slate-400">{user.last_name}</span>}
                                {user.role && (
                                  <span className="bg-purple-500/10 text-purple-300 border border-purple-500/30 text-[10px] font-bold px-1.5 py-0.5 rounded">
                                    👑 {user.role}
                                  </span>
                                )}
                                {user.member_count !== undefined && user.member_count > 0 && (
                                  <span className="bg-sky-500/10 text-sky-300 border border-sky-500/30 text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1">
                                    <Users className="w-3 h-3" />
                                    {user.member_count} عضو
                                  </span>
                                )}
                                {isVip && (
                                  <span className="bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[9px] font-bold px-1.5 py-0.2 rounded">
                                    VIP
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5 flex-wrap">
                                {user.username ? (
                                  <a
                                    href={`https://t.me/${user.username}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5 hover:underline font-mono"
                                  >
                                    @{user.username}
                                    <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                                  </a>
                                ) : (
                                  <span>{isChannel ? 'قناة تيليجرام' : 'محادثة خاصة'}</span>
                                )}
                                {user.linked_chat_title && (
                                  <span className="text-indigo-300 text-[10px] bg-indigo-950/60 px-1.5 py-0.5 rounded border border-indigo-500/30">
                                    🔗 {user.linked_chat_title}
                                  </span>
                                )}
                                {user.notes && (
                                  <span className="text-slate-500 truncate max-w-[140px]" title={user.notes}>
                                    • {user.notes}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Chat ID */}
                        <td className="py-3.5 px-4">
                          <button
                            onClick={() => handleCopy(String(user.chat_id))}
                            className="font-mono text-slate-300 bg-slate-950 border border-slate-800 hover:border-indigo-600/60 px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-colors group/btn text-[11px]"
                            title="اضغط لنسخ Chat ID"
                          >
                            <span>{user.chat_id}</span>
                            {copiedId === String(user.chat_id) ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3 text-slate-500 group-hover/btn:text-indigo-400" />
                            )}
                          </button>
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                              isVip
                                ? 'bg-amber-950/60 text-amber-300 border-amber-700/60'
                                : isBlocked
                                ? 'bg-red-950/60 text-red-300 border-red-700/60'
                                : isAdmin
                                ? 'bg-purple-950/60 text-purple-300 border-purple-700/60'
                                : 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                isVip ? 'bg-amber-400' : isBlocked ? 'bg-red-400' : 'bg-emerald-400'
                              }`}
                            />
                            {getStatusLabel(user.status)}
                          </span>
                        </td>

                        {/* Downloads */}
                        <td className="py-3.5 px-4">
                          <div>
                            <div className="font-bold text-white text-xs">{user.total_downloads || 0} عملية</div>
                            <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                              <span className="text-emerald-400 font-medium">
                                {user.successful_downloads || 0} ناجح
                              </span>
                              {user.failed_downloads > 0 && (
                                <span className="text-red-400">({user.failed_downloads} فشل)</span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Platforms */}
                        <td className="py-3.5 px-4">
                          <div className="flex flex-wrap gap-1 max-w-[150px]">
                            {(user.platforms_used && user.platforms_used.length > 0 ? user.platforms_used : ['TikTok']).map(
                              (p, idx) => (
                                <span
                                  key={idx}
                                  className="bg-slate-950 text-slate-300 border border-slate-800 text-[10px] px-1.5 py-0.5 rounded font-medium"
                                >
                                  {p}
                                </span>
                              )
                            )}
                          </div>
                        </td>

                        {/* Last Active */}
                        <td className="py-3.5 px-4 text-slate-300">
                          <div>{formatRelativeTime(user.last_active)}</div>
                          <div className="text-[10px] text-slate-500">
                            انضم {new Date(user.first_seen).toLocaleDateString('ar-EG')}
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {/* Send Message */}
                            <button
                              onClick={() => {
                                setSelectedUser(user);
                                setIsMsgModalOpen(true);
                              }}
                              className="p-1.5 rounded-lg bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600 hover:text-white border border-indigo-500/30 transition-all cursor-pointer"
                              title="إرسال رسالة مباشرة للمستخدم"
                            >
                              <Send className="w-3.5 h-3.5" />
                            </button>

                            {/* Toggle VIP */}
                            <button
                              onClick={() => handleToggleStatus(user, isVip ? 'active' : 'vip')}
                              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                                isVip
                                  ? 'bg-amber-600/30 text-amber-300 border-amber-500/40 hover:bg-slate-800'
                                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-amber-400 hover:bg-slate-700'
                              }`}
                              title={isVip ? 'إلغاء ترقية VIP' : 'ترقية إلى VIP'}
                            >
                              <Crown className="w-3.5 h-3.5" />
                            </button>

                            {/* Toggle Block */}
                            <button
                              onClick={() => handleToggleStatus(user, isBlocked ? 'active' : 'blocked')}
                              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                                isBlocked
                                  ? 'bg-red-600/30 text-red-300 border-red-500/40 hover:bg-slate-800'
                                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-red-400 hover:bg-slate-700'
                              }`}
                              title={isBlocked ? 'إلغاء الحظر' : 'حظر المستخدم'}
                            >
                              <UserX className="w-3.5 h-3.5" />
                            </button>

                            {/* Edit Notes / Info */}
                            <button
                              onClick={() => {
                                setSelectedUser(user);
                                setEditUserForm({ ...user });
                                setIsEditUserModalOpen(true);
                              }}
                              className="p-1.5 rounded-lg bg-slate-800 text-slate-400 border border-slate-700 hover:text-cyan-400 hover:bg-slate-700 transition-all cursor-pointer"
                              title="تعديل الملاحظات والحالة"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>

                            {/* Delete */}
                            <button
                              onClick={() => handleDeleteUser(user)}
                              className="p-1.5 rounded-lg bg-slate-800 text-slate-400 border border-slate-700 hover:text-red-400 hover:bg-slate-700 transition-all cursor-pointer"
                              title="حذف من اللوحة"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* MODAL 1: Direct Message Modal */}
      {isMsgModalOpen && selectedUser && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center">
                  <Send className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">إرسال رسالة مباشرة للمستخدم</h3>
                  <p className="text-xs text-slate-400">
                    المستلم: {selectedUser.first_name || selectedUser.chat_id} (
                    <code>{selectedUser.chat_id}</code>)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsMsgModalOpen(false)}
                className="text-slate-400 hover:text-white text-xs p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 my-4">
              {/* Quick Templates */}
              <div>
                <label className="text-[11px] text-slate-400 font-medium block mb-1.5">نماذج رسائل جاهزة سريعة:</label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: '🎉 ترحيب', text: '👋 أهلاً بك في بوت التحميل الذكي! نتمنى لك تجربة ممتعة.' },
                    { label: '👑 ترقية VIP', text: '👑 تهانينا! تمت ترقية حسابك إلى باقة VIP المميزة مع سرعة تحميل فائقة وأولوية مطلقة.' },
                    { label: '⚡ تحديث خوادم', text: '🚀 تم تحديث محرك استخراج الفيديوهات بنجاح وإضافة دعم أحدث المنصات.' },
                    { label: '⚠️ تنبيه استخدام', text: '⚠️ تنبيه: يرجى إرسال روابط فيديو صالحة فقط للاستمتاع بأفضل جودة.' },
                  ].map((tpl, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setMsgText(tpl.text)}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] px-2.5 py-1 rounded-lg border border-slate-700 transition-colors"
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Message Input */}
              <div>
                <label className="text-xs text-slate-300 font-medium block mb-1">
                  نص الرسالة (يدعم تنسيق HTML مثل <code>&lt;b&gt;عريض&lt;/b&gt;</code>):
                </label>
                <textarea
                  rows={5}
                  value={msgText}
                  onChange={(e) => setMsgText(e.target.value)}
                  placeholder="اكتب رسالتك للمستخدم هنا..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none font-sans"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsMsgModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isSendingMsg || !msgText.trim()}
                onClick={handleSendDirectMessage}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
              >
                {isSendingMsg ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>جاري الإرسال عبر تيليجرام...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>إرسال الآن</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Broadcast Announcement Modal */}
      {isBroadcastModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center">
                  <Radio className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">إذاعة رسالة جماعية (Broadcast)</h3>
                  <p className="text-xs text-slate-400">إرسال إشعار فوري لجميع المشتركين عبر البوت</p>
                </div>
              </div>
              <button
                onClick={() => !isBroadcasting && setIsBroadcastModalOpen(false)}
                className="text-slate-400 hover:text-white text-xs p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 my-4">
              {/* Target Audience */}
              <div>
                <label className="text-xs text-slate-300 font-medium block mb-1.5">الفئة المستهدفة:</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'all', label: `الكل (${users.length})` },
                    { id: 'vip', label: `VIP فقط (${vipUsersCount})` },
                    { id: 'active', label: `النشطين (${activeUsersCount})` },
                  ].map((target) => (
                    <button
                      key={target.id}
                      type="button"
                      onClick={() => setBroadcastTarget(target.id as any)}
                      className={`px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
                        broadcastTarget === target.id
                          ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/20'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      {target.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Broadcast Content */}
              <div>
                <label className="text-xs text-slate-300 font-medium block mb-1">
                  نص الإشعار الجماعي (يدعم HTML):
                </label>
                <textarea
                  rows={6}
                  value={broadcastText}
                  onChange={(e) => setBroadcastText(e.target.value)}
                  placeholder="📣 أهلاً بكم جميعاً! تم إطلاق تحديث جديد في البوت..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none font-sans"
                />
              </div>

              {/* Progress feedback */}
              {broadcastProgress && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-slate-300">جاري الإرسال للمشتركين...</span>
                    <span className="text-indigo-400 font-bold">
                      {broadcastProgress.sent} / {broadcastProgress.total}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 transition-all duration-200"
                      style={{
                        width: `${Math.round((broadcastProgress.sent / Math.max(broadcastProgress.total, 1)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                disabled={isBroadcasting}
                onClick={() => setIsBroadcastModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isBroadcasting || !broadcastText.trim()}
                onClick={handleBroadcast}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
              >
                {isBroadcasting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>جاري الإرسال ({broadcastProgress?.sent}/{broadcastProgress?.total})...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>بدء الإذاعة الجماعية</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Add Manual User Modal */}
      {isAddUserModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">إضافة مستخدم جديد يدوياً</h3>
                  <p className="text-xs text-slate-400">تسجيل حساب أو قناة في لوحة الإدارة</p>
                </div>
              </div>
              <button
                onClick={() => setIsAddUserModalOpen(false)}
                className="text-slate-400 hover:text-white text-xs p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3.5 my-4">
              <div>
                <label className="text-xs text-slate-300 font-medium block mb-1">
                  معرف الدردشة (Chat ID / User ID) *
                </label>
                <input
                  type="text"
                  required
                  value={newUserForm.chat_id}
                  onChange={(e) => setNewUserForm({ ...newUserForm, chat_id: e.target.value })}
                  placeholder="مثال: 123456789 أو -100123456789"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-300 font-medium block mb-1">الاسم الأول / العنوان</label>
                  <input
                    type="text"
                    value={newUserForm.first_name}
                    onChange={(e) => setNewUserForm({ ...newUserForm, first_name: e.target.value })}
                    placeholder="مثال: أحمد"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-300 font-medium block mb-1">اسم المستخدم (Username)</label>
                  <input
                    type="text"
                    value={newUserForm.username}
                    onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                    placeholder="مثال: ahmed_dev"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-300 font-medium block mb-1">نوع الحساب</label>
                  <select
                    value={newUserForm.type}
                    onChange={(e) => setNewUserForm({ ...newUserForm, type: e.target.value as any })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="private">محادثة خاصة</option>
                    <option value="channel">قناة تيليجرام</option>
                    <option value="group">مجموعة</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-300 font-medium block mb-1">الحالة</label>
                  <select
                    value={newUserForm.status}
                    onChange={(e) => setNewUserForm({ ...newUserForm, status: e.target.value as any })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="active">نشط (Active)</option>
                    <option value="vip">عضو مميز (VIP)</option>
                    <option value="blocked">محظور (Blocked)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-300 font-medium block mb-1">ملاحظات إدارية</label>
                <input
                  type="text"
                  value={newUserForm.notes}
                  onChange={(e) => setNewUserForm({ ...newUserForm, notes: e.target.value })}
                  placeholder="ملاحظات اختيارية عن المستخدم..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddUserModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
                >
                  حفظ المستخدم
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: Edit User Modal */}
      {isEditUserModalOpen && selectedUser && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center">
                  <Edit3 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">تعديل بيانات المستخدم</h3>
                  <p className="text-xs text-slate-400">معرف: {selectedUser.chat_id}</p>
                </div>
              </div>
              <button
                onClick={() => setIsEditUserModalOpen(false)}
                className="text-slate-400 hover:text-white text-xs p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEditUser} className="space-y-3.5 my-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-300 font-medium block mb-1">الاسم</label>
                  <input
                    type="text"
                    value={editUserForm.first_name || ''}
                    onChange={(e) => setEditUserForm({ ...editUserForm, first_name: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-300 font-medium block mb-1">اسم المستخدم</label>
                  <input
                    type="text"
                    value={editUserForm.username || ''}
                    onChange={(e) => setEditUserForm({ ...editUserForm, username: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-300 font-medium block mb-1">الحالة</label>
                  <select
                    value={editUserForm.status || 'active'}
                    onChange={(e) => setEditUserForm({ ...editUserForm, status: e.target.value as any })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="active">نشط (Active)</option>
                    <option value="vip">عضو مميز (VIP)</option>
                    <option value="blocked">محظور (Blocked)</option>
                    <option value="admin">مسؤول (Admin)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-300 font-medium block mb-1">نوع المحادثة</label>
                  <select
                    value={editUserForm.type || 'private'}
                    onChange={(e) => setEditUserForm({ ...editUserForm, type: e.target.value as any })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="private">محادثة خاصة</option>
                    <option value="channel">قناة تيليجرام</option>
                    <option value="group">مجموعة</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-300 font-medium block mb-1">ملاحظات إدارية</label>
                <textarea
                  rows={3}
                  value={editUserForm.notes || ''}
                  onChange={(e) => setEditUserForm({ ...editUserForm, notes: e.target.value })}
                  placeholder="أدخل أي ملاحظات مخصصة..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsEditUserModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 transition-all cursor-pointer"
                >
                  تحديث التعديلات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: Import Telegram Channel / Supergroup Modal */}
      {isImportChatModalOpen && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-sky-600 to-blue-600 text-white flex items-center justify-center shadow-lg shadow-sky-600/30">
                  <Radio className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">جلب وفحص قناة / مجموعة من تيليجرام</h3>
                  <p className="text-xs text-slate-400">استيراد القنوات والمجموعات وفحص المشتركين والروابط</p>
                </div>
              </div>
              <button
                onClick={() => setIsImportChatModalOpen(false)}
                className="text-slate-400 hover:text-white text-sm p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleImportChat} className="space-y-4 my-4">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5">
                  رابط القناة أو اسم المستخدم (Username / Link / ID)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    value={importChatInput}
                    onChange={(e) => setImportChatInput(e.target.value)}
                    placeholder="مثال: https://t.me/IT_comment1 أو @IT_comment1"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono"
                  />
                  <button
                    type="submit"
                    disabled={isImportingChat}
                    className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white text-xs font-semibold shadow-lg shadow-sky-600/25 transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    {isImportingChat ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>جاري الفحص...</span>
                      </>
                    ) : (
                      <>
                        <Search className="w-3.5 h-3.5" />
                        <span>فحص واستيراد</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-slate-400">روابط سريعة:</span>
                <button
                  type="button"
                  onClick={() => {
                    setImportChatInput('https://t.me/IT_comment1');
                  }}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-sky-300 border border-slate-700 transition-colors font-mono"
                >
                  @IT_comment1
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImportChatInput('https://t.me/UMS_IT2022');
                  }}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-sky-300 border border-slate-700 transition-colors font-mono"
                >
                  @UMS_IT2022
                </button>
              </div>

              {/* Result Preview Box */}
              {importedChatResult && (
                <div className="p-4 rounded-2xl bg-slate-950/90 border border-sky-500/30 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/40 flex items-center justify-center">
                        <Tv className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                          <span>{importedChatResult.chat?.title || 'قناة / مجموعة'}</span>
                          <span className="bg-sky-500/20 text-sky-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-sky-500/30">
                            {importedChatResult.chat?.type === 'supergroup'
                              ? 'مجموعة محادثات'
                              : importedChatResult.chat?.type === 'channel'
                              ? 'قناة رسمية'
                              : 'مجموعة'}
                          </span>
                        </h4>
                        <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                          {importedChatResult.chat?.username && (
                            <a
                              href={`https://t.me/${importedChatResult.chat.username}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sky-400 hover:underline flex items-center gap-1 font-mono"
                            >
                              @{importedChatResult.chat.username}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                          <span>• ID: {importedChatResult.chat?.id}</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-sm font-bold text-emerald-400 flex items-center gap-1 justify-end">
                        <Users className="w-4 h-4" />
                        <span>{importedChatResult.chat?.memberCount || 0}</span>
                      </div>
                      <span className="text-[10px] text-slate-400">عضو / مشترك</span>
                    </div>
                  </div>

                  {importedChatResult.chat?.description && (
                    <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-300 whitespace-pre-line leading-relaxed font-sans">
                      {importedChatResult.chat.description}
                    </div>
                  )}

                  {importedChatResult.chat?.linked_chat_title && (
                    <div className="flex items-center gap-2 p-2.5 rounded-xl bg-indigo-950/40 border border-indigo-500/30 text-xs text-indigo-200">
                      <Radio className="w-4 h-4 text-indigo-400 shrink-0" />
                      <div>
                        <span className="font-bold">القناة المرتبطة: </span>
                        <span>{importedChatResult.chat.linked_chat_title}</span>
                        {importedChatResult.chat.linked_chat_username && (
                          <span className="font-mono text-indigo-300"> (@{importedChatResult.chat.linked_chat_username})</span>
                        )}
                      </div>
                    </div>
                  )}

                  {importedChatResult.discoveredContacts && importedChatResult.discoveredContacts.length > 0 && (
                    <div className="text-xs text-slate-400">
                      <span className="font-semibold text-slate-300">مسؤولين / جهات اتصال تم اكتشافهم: </span>
                      <div className="flex items-center gap-1.5 flex-wrap mt-1">
                        {importedChatResult.discoveredContacts.map((c: string) => (
                          <a
                            key={c}
                            href={`https://t.me/${c}`}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[11px] font-mono hover:underline flex items-center gap-1"
                          >
                            <Crown className="w-3 h-3 text-amber-400" />
                            @{c}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Technical API Notice */}
              <div className="p-3.5 rounded-2xl bg-amber-950/30 border border-amber-600/30 text-xs text-amber-200/90 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-amber-300">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>ملاحظة حول سحب أعضاء قنوات ومجموعات تيليجرام:</span>
                </div>
                <p className="leading-relaxed text-[11px]">
                  وفقاً لسياسة خصوصية Telegram Bot API الرسمية، لا تسمح تيليجرام للبوتات بسحب قائمة أسماء جميع الأعضاء الصامتين دفعة واحدة.
                  ولكن بمجرد إضافة البوت (@smart_creators_bot) مشرفاً أو عضواً في المجموعة، سيقوم المحرك تلقائياً بالتقاط وتسجيل أي مستخدم يرسل تعليقاً أو رابطاً أو يتفاعل مع البوت فوراً في هذه اللوحة!
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsImportChatModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                >
                  إغلاق
                </button>
                {importedChatResult && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsImportChatModalOpen(false);
                      toast.success('تمت إضافة وتحديث بيانات القناة في لوحة التحكم بنجاح');
                    }}
                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/20 transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <Check className="w-4 h-4" />
                    <span>تم الحفظ في لوحة التحكم</span>
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 6: Telethon Channel & Group Members Scraper Modal */}
      {isTelethonModalOpen && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-purple-500/30 rounded-3xl max-w-2xl w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center shadow-lg shadow-purple-600/30">
                  <Zap className="w-6 h-6 text-yellow-300 fill-yellow-300/30" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-white">سحب أعضاء القنوات والمجموعات (Telethon Engine)</h3>
                    <span className="bg-purple-500/20 text-purple-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-purple-500/30 font-mono">
                      Telethon MTProto + Web AI
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    الاتصال بالقنوات وسحب وتخزين الأعضاء والمشاركين والمعلقين في قاعدة البيانات تلقائياً
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsTelethonModalOpen(false)}
                className="text-slate-400 hover:text-white text-sm p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRunTelethonScraper} className="space-y-4 my-4">
              {/* Channel Input */}
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1.5 flex items-center justify-between">
                  <span>رابط أو معرف القناة / المجموعة (Channel Link / Username / ID)</span>
                  <span className="text-[11px] text-purple-400 font-normal">يدعم الروابط والمعرفات</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    value={telethonTarget}
                    onChange={(e) => setTelethonTarget(e.target.value)}
                    placeholder="مثال: https://t.me/IT_comment1 أو @IT_comment1 أو -1002109107801"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono"
                  />
                  <button
                    type="submit"
                    disabled={isScrapingTelethon}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/25 transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer min-w-[130px] justify-center"
                  >
                    {isScrapingTelethon ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>جاري السحب...</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-3.5 h-3.5 text-yellow-300" />
                        <span>بدء السحب والحفظ</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Quick Presets */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-slate-400">قنوات سريعة:</span>
                <button
                  type="button"
                  onClick={() => setTelethonTarget('https://t.me/IT_comment1')}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-purple-300 border border-slate-700 transition-colors font-mono"
                >
                  @IT_comment1 (مجموعة المناقشات)
                </button>
                <button
                  type="button"
                  onClick={() => setTelethonTarget('https://t.me/UMS_IT2022')}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-purple-300 border border-slate-700 transition-colors font-mono"
                >
                  @UMS_IT2022 (القناة الرسمية)
                </button>
                <button
                  type="button"
                  onClick={() => setTelethonTarget('https://t.me/student_it2')}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-purple-300 border border-slate-700 transition-colors font-mono"
                >
                  @student_it2 (قناة الملازم)
                </button>
              </div>

              {/* Extraction Options & Limit */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800">
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    نمط محرك السحب (Extraction Engine)
                  </label>
                  <select
                    value={telethonMode}
                    onChange={(e) => setTelethonMode(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="auto">⚡ الوضع الذكي التلقائي (Telethon + Deep Scraper)</option>
                    <option value="telethon_mtproto">🔌 بروتوكول Telethon MTProto المباشر</option>
                    <option value="deep_web_bot">🌐 فحص التعليقات ومنشورات الويب (Zero-Config)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    الحد الأقصى لعدد الأعضاء (Member Limit)
                  </label>
                  <select
                    value={telethonLimit}
                    onChange={(e) => setTelethonLimit(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value={50}>50 عضو (سريع)</option>
                    <option value={100}>100 عضو (مستحسن)</option>
                    <option value={250}>250 عضو</option>
                    <option value={500}>500 عضو</option>
                    <option value={1000}>1000 عضو (شامل)</option>
                  </select>
                </div>
              </div>

              {/* Collapsible Telethon MTProto API Credentials */}
              <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/40">
                <button
                  type="button"
                  onClick={() => setShowMtprotoCredentials(!showMtprotoCredentials)}
                  className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800/40 transition-colors text-right"
                >
                  <div className="flex items-center gap-2">
                    <Key className="w-3.5 h-3.5 text-purple-400" />
                    <span>إعدادات Telethon MTProto المتقدمة (API ID / API Hash / Session) - اختياري</span>
                  </div>
                  <span className="text-slate-500 text-xs">{showMtprotoCredentials ? '▲ إخفاء' : '▼ تخصيص'}</span>
                </button>

                {showMtprotoCredentials && (
                  <div className="p-4 border-t border-slate-800 space-y-3 bg-slate-900/60">
                    <p className="text-[11px] text-slate-400">
                      إذا كنت تمتلك مفاتيح API الخاصة بحسابك من (my.telegram.org)، يمكنك إدخالها هنا لتمكين السحب المباشر لكامل قائمة أعضاء المجموعات الخاصة والخارقة.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-slate-400 block mb-1">Telegram API_ID</label>
                        <input
                          type="text"
                          value={telethonApiId}
                          onChange={(e) => setTelethonApiId(e.target.value)}
                          placeholder="e.g. 12345678"
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 block mb-1">Telegram API_HASH</label>
                        <input
                          type="password"
                          value={telethonApiHash}
                          onChange={(e) => setTelethonApiHash(e.target.value)}
                          placeholder="e.g. a1b2c3d4e5f6..."
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">String Session (جلسة مسجلة مسبقاً)</label>
                      <input
                        type="password"
                        value={telethonSession}
                        onChange={(e) => setTelethonSession(e.target.value)}
                        placeholder="Telethon Session String (اختياري)"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Real-time Terminal Logs */}
              {telethonLogs.length > 0 && (
                <div className="rounded-2xl bg-slate-950 border border-slate-800 p-3.5 font-mono text-[11px] space-y-1 max-h-36 overflow-y-auto">
                  <div className="flex items-center justify-between text-slate-400 pb-1 border-b border-slate-800/80 mb-1.5 font-sans">
                    <span className="flex items-center gap-1.5 text-[10px] text-purple-300 font-semibold">
                      <Terminal className="w-3 h-3" />
                      <span>سجل عمليات Telethon Scraper</span>
                    </span>
                    {isScrapingTelethon && <span className="animate-pulse text-yellow-400 text-[10px]">جاري التنفيذ...</span>}
                  </div>
                  {telethonLogs.map((log, idx) => (
                    <div key={idx} className="text-slate-300 leading-relaxed">
                      <span className="text-purple-400 mr-1.5">&gt;</span>
                      <span>{log}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Scraped Results Card */}
              {telethonResult && (
                <div className="p-4 rounded-2xl bg-slate-950/90 border border-purple-500/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center justify-center">
                        <Database className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          <span>{telethonResult.channel?.title || 'القناة المستخرجة'}</span>
                          <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/30">
                            ✓ تم التخزين في قاعدة البيانات
                          </span>
                        </h4>
                        <span className="text-xs text-slate-400">
                          {telethonResult.channel?.member_count ? `${telethonResult.channel.member_count} مشترك إجمالي` : ''} • نمط السحب:{' '}
                          {telethonResult.mode_used === 'telethon_mtproto' ? 'Telethon MTProto' : 'Deep Web & Bot'}
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-base font-extrabold text-purple-300 flex items-center gap-1 justify-end">
                        <Users className="w-4 h-4 text-purple-400" />
                        <span>{telethonResult.members?.length || 0}</span>
                      </div>
                      <span className="text-[10px] text-slate-400">عضو تم سحبهم</span>
                    </div>
                  </div>

                  {/* Members Preview Table */}
                  {telethonResult.members && telethonResult.members.length > 0 && (
                    <div className="border border-slate-800 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-900 text-slate-400 border-b border-slate-800 sticky top-0 text-[11px]">
                          <tr>
                            <th className="py-2 px-3">المستخدم / العضو</th>
                            <th className="py-2 px-3">الدور / الصفة</th>
                            <th className="py-2 px-3">ملاحظة النشاط</th>
                            <th className="py-2 px-3 text-center">إجراء</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 bg-slate-950/60">
                          {telethonResult.members.map((m: any, idx: number) => (
                            <tr key={idx} className="hover:bg-slate-900/60 transition-colors">
                              <td className="py-2 px-3">
                                <div className="font-semibold text-white flex items-center gap-1.5">
                                  <span>{m.first_name || `مستخدم #${m.id}`}</span>
                                  {m.last_name && <span className="text-slate-400">{m.last_name}</span>}
                                </div>
                                {m.username && (
                                  <a
                                    href={`https://t.me/${m.username}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[11px] text-indigo-400 hover:underline font-mono"
                                  >
                                    @{m.username}
                                  </a>
                                )}
                              </td>
                              <td className="py-2 px-3">
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                    m.role === 'Creator'
                                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                                      : m.role === 'Admin'
                                      ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                                      : 'bg-slate-800 text-slate-300 border-slate-700'
                                  }`}
                                >
                                  {m.role === 'Creator' ? '👑 منشئ' : m.role === 'Admin' ? '🛡️ مشرف' : m.role || 'عضو'}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-[11px] text-slate-400 max-w-[180px] truncate">
                                {m.activity_note || 'مسجل في قاعدة البيانات'}
                              </td>
                              <td className="py-2 px-3 text-center">
                                {m.username && (
                                  <a
                                    href={`https://t.me/${m.username}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="p-1 rounded bg-indigo-950 hover:bg-indigo-900 text-indigo-300 inline-flex items-center gap-0.5 text-[10px]"
                                    title="فتح المحادثة في تيليجرام"
                                  >
                                    <ExternalLink className="w-2.5 h-2.5" />
                                  </a>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Actions for Scraped Users */}
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80 flex-wrap justify-between">
                    <span className="text-[11px] text-emerald-400 flex items-center gap-1 font-semibold">
                      <Check className="w-3.5 h-3.5" />
                      <span>تمت المزامنة والتخزين مع قاعدة بيانات المستخدمين</span>
                    </span>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const csv =
                            'ID,Username,Name,Role,Activity\n' +
                            telethonResult.members
                              .map(
                                (m: any) =>
                                  `"${m.id}","${m.username || ''}","${m.first_name || ''} ${m.last_name || ''}","${m.role || ''}","${m.activity_note || ''}"`
                              )
                              .join('\n');
                          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `telethon_members_${telethonResult.channel?.username || 'export'}.csv`;
                          a.click();
                          toast.success('تم تصدير ملف الأعضاء بنجاح');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1 transition-colors"
                      >
                        <Download className="w-3 h-3 text-cyan-400" />
                        <span>تصدير CSV</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsTelethonModalOpen(false);
                          setIsBroadcastModalOpen(true);
                          toast.info('يمكنك الآن كتابة رسالة الإذاعة وإرسالها لجميع المشتركين والمستخرجين');
                        }}
                        className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1 shadow transition-colors"
                      >
                        <Send className="w-3 h-3" />
                        <span>إرسال إذاعة للمشتركين</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Close / Action footer */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsTelethonModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                >
                  إغلاق
                </button>
                {telethonResult && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsTelethonModalOpen(false);
                      toast.success('تم تحديث وحفظ بيانات الأعضاء في لوحة الإدارة');
                    }}
                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/20 transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <Check className="w-4 h-4" />
                    <span>تم الحفظ في لوحة التحكم</span>
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
