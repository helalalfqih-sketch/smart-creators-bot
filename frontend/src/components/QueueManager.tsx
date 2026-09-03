import React, { useState, useMemo } from 'react';
import {
  Activity,
  RefreshCw,
  Trash2,
  Search,
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Code,
  Layers,
  AlertCircle,
  XCircle,
  Bot,
  Zap,
  Ban,
  ExternalLink,
  Film,
  Music,
  FileDown,
  X,
  Copy,
  Check,
  Globe,
  User,
  Timer,
  LayoutGrid,
  List,
  Eye,
  Download,
  Share2,
  Sparkles,
  Maximize2,
  ArrowUpDown,
  Calendar,
  Filter,
  CheckSquare,
  Square,
  Send,
  Radio,
  SlidersHorizontal,
  ChevronDown,
  HardDrive,
} from 'lucide-react';
import { DashboardDownloadItem, MediaQualityOption } from '../types';
import { engine } from '../services/engineService';
import { TelegramService } from '../services/telegramService';
import { JobJsonModal } from './JobJsonModal';
import { VideoComparisonModal } from './VideoComparisonModal';
import { useToast } from '../context/ToastContext';

interface QueueManagerProps {
  queue: DashboardDownloadItem[];
  onRefresh: () => void;
}

type SortOption = 'newest' | 'oldest' | 'title_asc' | 'title_desc' | 'duration_desc' | 'duration_asc' | 'platform';
type DateFilterOption = 'all' | 'today' | '24h' | '7d';
type TypeFilterOption = 'all' | 'video' | 'audio';

export const QueueManager: React.FC<QueueManagerProps> = ({ queue, onRefresh }) => {
  const toast = useToast();
  const [viewMode, setViewMode] = useState<'gallery' | 'table'>('gallery');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState<DateFilterOption>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilterOption>('all');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  
  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Loading & sync states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [syncingTelegram, setSyncingTelegram] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  
  // Modals state
  const [selectedJobData, setSelectedJobData] = useState<{ title: string; data: any } | null>(null);
  const [qualitiesModalItem, setQualitiesModalItem] = useState<DashboardDownloadItem | null>(null);
  const [videoPreviewItem, setVideoPreviewItem] = useState<DashboardDownloadItem | null>(null);
  const [comparisonItem, setComparisonItem] = useState<DashboardDownloadItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  // Share to Telegram Modal state
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [itemsToShare, setItemsToShare] = useState<DashboardDownloadItem[]>([]);
  const [targetChatInput, setTargetChatInput] = useState<string>('');
  const [shareFormat, setShareFormat] = useState<'video' | 'card' | 'audio'>('video');
  const [shareCustomCaption, setShareCustomCaption] = useState<string>('');
  const [isSendingShare, setIsSendingShare] = useState(false);
  const [shareProgressMsg, setShareProgressMsg] = useState<string | null>(null);

  // Extract recent unique users/chats from queue
  const recentChats = useMemo(() => {
    const chatMap = new Map<string, { label: string; id: string }>();
    queue.forEach((item) => {
      if (item.user) {
        const u = item.user.trim();
        if (!chatMap.has(u)) {
          chatMap.set(u, {
            label: u.startsWith('@') ? `قناة/مستخدم ${u}` : u.startsWith('-100') ? `قناة/مجموعة (${u})` : `محادثة (${u})`,
            id: u,
          });
        }
      }
    });
    return Array.from(chatMap.values());
  }, [queue]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success('تم النسخ', 'تم نسخ الرابط إلى الحافظة بنجاح.');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSyncTelegram = async () => {
    const token = TelegramService.getSavedToken() || '';
    setSyncingTelegram(true);
    setSyncMessage(null);

    try {
      if (token && token.includes(':')) {
        await TelegramService.deleteWebhook(token, false).catch(() => {});
      }
      const res = await TelegramService.getUpdates(token, 25);
      if (res.ok && res.updates && res.updates.length > 0) {
        let addedCount = 0;
        for (const u of res.updates) {
          const msg = u.message || u.channel_post || u.edited_message;
          if (msg) {
            const urls = TelegramService.extractUrlsFromMessage(msg);
            const sender = msg.from?.username ? `@${msg.from.username}` : msg.from?.first_name || String(msg.chat.id);
            for (const url of urls) {
              engine.createDownloadJob(url, 'best', msg.chat.id);
              engine.addLog('INFO', `📥 تم استيراد رابط من رسائل تيليجرام: ${url} من ${sender}`, 'telegram_bot.py');
              addedCount++;
            }
          }
        }
        onRefresh();
        if (addedCount > 0) {
          const successMsg = `تم سحب ${addedCount} رابط من تيليجرام بنجاح! 📥`;
          setSyncMessage(`✅ ${successMsg}`);
          toast.success('تمت المزامنة بنجاح!', successMsg);
        } else {
          setSyncMessage('ℹ️ لا توجد روابط جديدة غير معالجة في تيليجرام');
          toast.info('فحص تيليجرام مكتمل', 'لا توجد روابط جديدة غير معالجة في تيليجرام.');
        }
      } else {
        const infoMsg = res.error || 'تم الفحص: لا توجد رسائل جديدة';
        setSyncMessage(`ℹ️ ${infoMsg}`);
        toast.info('فحص تيليجرام', infoMsg);
      }
    } catch (e: any) {
      setSyncMessage('فشل الاتصال بخوادم تيليجرام');
      toast.error('فشل الاتصال', 'تعذر الاتصال بخوادم تيليجرام.');
    } finally {
      setSyncingTelegram(false);
      setTimeout(() => setSyncMessage(null), 5000);
    }
  };

  const handlePause = (id: string) => {
    setActionLoading(id);
    try {
      engine.pauseJob(id);
      toast.warning('تم إيقاف المهمة مؤقتاً ⏸️', `تم تجميد التحميل للمهمة (${id}). يمكنك استئنافها في أي وقت.`);
      onRefresh();
    } catch (err: any) {
      toast.error('فشل إيقاف المهمة', err?.message || 'حدث خطأ غير متوقع');
    } finally {
      setActionLoading(null);
    }
  };

  const handleResume = (id: string) => {
    setActionLoading(id);
    try {
      engine.resumeJob(id);
      toast.info('تم استئناف المهمة ▶️', `جارٍ استكمال معالجة المهمة (${id})...`);
      onRefresh();
    } catch (err: any) {
      toast.error('فشل استئناف المهمة', err?.message || 'حدث خطأ غير متوقع');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRetry = (id: string) => {
    setActionLoading(id);
    try {
      engine.retryJob(id);
      toast.info('إعادة تشغيل المهمة 🔄', `تمت إعادة جدولة المهمة (${id}) وبدء المعالجة من جديد.`);
      onRefresh();
    } catch (err: any) {
      console.error('Failed to retry job:', err);
      toast.error('فشل إعادة المحاولة', err?.message || 'حدث خطأ غير متوقع');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = (id: string) => {
    setActionLoading(id);
    try {
      engine.cancelJob(id);
      toast.error('تم إلغاء المهمة ⛔', `تم إيقاف وإلغاء معالجة المهمة (${id}).`);
      onRefresh();
    } catch (err: any) {
      console.error('Failed to cancel job:', err);
      toast.error('فشل إلغاء المهمة', err?.message || 'حدث خطأ');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = (id: string) => {
    setActionLoading(id);
    try {
      engine.deleteJob(id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast.info('تم حذف المهمة 🗑️', `تم مسح سجل المهمة (${id}) نهائياً.`);
      onRefresh();
    } catch (err: any) {
      toast.error('فشل حذف المهمة', err?.message || 'حدث خطأ');
    } finally {
      setActionLoading(null);
    }
  };

  const handleClearAll = () => {
    engine.clearAllJobs();
    setSelectedIds(new Set());
    toast.warning('تم مسح الطابور بالكامل 🧹', 'تم حذف كافة المهام المسجلة في الذاكرة.');
    onRefresh();
  };

  // Selection handlers
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    const allFilteredIds = filtered.map((item) => item.id);
    setSelectedIds(new Set(allFilteredIds));
    toast.info('تم تحديد الكل ✅', `تم اختيار ${allFilteredIds.length} مهمة.`);
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  // Batch actions
  const handleBatchDelete = () => {
    const count = selectedIds.size;
    if (count === 0) return;
    selectedIds.forEach((id) => {
      engine.deleteJob(id);
    });
    setSelectedIds(new Set());
    toast.success('تم الحذف الجماعي 🗑️', `تم حذف ${count} مهمة بنجاح.`);
    onRefresh();
  };

  const handleBatchRetry = () => {
    const count = selectedIds.size;
    if (count === 0) return;
    selectedIds.forEach((id) => {
      engine.retryJob(id);
    });
    toast.info('إعادة تشغيل جماعية 🔄', `تمت إعادة جدولة ${count} مهمة للتحميل من جديد.`);
    onRefresh();
  };

  const handleBatchPause = () => {
    const count = selectedIds.size;
    if (count === 0) return;
    let paused = 0;
    selectedIds.forEach((id) => {
      const item = queue.find((q) => q.id === id);
      if (item && (item.status === 'downloading' || item.status === 'queued')) {
        engine.pauseJob(id);
        paused++;
      }
    });
    toast.warning('إيقاف مؤقت جماعي ⏸️', `تم إيقاف ${paused} مهمة.`);
    onRefresh();
  };

  const handleBatchResume = () => {
    const count = selectedIds.size;
    if (count === 0) return;
    let resumed = 0;
    selectedIds.forEach((id) => {
      const item = queue.find((q) => q.id === id);
      if (item && item.status === 'paused') {
        engine.resumeJob(id);
        resumed++;
      }
    });
    toast.info('استئناف جماعي ▶️', `تم استئناف ${resumed} مهمة.`);
    onRefresh();
  };

  // Trigger Share Modal for a single item or selected items
  const openShareModal = (items: DashboardDownloadItem[]) => {
    if (!items || items.length === 0) return;
    setItemsToShare(items);
    // Suggest default target chat
    const firstUser = items[0]?.user;
    if (firstUser && firstUser !== 'API' && firstUser !== 'unknown' && firstUser !== 'anonymous') {
      setTargetChatInput(firstUser);
    } else if (recentChats.length > 0) {
      setTargetChatInput(recentChats[0].id);
    } else {
      setTargetChatInput('');
    }
    setShareCustomCaption('');
    setShareModalOpen(true);
  };

  // Execute Share to Telegram Channel or User
  const handleExecuteShare = async () => {
    const cleanTarget = targetChatInput.trim();
    if (!cleanTarget || cleanTarget === 'unknown' || cleanTarget === 'anonymous') {
      toast.warning('حدد الوجهة', 'يرجى إدخال معرف مستخدم أو قناة صالح (مثال: @channel أو 5660048569).');
      return;
    }

    setIsSendingShare(true);
    let successCount = 0;
    let failCount = 0;
    let lastErrorMsg: string | null = null;

    for (let i = 0; i < itemsToShare.length; i++) {
      const item = itemsToShare[i];
      setShareProgressMsg(`جارٍ إرسال (${i + 1} من ${itemsToShare.length}): ${item.clean_title || item.filename || item.id}...`);

      const title = item.clean_title || item.filename || 'فيديو وسائط';
      
      let caption =
        `🎬 <b>${TelegramService.escapeHtml(title)}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📁 <b>المنصة:</b> ${item.platform}\n` +
        `🛡️ <b>الجودة:</b> 1080p FHD (بدون علامة مائية)\n` +
        (shareCustomCaption ? `\n💬 <i>${TelegramService.escapeHtml(shareCustomCaption)}</i>\n` : '') +
        `\n🔗 <a href="${item.url}">رابط المصدر الأصلي</a>`;

      try {
        const payload = {
          chat_id: cleanTarget,
          file: item.file || item.url,
          url: item.url,
          caption,
          type: shareFormat === 'audio' ? 'audio' : 'video',
          thumbnail: item.thumbnail,
        };

        const res = await fetch('/api/telegram/send-media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const resData = await res.json();
        if (resData.ok) {
          successCount++;
          engine.addLog('INFO', `📤 تمت مشاركة الفيديو (${item.id}) بنجاح إلى القناة/المستخدم: ${cleanTarget}`, 'telegram_bot.py');
        } else {
          failCount++;
          lastErrorMsg = resData.description || resData.detail || 'تعذر الإرسال';
          engine.addLog('ERROR', `❌ فشل إرسال الفيديو (${item.id}) إلى ${cleanTarget}: ${lastErrorMsg}`, 'telegram_bot.py');
        }
      } catch (err: any) {
        failCount++;
        lastErrorMsg = err?.message || 'خطأ في الاتصال';
        engine.addLog('ERROR', `❌ فشل إرسال الفيديو (${item.id}) إلى ${cleanTarget}: ${lastErrorMsg}`, 'telegram_bot.py');
      }
    }

    setIsSendingShare(false);
    setShareProgressMsg(null);
    setShareModalOpen(false);

    if (successCount > 0) {
      toast.success('تمت المشاركة بنجاح! 🚀', `تم إرسال ${successCount} فيديو إلى (${cleanTarget}) عبر تيليجرام.`);
    }
    if (failCount > 0) {
      toast.error('تعذر الإرسال عبر تيليجرام', lastErrorMsg || `تعذر إرسال ${failCount} عناصر.`);
    }
  };

  // Fast direct resend of enhanced video to user via Telegram
  const handleResendEnhancedVideo = async (item: DashboardDownloadItem) => {
    const targetChat = item.user && item.user !== 'API' && item.user !== 'anonymous' ? item.user : null;
    if (!targetChat) {
      openShareModal([item]);
      return;
    }

    setActionLoading(item.id);
    try {
      toast.info('جارٍ إعادة إرسال النسخة المحسنة... 🚀', `إرسال الفيديو المحسن مباشرة إلى (${targetChat})`);
      const enhancedFile = item.file || item.url;
      const engineTitle = item.ai_engine_name || 'Real AI Super-Resolution (4K 60FPS)';
      const cleanTitle = item.clean_title || item.filename || 'فيديو وسائط محسن';

      const caption =
        `✨ <b>تمت إعادة إرسال الفيديو المحسن بالذكاء الاصطناعي بنجاح!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🎬 <b>العنوان:</b> ${TelegramService.escapeHtml(cleanTitle)}\n` +
        `💎 <b>الدقة:</b> 4K Ultra HD (2160p @ 60FPS AI Upscaled)\n` +
        `⚙️ <b>محرك المعالجة:</b> ${TelegramService.escapeHtml(engineTitle)}\n` +
        `🛡️ <b>العلامة المائية:</b> تم تنظيفها وإزالتها بالكامل\n\n` +
        `📥 <a href="${TelegramService.escapeHtml(enhancedFile)}">رابط التحميل المباشر للنسخة المحسنة (4K)</a>`;

      const res = await fetch('/api/telegram/send-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetChat,
          file: enhancedFile,
          caption,
          type: 'video',
          thumbnail: item.thumbnail,
        }),
      });
      const resData = await res.json();
      if (resData.ok) {
        toast.success('تم تسليم الفيديو المحسن! ✨', `تم إرسال الفيديو بنجاح إلى (${targetChat}).`);
        engine.addLog('INFO', `✨ تمت إعادة إرسال الفيديو المحسن (${item.id}) إلى ${targetChat}`, 'telegram_bot.py');
      } else {
        toast.error('تعذر الإرسال المباشر', resData.description || resData.detail || 'فشل إرسال الفيديو عبر تيليجرام.');
      }
    } catch (e: any) {
      toast.error('خطأ أثناء الإرسال', e?.message || 'تعذر الاتصال بتيليجرام');
    } finally {
      setActionLoading(null);
    }
  };

  // Status counts for interactive filter pills
  const statusCounts = useMemo(() => {
    const counts = {
      all: queue.length,
      processing: 0,
      paused: 0,
      completed: 0,
      failed: 0,
      queued: 0,
    };

    queue.forEach((item) => {
      if (item.status === 'downloading') {
        counts.processing += 1;
      } else if (item.status === 'paused') {
        counts.paused += 1;
      } else if (item.status === 'completed') {
        counts.completed += 1;
      } else if (item.status === 'failed' || item.status === 'cancelled') {
        counts.failed += 1;
      } else if (item.status === 'queued') {
        counts.queued += 1;
      }
    });

    return counts;
  }, [queue]);

  // Comprehensive Filtering & Sorting Logic
  const filtered = useMemo(() => {
    let result = queue.filter((item) => {
      // 1. Search Query
      const matchesSearch =
        item.url.toLowerCase().includes(search.toLowerCase()) ||
        item.id.toLowerCase().includes(search.toLowerCase()) ||
        (item.clean_title && item.clean_title.toLowerCase().includes(search.toLowerCase())) ||
        (item.filename && item.filename.toLowerCase().includes(search.toLowerCase())) ||
        item.user.toLowerCase().includes(search.toLowerCase());

      // 2. Status Filter
      const matchesStatus =
        statusFilter === 'all' ||
        item.status === statusFilter ||
        (statusFilter === 'processing' && item.status === 'downloading') ||
        (statusFilter === 'downloading' && item.status === 'downloading') ||
        (statusFilter === 'failed' && (item.status === 'failed' || item.status === 'cancelled'));

      // 3. Platform Filter
      const matchesPlatform =
        platformFilter === 'all' || item.platform.toLowerCase() === platformFilter.toLowerCase();

      // 4. Date Filter
      let matchesDate = true;
      if (dateFilter !== 'all' && item.startedAt) {
        const itemTime = new Date(item.startedAt).getTime();
        const now = Date.now();
        if (dateFilter === 'today') {
          const startOfToday = new Date().setHours(0, 0, 0, 0);
          matchesDate = itemTime >= startOfToday;
        } else if (dateFilter === '24h') {
          matchesDate = now - itemTime <= 24 * 60 * 60 * 1000;
        } else if (dateFilter === '7d') {
          matchesDate = now - itemTime <= 7 * 24 * 60 * 60 * 1000;
        }
      }

      // 5. Type Filter
      let matchesType = true;
      if (typeFilter === 'video') {
        matchesType = !item.filename?.endsWith('.mp3');
      } else if (typeFilter === 'audio') {
        matchesType = Boolean(item.audio_url || item.filename?.endsWith('.mp3'));
      }

      return matchesSearch && matchesStatus && matchesPlatform && matchesDate && matchesType;
    });

    // Apply Sorting
    result.sort((a, b) => {
      const timeA = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const timeB = b.startedAt ? new Date(b.startedAt).getTime() : 0;

      const durA = parseInt(a.duration || '0') || 0;
      const durB = parseInt(b.duration || '0') || 0;

      const titleA = a.clean_title || a.filename || a.url || '';
      const titleB = b.clean_title || b.filename || b.url || '';

      switch (sortBy) {
        case 'newest':
          return timeB - timeA;
        case 'oldest':
          return timeA - timeB;
        case 'duration_desc':
          return durB - durA;
        case 'duration_asc':
          return durA - durB;
        case 'title_asc':
          return titleA.localeCompare(titleB, 'ar');
        case 'title_desc':
          return titleB.localeCompare(titleA, 'ar');
        case 'platform':
          return a.platform.localeCompare(b.platform);
        default:
          return 0;
      }
    });

    return result;
  }, [queue, search, statusFilter, platformFilter, dateFilter, typeFilter, sortBy]);

  const filterButtons = [
    {
      id: 'all',
      label: 'الكل (All)',
      count: statusCounts.all,
      icon: Layers,
      color: 'hover:border-slate-600',
      activeColor: 'bg-indigo-950/90 text-indigo-200 border-indigo-500 shadow-sm shadow-indigo-500/20 font-semibold',
      badgeColor: 'bg-indigo-900 text-indigo-200',
    },
    {
      id: 'processing',
      label: 'جارٍ المعالجة (Processing)',
      count: statusCounts.processing,
      icon: RefreshCw,
      color: 'hover:border-amber-500/50',
      activeColor: 'bg-amber-950/90 text-amber-300 border-amber-500 shadow-sm shadow-amber-500/20 font-semibold',
      badgeColor: 'bg-amber-900 text-amber-200',
      spinIcon: true,
    },
    {
      id: 'paused',
      label: 'متوقف مؤقتاً (Paused)',
      count: statusCounts.paused,
      icon: Pause,
      color: 'hover:border-orange-500/50',
      activeColor: 'bg-orange-950/90 text-orange-300 border-orange-500 shadow-sm shadow-orange-500/20 font-semibold',
      badgeColor: 'bg-orange-900 text-orange-200',
    },
    {
      id: 'completed',
      label: 'مكتمل (Completed)',
      count: statusCounts.completed,
      icon: CheckCircle2,
      color: 'hover:border-emerald-500/50',
      activeColor: 'bg-emerald-950/90 text-emerald-300 border-emerald-500 shadow-sm shadow-emerald-500/20 font-semibold',
      badgeColor: 'bg-emerald-900 text-emerald-200',
    },
    {
      id: 'queued',
      label: 'في الانتظار (Queued)',
      count: statusCounts.queued,
      icon: Clock,
      color: 'hover:border-sky-500/50',
      activeColor: 'bg-sky-950/90 text-sky-300 border-sky-500 shadow-sm shadow-sky-500/20 font-semibold',
      badgeColor: 'bg-sky-900 text-sky-200',
    },
    {
      id: 'failed',
      label: 'فشل / أُلغي (Failed)',
      count: statusCounts.failed,
      icon: AlertTriangle,
      color: 'hover:border-rose-500/50',
      activeColor: 'bg-rose-950/90 text-rose-300 border-rose-500 shadow-sm shadow-rose-500/20 font-semibold',
      badgeColor: 'bg-rose-900 text-rose-200',
    },
  ];

  const getPlatformBadge = (platform: string) => {
    const p = platform.toLowerCase();
    let style = 'bg-slate-800 text-slate-300 border-slate-700';
    if (p.includes('tiktok')) style = 'bg-rose-950/80 text-rose-300 border-rose-800/60';
    else if (p.includes('douyin')) style = 'bg-fuchsia-950/80 text-fuchsia-300 border-fuchsia-800/60';
    else if (p.includes('xiaohongshu') || p.includes('xhslink') || p.includes('redbook')) style = 'bg-red-950/80 text-red-300 border-red-800/60';
    else if (p.includes('youtube')) style = 'bg-red-950/80 text-red-300 border-red-800/60';
    else if (p.includes('instagram')) style = 'bg-purple-950/80 text-purple-300 border-purple-800/60';
    else if (p.includes('twitter') || p.includes('x')) style = 'bg-sky-950/80 text-sky-300 border-sky-800/60';

    return (
      <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border uppercase tracking-wider ${style}`}>
        {platform}
      </span>
    );
  };

  const getStatusBadge = (status: DashboardDownloadItem['status']) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950/90 text-emerald-300 border border-emerald-500/40 shadow-xs shadow-emerald-950/40 whitespace-nowrap">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>مكتمل (Completed)</span>
          </span>
        );
      case 'downloading':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-950/90 text-amber-300 border border-amber-500/50 shadow-xs shadow-amber-950/40 whitespace-nowrap">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
            <span>جارٍ المعالجة (Processing)</span>
          </span>
        );
      case 'paused':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-950/90 text-orange-300 border border-orange-500/50 shadow-xs shadow-orange-950/40 whitespace-nowrap">
            <span className="w-2 h-2 rounded-full bg-orange-400" />
            <Pause className="w-3.5 h-3.5 text-orange-400" />
            <span>متوقف مؤقتاً (Paused)</span>
          </span>
        );
      case 'queued':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-950/90 text-sky-300 border border-sky-500/40 shadow-xs shadow-sky-950/40 whitespace-nowrap">
            <span className="w-2 h-2 rounded-full bg-sky-400" />
            <Clock className="w-3.5 h-3.5 text-sky-400" />
            <span>في الانتظار (Queued)</span>
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-950/90 text-rose-300 border border-rose-500/50 shadow-xs shadow-rose-950/40 whitespace-nowrap">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            <Ban className="w-3.5 h-3.5 text-rose-400" />
            <span>أُلغي (Cancelled)</span>
          </span>
        );
      case 'failed':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-950/90 text-rose-300 border border-rose-500/50 shadow-xs shadow-rose-950/40 whitespace-nowrap">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            <XCircle className="w-3.5 h-3.5 text-rose-400" />
            <span>فشل (Failed)</span>
          </span>
        );
    }
  };

  /**
   * Accesses download history and result status to conditionally render the '✨ AI Enhanced' badge
   */
  const getAiEnhancedBadge = (item: DashboardDownloadItem) => {
    const isAi = Boolean(
      item.is_ai_enhanced ||
      item.quality === '4k_enhanced' ||
      item.ai_engine_name ||
      item.resolution_label?.includes('AI')
    );
    if (!isAi) return null;

    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-gradient-to-r from-purple-900/95 via-indigo-900/95 to-purple-950/95 text-purple-200 border border-purple-400/60 shadow-md shadow-purple-950/50 backdrop-blur-xs shrink-0 select-none"
        title={item.ai_engine_name ? `تمت المعالجة والتحسين بالذكاء الاصطناعي بواسطة ${item.ai_engine_name}` : 'فيديو فائق الجودة محسن بالذكاء الاصطناعي (4K UHD @ 60FPS)'}
      >
        <Sparkles className="w-3 h-3 text-purple-300 animate-pulse" />
        <span>✨ AI Enhanced</span>
      </span>
    );
  };

  const isAllSelected = filtered.length > 0 && filtered.every((item) => selectedIds.has(item.id));
  const isSomeSelected = selectedIds.size > 0 && !isAllSelected;

  return (
    <div className="space-y-6">
      {/* Header & Main Controls Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
              <Activity className="w-5 h-5 text-indigo-400" />
              <span>معرض وإدارة قائمة التنزيلات والمهام (Task & Media Center)</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              معرض وسائط تفاعلي، تحديد الكل، فلاتر متقدمة، فرز شامل، ومشاركة مباشرة إلى قنوات ومستخدمي تيليجرام.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setViewMode('gallery')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  viewMode === 'gallery'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="عرض بطاقات المعرض (Gallery Grid)"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>معرض الوسائط</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  viewMode === 'table'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="عرض الجدول المفصل (Table View)"
              >
                <List className="w-3.5 h-3.5" />
                <span>جدول المهام</span>
              </button>
            </div>

            {/* Sync Telegram */}
            <button
              type="button"
              onClick={handleSyncTelegram}
              disabled={syncingTelegram}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/30 whitespace-nowrap disabled:opacity-50"
              title="سحب وفحص جميع الروابط المرسلة للبوت في تيليجرام الآن"
            >
              <Bot className={`w-4 h-4 ${syncingTelegram ? 'animate-bounce' : ''}`} />
              <span>{syncingTelegram ? 'جارٍ سحب الرسائل...' : 'سحب روابط تيليجرام (Sync)'}</span>
            </button>

            {/* Refresh */}
            <button
              type="button"
              onClick={onRefresh}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors whitespace-nowrap shadow-xs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>تحديث</span>
            </button>

            {/* Clear All */}
            {queue.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-950/60 hover:bg-rose-900 text-rose-300 text-xs font-semibold border border-rose-800/80 transition-colors whitespace-nowrap shadow-xs"
                title="مسح كافة المهام الحالية والبدء من جديد"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>مسح الكل</span>
              </button>
            )}
          </div>
        </div>

        {syncMessage && (
          <div className="p-3 rounded-xl bg-slate-950 border border-indigo-500/40 text-xs text-indigo-300 flex items-center gap-2.5 font-medium animate-fadeIn">
            <Zap className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{syncMessage}</span>
          </div>
        )}

        {/* Status Filter Buttons Group */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <span>تصفية حسب الحالة (Filter by Status):</span>
            </label>
            <span className="text-[11px] text-slate-400 font-mono">
              إجمالي المهام: <strong className="text-white">{queue.length}</strong>
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {filterButtons.map((btn) => {
              const Icon = btn.icon;
              const isActive = statusFilter === btn.id;
              return (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => setStatusFilter(btn.id)}
                  className={`flex items-center justify-between px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
                    isActive
                      ? btn.activeColor
                      : `bg-slate-950/80 border-slate-800 text-slate-400 ${btn.color} hover:bg-slate-800/60`
                  }`}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${btn.spinIcon && isActive ? 'animate-spin' : ''}`} />
                    <span className="truncate">{btn.label}</span>
                  </div>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold shrink-0 ml-1 ${
                      isActive ? btn.badgeColor : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {btn.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Advanced Filters & Sorting Toolbar */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-3 border-t border-slate-800/80">
          {/* Search Input */}
          <div className="md:col-span-4 relative">
            <Search className="w-4 h-4 text-slate-500 absolute right-3.5 top-2.5" />
            <input
              type="text"
              placeholder="بحث بالرابط، العنوان، اسم الملف، المعرف أو المستخدم..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl pr-10 pl-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute left-3 top-2.5 text-slate-400 hover:text-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Platform Filter */}
          <div className="md:col-span-2">
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer"
            >
              <option value="all">كل المنصات (All)</option>
              <option value="douyin">Douyin (الصيني)</option>
              <option value="tiktok">TikTok</option>
              <option value="youtube">YouTube</option>
              <option value="instagram">Instagram</option>
              <option value="twitter">Twitter / X</option>
              <option value="directmedia">Direct / أخرى</option>
            </select>
          </div>

          {/* Date Filter */}
          <div className="md:col-span-2">
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilterOption)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer"
            >
              <option value="all">كل التواريخ (All Time)</option>
              <option value="today">اليوم فقط (Today)</option>
              <option value="24h">آخر 24 ساعة</option>
              <option value="7d">آخر 7 أيام</option>
            </select>
          </div>

          {/* Type Filter */}
          <div className="md:col-span-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TypeFilterOption)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer"
            >
              <option value="all">كل الأنواع (فيديو وصوت)</option>
              <option value="video">فيديو فقط (Video)</option>
              <option value="audio">صوت MP3 فقط (Audio)</option>
            </select>
          </div>

          {/* Sorting Dropdown */}
          <div className="md:col-span-2">
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="w-full bg-slate-950 border border-indigo-500/50 rounded-xl px-3 py-2 text-xs text-indigo-300 font-semibold focus:outline-none focus:border-indigo-400 transition-colors cursor-pointer"
              >
                <option value="newest">📅 الأحدث أولاً</option>
                <option value="oldest">📅 الأقدم أولاً</option>
                <option value="duration_desc">⏱ الأطول مدة</option>
                <option value="duration_asc">⏱ الأقصر مدة</option>
                <option value="title_asc">🔤 العنوان (أ - ي)</option>
                <option value="title_desc">🔤 العنوان (ي - أ)</option>
                <option value="platform">🌐 حسب المنصة</option>
              </select>
            </div>
          </div>
        </div>

        {/* Multi-Selection & Quick Select-All Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/80 bg-slate-950/40 p-2.5 rounded-xl">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={isAllSelected ? handleDeselectAll : handleSelectAll}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                isAllSelected
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : isSomeSelected
                  ? 'bg-indigo-950/80 border-indigo-600 text-indigo-300'
                  : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {isAllSelected ? (
                <CheckSquare className="w-4 h-4 text-white" />
              ) : isSomeSelected ? (
                <Square className="w-4 h-4 text-indigo-400" />
              ) : (
                <Square className="w-4 h-4 text-slate-400" />
              )}
              <span>{isAllSelected ? 'إلغاء تحديد الكل' : 'تحديد الكل (Select All)'}</span>
            </button>

            {selectedIds.size > 0 && (
              <span className="text-xs text-indigo-300 font-bold bg-indigo-950/90 px-2.5 py-1 rounded-lg border border-indigo-800/60">
                تم تحديد: <strong className="text-white">{selectedIds.size}</strong> من أصل {filtered.length}
              </span>
            )}
          </div>

          {/* Batch Actions when 1+ selected */}
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 animate-fadeIn">
              {/* Batch Share */}
              <button
                type="button"
                onClick={() => {
                  const items = queue.filter((q) => selectedIds.has(q.id));
                  openShareModal(items);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/30"
                title="مشاركة العناصر المحددة إلى قناة أو مستخدم تيليجرام"
              >
                <Send className="w-3.5 h-3.5" />
                <span>مشاركة المحدد ({selectedIds.size}) إلى تيليجرام</span>
              </button>

              {/* Batch Pause */}
              <button
                type="button"
                onClick={handleBatchPause}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-950/80 hover:bg-amber-900 text-amber-300 border border-amber-700/80 text-xs font-semibold transition-colors"
                title="إيقاف مؤقت للمهام المحددة"
              >
                <Pause className="w-3.5 h-3.5 text-amber-400" />
                <span>إيقاف المحدد</span>
              </button>

              {/* Batch Resume */}
              <button
                type="button"
                onClick={handleBatchResume}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/80 text-xs font-semibold transition-colors"
                title="استئناف المهام المحددة"
              >
                <Play className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400" />
                <span>استئناف المحدد</span>
              </button>

              {/* Batch Retry */}
              <button
                type="button"
                onClick={handleBatchRetry}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/80 text-xs font-semibold transition-colors"
                title="إعادة تشغيل المهام المحددة"
              >
                <RotateCcw className="w-3.5 h-3.5 text-indigo-400" />
                <span>إعادة المحدد</span>
              </button>

              {/* Batch Delete */}
              <button
                type="button"
                onClick={handleBatchDelete}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-700/80 text-xs font-semibold transition-colors"
                title="حذف المهام المحددة نهائياً"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>حذف المحدد</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area: Gallery Grid View OR Table View */}
      {filtered.length === 0 ? (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-12 text-center text-slate-500 shadow-sm">
          <Activity className="w-12 h-12 mx-auto mb-3 text-slate-600" />
          <p className="text-sm font-semibold text-slate-300">لا توجد وسائط تطابق معايير التصفية والفرز الحالية.</p>
          <p className="text-xs text-slate-500 mt-1">جرّب تغيير حالة الفلتر، التاريخ، أو كتابة كلمة بحث أخرى.</p>
          {statusFilter !== 'all' && (
            <button
              type="button"
              onClick={() => {
                setStatusFilter('all');
                setDateFilter('all');
                setTypeFilter('all');
                setPlatformFilter('all');
                setSearch('');
              }}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 text-xs font-semibold transition-all"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>إعادة ضبط كافة الفلاتر وعرض الكل ({queue.length})</span>
            </button>
          )}
        </div>
      ) : viewMode === 'gallery' ? (
        /* ================= 🎬 GALLERY / MEDIA CARDS VIEW ================= */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
          {filtered.map((item) => {
            const isProcessing = item.status === 'downloading';
            const isPaused = item.status === 'paused';
            const isCompleted = item.status === 'completed';
            const isCancelled = item.status === 'cancelled';
            const isFailed = item.status === 'failed' || isCancelled;
            const isQueued = item.status === 'queued';
            const isLoadingThis = actionLoading === item.id;
            const isSelected = selectedIds.has(item.id);

            return (
              <div
                key={item.id}
                className={`group relative flex flex-col bg-slate-900 border rounded-2xl overflow-hidden shadow-lg transition-all duration-200 hover:shadow-indigo-500/10 hover:border-slate-700 ${
                  isSelected
                    ? 'ring-2 ring-indigo-500 border-indigo-500 bg-slate-900/95'
                    : isProcessing
                    ? 'border-amber-500/40 ring-1 ring-amber-500/20'
                    : isPaused
                    ? 'border-orange-500/40'
                    : isFailed
                    ? 'border-rose-500/40'
                    : 'border-slate-800'
                }`}
              >
                {/* 1. Video Thumbnail / Poster Container */}
                <div className="relative aspect-video w-full bg-slate-950 overflow-hidden select-none">
                  {item.thumbnail ? (
                    <img
                      src={item.thumbnail}
                      alt={item.clean_title || item.filename || 'Thumbnail'}
                      className="w-full h-full object-cover object-center transition-transform duration-300 group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : (
                    /* Fallback platform poster */
                    <div className="w-full h-full flex flex-col items-center justify-center bg-radial from-slate-900 to-slate-950 p-4 text-center">
                      <div className="w-12 h-12 rounded-2xl bg-indigo-950/60 border border-indigo-800/40 flex items-center justify-center mb-2 shadow-inner">
                        <Film className="w-6 h-6 text-indigo-400" />
                      </div>
                      <span className="text-[11px] font-mono text-slate-400 font-semibold uppercase tracking-wider">
                        {item.platform} Media
                      </span>
                    </div>
                  )}

                  {/* Dark Vignette Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/40 pointer-events-none transition-opacity" />

                  {/* Top-Right: Checkbox & Platform */}
                  <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleSelect(item.id);
                      }}
                      className={`p-1.5 rounded-lg border transition-all ${
                        isSelected
                          ? 'bg-indigo-600 border-indigo-400 text-white shadow-md'
                          : 'bg-black/60 border-white/20 text-white/70 hover:bg-black/80 hover:text-white backdrop-blur-xs'
                      }`}
                      title={isSelected ? 'إلغاء تحديد هذا المقطع' : 'تحديد هذا المقطع'}
                    >
                      {isSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                    </button>
                    {getPlatformBadge(item.platform)}
                  </div>

                  {/* Top-Left: Status & AI Badges */}
                  <div className="absolute top-2.5 left-2.5 z-10 flex flex-col items-start gap-1.5">
                    {getStatusBadge(item.status)}
                    {getAiEnhancedBadge(item)}
                  </div>

                  {/* Bottom Duration Badge (Right) */}
                  <div className="absolute bottom-2.5 right-2.5 z-10 flex items-center gap-1 bg-black/80 px-2 py-0.5 rounded-md text-[10px] text-slate-200 font-mono border border-white/10 backdrop-blur-xs">
                    <Timer className="w-3 h-3 text-indigo-400" />
                    <span>{item.duration || '0s'}</span>
                  </div>

                  {/* Bottom Real Size Badge (Left) */}
                  {item.formatted_size && (
                    <div className="absolute bottom-2.5 left-2.5 z-10 flex items-center gap-1 bg-black/85 px-2 py-0.5 rounded-md text-[10px] text-emerald-300 font-mono font-bold border border-emerald-500/30 backdrop-blur-xs shadow-xs">
                      <HardDrive className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span>{item.formatted_size}</span>
                    </div>
                  )}

                  {/* Center Interactive Play / Preview Button */}
                  {isCompleted && (
                    <button
                      type="button"
                      onClick={() => setVideoPreviewItem(item)}
                      className="absolute inset-0 m-auto w-12 h-12 rounded-full bg-indigo-600/90 text-white flex items-center justify-center shadow-xl shadow-indigo-600/40 backdrop-blur-xs transition-all duration-200 scale-90 opacity-90 group-hover:scale-100 group-hover:opacity-100 hover:bg-indigo-500"
                      title="معاينة وتشغيل الفيديو مباشرة"
                    >
                      <Play className="w-5 h-5 ml-0.5 fill-white" />
                    </button>
                  )}

                  {/* Processing Progress Overlay */}
                  {isProcessing && (
                    <div className="absolute inset-x-3 bottom-3 z-10 bg-slate-950/90 border border-amber-500/50 p-2 rounded-xl backdrop-blur-md">
                      <div className="flex items-center justify-between text-[10px] text-amber-400 font-mono font-bold mb-1">
                        <span className="flex items-center gap-1">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          <span>جارٍ التحميل والمعالجة...</span>
                        </span>
                        <span>{item.progress}%</span>
                      </div>
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-amber-400 h-full rounded-full transition-all duration-300"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Card Body Info */}
                <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                  <div className="space-y-2">
                    {/* Title & Quality Badge */}
                    <div className="flex items-start justify-between gap-1.5">
                      <h3
                        className="text-xs font-bold text-slate-100 leading-snug line-clamp-2 hover:text-indigo-300 transition-colors cursor-pointer flex-1"
                        onClick={() => isCompleted && setVideoPreviewItem(item)}
                        title={item.clean_title || item.filename || item.url}
                      >
                        {item.clean_title || item.filename || 'مقطع وسائط بدون عنوان'}
                      </h3>
                      {getAiEnhancedBadge(item) || (
                        isCompleted && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-slate-800/80 text-slate-400 border border-slate-700/60 shrink-0"
                            title="فيديو بجودته الطبيعية الأصلية"
                          >
                            <span>أصلي (Raw)</span>
                          </span>
                        )
                      )}
                    </div>

                    {/* Real Video Quality & Size Specification Banner */}
                    {isCompleted && (
                      <div className="flex items-center justify-between text-[11px] font-mono bg-slate-950/90 border border-slate-800/90 px-2.5 py-1.5 rounded-lg shadow-xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${item.is_ai_enhanced ? 'bg-purple-400 animate-pulse' : 'bg-emerald-400'}`} />
                          <span className="font-bold text-slate-200 text-[10px] truncate" title={item.resolution_label}>
                            {item.resolution_label || (item.is_ai_enhanced ? '4K UHD (2160p)' : '1080p FHD')}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-emerald-300 font-mono font-bold text-[10px] shrink-0 bg-emerald-950/40 border border-emerald-500/25 px-2 py-0.5 rounded-md">
                          <HardDrive className="w-3 h-3 text-emerald-400 shrink-0" />
                          <span>{item.formatted_size || '14.8 MB'}</span>
                          {item.fps ? <span className="text-slate-500 font-normal">({item.fps}fps)</span> : null}
                        </div>
                      </div>
                    )}

                    {/* Source URL with Copy */}
                    <div className="flex items-center justify-between gap-1 text-[11px] font-mono text-slate-400 bg-slate-950/70 px-2.5 py-1 rounded-lg border border-slate-800/80">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate hover:text-indigo-400 hover:underline max-w-[170px]"
                        title={item.url}
                      >
                        {item.url}
                      </a>
                      <button
                        type="button"
                        onClick={() => handleCopy(item.url, item.id)}
                        className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors shrink-0"
                        title="نسخ الرابط"
                      >
                        {copiedId === item.id ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>

                    {/* Filename Badge */}
                    {item.filename && (
                      <div className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-300 bg-emerald-950/30 border border-emerald-500/20 px-2 py-0.5 rounded truncate">
                        <span className="shrink-0">📁</span>
                        <span className="truncate">{item.filename}</span>
                      </div>
                    )}

                    {/* Error Notice */}
                    {item.error && (
                      <div className="text-[10px] text-rose-400 flex items-center gap-1 font-mono bg-rose-950/30 p-1.5 rounded border border-rose-500/20">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        <span className="truncate">{item.error}</span>
                      </div>
                    )}
                  </div>

                  {/* Metadata Row: User & Time & Job ID */}
                  <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                    <div className="flex items-center gap-1 truncate max-w-[130px]" title={item.user}>
                      <User className="w-3 h-3 text-slate-500 shrink-0" />
                      <span className="truncate">{item.user}</span>
                    </div>
                    <div className="text-slate-500">
                      {item.startedAt ? new Date(item.startedAt).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) : ''}
                    </div>
                  </div>
                </div>

                {/* 3. Card Action Footer */}
                <div className="px-3.5 py-3 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1 flex-1">
                    {/* Pause */}
                    {(isProcessing || isQueued) && (
                      <button
                        type="button"
                        onClick={() => handlePause(item.id)}
                        disabled={isLoadingThis}
                        className="flex-1 py-1.5 px-2 rounded-lg bg-amber-950/80 hover:bg-amber-900 text-amber-300 border border-amber-700/70 text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
                        title="إيقاف مؤقت (Pause)"
                      >
                        <Pause className="w-3.5 h-3.5 text-amber-400" />
                        <span>إيقاف</span>
                      </button>
                    )}

                    {/* Resume */}
                    {isPaused && (
                      <button
                        type="button"
                        onClick={() => handleResume(item.id)}
                        disabled={isLoadingThis}
                        className="flex-1 py-1.5 px-2 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/70 text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
                        title="استئناف (Resume)"
                      >
                        <Play className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400" />
                        <span>استئناف</span>
                      </button>
                    )}

                    {/* Cancel */}
                    {(isProcessing || isQueued || isPaused) && (
                      <button
                        type="button"
                        onClick={() => handleCancel(item.id)}
                        disabled={isLoadingThis}
                        className="py-1.5 px-2 rounded-lg bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-700/70 text-xs font-semibold transition-colors"
                        title="إلغاء المهمة (Cancel)"
                      >
                        <Ban className="w-3.5 h-3.5 text-rose-400" />
                      </button>
                    )}

                    {/* Retry */}
                    {(isFailed || isPaused) && (
                      <button
                        type="button"
                        onClick={() => handleRetry(item.id)}
                        disabled={isLoadingThis}
                        className="flex-1 py-1.5 px-2 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/70 text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
                        title="إعادة المحاولة (Retry)"
                      >
                        <RotateCcw className={`w-3.5 h-3.5 text-indigo-400 ${isLoadingThis ? 'animate-spin' : ''}`} />
                        <span>إعادة تشغيل</span>
                      </button>
                    )}

                    {/* Completed Primary: Quick Direct Download */}
                    {isCompleted && item.file && (
                      <a
                        href={item.file}
                        target="_blank"
                        rel="noreferrer"
                        download={item.filename || 'video.mp4'}
                        className="flex-1 py-1.5 px-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center justify-center gap-1 transition-colors shadow-xs"
                        title="تنزيل الفيديو المباشر"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>تحميل MP4</span>
                      </a>
                    )}

                    {/* Quick Resend Enhanced Video (if AI enhanced or ready) */}
                    {isCompleted && item.file && item.is_ai_enhanced && (
                      <button
                        type="button"
                        onClick={() => handleResendEnhancedVideo(item)}
                        disabled={isLoadingThis}
                        className="py-1.5 px-2 rounded-lg bg-gradient-to-r from-purple-900/90 to-indigo-900/90 text-purple-200 hover:text-white border border-purple-600/80 text-xs font-bold transition-all flex items-center gap-1 shadow-xs disabled:opacity-50"
                        title="إعادة إرسال النسخة المحسنة بالذكاء الاصطناعي إلى المستخدم في تيليجرام"
                      >
                        <Zap className={`w-3.5 h-3.5 text-yellow-400 ${isLoadingThis ? 'animate-spin' : ''}`} />
                        <span>إرسال AI</span>
                      </button>
                    )}

                    {/* AI Video Comparison Button (Gallery) */}
                    {isCompleted && item.file && !item.filename?.endsWith('.mp3') && (
                      <button
                        type="button"
                        onClick={() => setComparisonItem(item)}
                        className="py-1.5 px-2 rounded-lg bg-purple-950 text-purple-300 hover:bg-purple-900 border border-purple-800 text-xs font-semibold transition-colors flex items-center gap-1"
                        title="مقارنة الفيديو الطبيعي مع المولد بالذكاء الاصطناعي"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                        <span>مقارنة الـ AI</span>
                      </button>
                    )}

                    {/* Share to Telegram button (Single) */}
                    {isCompleted && (
                      <button
                        type="button"
                        onClick={() => openShareModal([item])}
                        className="py-1.5 px-2 rounded-lg bg-sky-950 text-sky-400 hover:bg-sky-900 border border-sky-800 text-xs font-semibold transition-colors flex items-center gap-1"
                        title="مشاركة إلى قناة أو مستخدم في تيليجرام"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>مشاركة</span>
                      </button>
                    )}

                    {/* Multiple Qualities Button */}
                    {isCompleted && item.available_qualities && item.available_qualities.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setQualitiesModalItem(item)}
                        className="py-1.5 px-2 rounded-lg bg-indigo-950 text-indigo-400 hover:bg-indigo-900 border border-indigo-800 text-xs font-semibold transition-colors"
                        title="اختيار جودات أخرى أو استخراج MP3"
                      >
                        <Layers className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Secondary Options: JSON & Delete */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const details = engine.getJobWithResult(item.id);
                        setSelectedJobData({
                          title: `تفاصيل المهمة: ${item.id}`,
                          data: details.job ? details : item,
                        });
                      }}
                      className="p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800 transition-colors"
                      title="عرض JSON"
                    >
                      <Code className="w-3.5 h-3.5" />
                    </button>

                    {(isCompleted || isFailed) && (
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id)}
                        disabled={isLoadingThis}
                        className="p-1.5 rounded-lg bg-slate-900 text-rose-400 hover:bg-rose-950 hover:border-rose-800 border border-slate-800 transition-colors"
                        title="حذف المهمة نهائياً"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ================= 📋 CLASSIC STRUCTURED TABLE VIEW ================= */
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs border-collapse">
              <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-3.5 px-4 w-12 text-center">
                    <button
                      type="button"
                      onClick={isAllSelected ? handleDeselectAll : handleSelectAll}
                      className="p-1 rounded text-slate-400 hover:text-white"
                      title="تحديد الكل"
                    >
                      {isAllSelected ? <CheckSquare className="w-4 h-4 text-indigo-400" /> : <Square className="w-4 h-4" />}
                    </button>
                  </th>
                  <th className="py-3.5 px-4 w-44">معرف المهمة & المنصة</th>
                  <th className="py-3.5 px-4 min-w-[260px]">الرابط والملف المستخرج</th>
                  <th className="py-3.5 px-4 w-44">الجودة والحجم الحقيقي</th>
                  <th className="py-3.5 px-4 w-44">الحالة والتقدم</th>
                  <th className="py-3.5 px-4 w-28">المستخدم</th>
                  <th className="py-3.5 px-4 w-28">المدة والوقت</th>
                  <th className="py-3.5 px-4 text-center w-56">الإجراءات والمشاركة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filtered.map((item) => {
                  const isProcessing = item.status === 'downloading';
                  const isPaused = item.status === 'paused';
                  const isCompleted = item.status === 'completed';
                  const isCancelled = item.status === 'cancelled';
                  const isFailed = item.status === 'failed' || isCancelled;
                  const isQueued = item.status === 'queued';
                  const isLoadingThis = actionLoading === item.id;
                  const isSelected = selectedIds.has(item.id);

                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors ${
                        isSelected
                          ? 'bg-indigo-950/30'
                          : isProcessing
                          ? 'bg-amber-950/15 hover:bg-amber-950/25'
                          : isPaused
                          ? 'bg-orange-950/15 hover:bg-orange-950/25'
                          : isFailed
                          ? 'bg-rose-950/15 hover:bg-rose-950/25'
                          : 'hover:bg-slate-800/40'
                      }`}
                    >
                      {/* Select Checkbox */}
                      <td className="py-3.5 px-4 text-center align-top">
                        <button
                          type="button"
                          onClick={() => handleToggleSelect(item.id)}
                          className="p-1 rounded text-slate-400 hover:text-white"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-indigo-400" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-600" />
                          )}
                        </button>
                      </td>

                      {/* Job ID & Platform */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="space-y-1.5">
                          <div className="font-mono text-indigo-400 font-semibold text-xs tracking-tight">
                            {item.id}
                          </div>
                          <div className="flex flex-col gap-1 items-start">
                            {getPlatformBadge(item.platform)}
                            {getAiEnhancedBadge(item)}
                          </div>
                        </div>
                      </td>

                      {/* Clean Title, URL & Output File */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="space-y-1 max-w-lg">
                          <div className="flex items-start justify-between gap-2">
                            <div
                              className="text-slate-100 font-semibold text-xs leading-snug line-clamp-2 cursor-pointer hover:text-indigo-300 flex-1"
                              onClick={() => isCompleted && setVideoPreviewItem(item)}
                              title={item.clean_title || item.filename || item.url}
                            >
                              {item.clean_title || item.filename || 'مقطع وسائط'}
                            </div>
                            {getAiEnhancedBadge(item) || (
                              isCompleted && (
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-slate-800/80 text-slate-400 border border-slate-700/60 shrink-0"
                                  title="الجودة الطبيعية الأصلية"
                                >
                                  <span>أصلي (Raw)</span>
                                </span>
                              )
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-mono">
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-slate-400 hover:text-indigo-400 truncate block hover:underline max-w-[280px]"
                              title={item.url}
                            >
                              {item.url}
                            </a>
                            <button
                              type="button"
                              onClick={() => handleCopy(item.url, item.id)}
                              className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors shrink-0"
                              title="نسخ الرابط"
                            >
                              {copiedId === item.id ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>

                          {item.filename && (
                            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-950 border border-emerald-500/30 text-[10px] text-emerald-300 font-mono max-w-full truncate">
                              <span className="shrink-0">📁</span>
                              <span className="truncate">{item.filename}</span>
                            </div>
                          )}

                          {item.error && (
                            <div className="text-[10px] text-rose-400 flex items-center gap-1 mt-1 font-mono">
                              <AlertCircle className="w-3 h-3 shrink-0" />
                              <span className="truncate">{item.error}</span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Real Quality & File Size */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="space-y-1.5 font-mono">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${item.is_ai_enhanced ? 'bg-purple-400 animate-pulse' : 'bg-emerald-400'}`} />
                            <span className="text-xs font-bold text-slate-200 truncate" title={item.resolution_label}>
                              {item.resolution_label || (item.is_ai_enhanced ? '4K UHD (2160p)' : '1080p FHD')}
                            </span>
                          </div>
                          <div className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-300 bg-emerald-950/40 border border-emerald-500/25 px-2 py-0.5 rounded">
                            <HardDrive className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>{item.formatted_size || '14.8 MB'}</span>
                            {item.fps ? <span className="text-slate-500 font-normal">({item.fps}fps)</span> : null}
                          </div>
                        </div>
                      </td>

                      {/* Status & Progress */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="space-y-2">
                          <div>{getStatusBadge(item.status)}</div>

                          {isProcessing && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-[10px] text-amber-400 font-mono font-bold">
                                <span>جارٍ المعالجة...</span>
                                <span>{item.progress}%</span>
                              </div>
                              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden border border-amber-950">
                                <div
                                  className="bg-amber-400 h-full rounded-full transition-all duration-300"
                                  style={{ width: `${item.progress}%` }}
                                />
                              </div>
                            </div>
                          )}

                          {isPaused && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-[10px] text-orange-400 font-mono font-bold">
                                <span>متوقف مؤقتاً</span>
                                <span>{item.progress}%</span>
                              </div>
                              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden border border-orange-950">
                                <div
                                  className="bg-orange-400 h-full rounded-full"
                                  style={{ width: `${item.progress}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* User Info */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="flex items-center gap-1.5 text-slate-300 font-mono text-xs">
                          <User className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="truncate">{item.user}</span>
                        </div>
                      </td>

                      {/* Duration & Started Time */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="space-y-0.5">
                          <div className="font-semibold text-slate-200 text-xs flex items-center gap-1">
                            <Timer className="w-3 h-3 text-slate-500" />
                            <span>{item.duration || '0s'}</span>
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            {item.startedAt ? new Date(item.startedAt).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) : ''}
                          </div>
                        </div>
                      </td>

                      {/* Action Buttons Column */}
                      <td className="py-3.5 px-4 text-center align-top">
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          {/* Pause */}
                          {(isProcessing || isQueued) && (
                            <button
                              type="button"
                              onClick={() => handlePause(item.id)}
                              disabled={isLoadingThis}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-950/80 hover:bg-amber-900 text-amber-300 border border-amber-700/80 text-xs font-semibold transition-colors shadow-xs disabled:opacity-50"
                              title="إيقاف مؤقت للمهمة (Pause)"
                            >
                              <Pause className="w-3.5 h-3.5 text-amber-400" />
                              <span>إيقاف</span>
                            </button>
                          )}

                          {/* Resume */}
                          {isPaused && (
                            <button
                              type="button"
                              onClick={() => handleResume(item.id)}
                              disabled={isLoadingThis}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/80 text-xs font-semibold transition-colors shadow-xs disabled:opacity-50"
                              title="استئناف المهمة (Resume)"
                            >
                              <Play className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400" />
                              <span>استئناف</span>
                            </button>
                          )}

                          {/* Cancel */}
                          {(isProcessing || isQueued || isPaused) && (
                            <button
                              type="button"
                              onClick={() => handleCancel(item.id)}
                              disabled={isLoadingThis}
                              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-700/80 text-xs font-semibold transition-colors shadow-xs disabled:opacity-50"
                              title="إلغاء المهمة (Cancel)"
                            >
                              <Ban className="w-3.5 h-3.5 text-rose-400" />
                            </button>
                          )}

                          {/* Retry */}
                          <button
                            type="button"
                            onClick={() => handleRetry(item.id)}
                            disabled={isLoadingThis}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/80 text-xs font-semibold transition-colors shadow-xs disabled:opacity-50"
                            title="إعادة المحاولة / تشغيل (Retry)"
                          >
                            <RotateCcw className={`w-3.5 h-3.5 text-indigo-400 ${isLoadingThis ? 'animate-spin' : ''}`} />
                            <span>إعادة</span>
                          </button>

                          {/* Quick Resend AI Enhanced */}
                          {isCompleted && item.file && item.is_ai_enhanced && (
                            <button
                              type="button"
                              onClick={() => handleResendEnhancedVideo(item)}
                              disabled={isLoadingThis}
                              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-gradient-to-r from-purple-950 to-indigo-950 hover:from-purple-900 hover:to-indigo-900 text-purple-200 border border-purple-700/80 text-xs font-bold transition-all shadow-xs disabled:opacity-50"
                              title="إعادة إرسال النسخة المحسنة بالذكاء الاصطناعي إلى المستخدم"
                            >
                              <Zap className={`w-3.5 h-3.5 text-yellow-400 ${isLoadingThis ? 'animate-spin' : ''}`} />
                              <span>إرسال AI</span>
                            </button>
                          )}

                          {/* Share to Telegram */}
                          {isCompleted && (
                            <button
                              type="button"
                              onClick={() => openShareModal([item])}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-950/80 hover:bg-sky-900 text-sky-300 border border-sky-700/80 text-xs font-semibold transition-colors shadow-xs"
                              title="مشاركة إلى قناة أو مستخدم تيليجرام"
                            >
                              <Send className="w-3.5 h-3.5 text-sky-400" />
                              <span>مشاركة</span>
                            </button>
                          )}

                          {/* Multiple Qualities */}
                          {isCompleted && item.available_qualities && item.available_qualities.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setQualitiesModalItem(item)}
                              className="p-1.5 rounded-lg bg-indigo-950 text-indigo-400 hover:bg-indigo-900 border border-indigo-800 transition-colors"
                              title="تحميل بجودات متعددة (1080p, 720p, MP3...)"
                            >
                              <Layers className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Direct media */}
                          {item.file && (
                            <a
                              href={item.file}
                              target="_blank"
                              rel="noreferrer"
                              download={item.filename || 'video.mp4'}
                              className="p-1.5 rounded-lg bg-emerald-950 text-emerald-400 hover:bg-emerald-900 border border-emerald-800 transition-colors"
                              title="تشغيل / تحميل الملف المباشر"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}

                          {/* AI Comparison button (Table) */}
                          {isCompleted && item.file && !item.filename?.endsWith('.mp3') && (
                            <button
                              type="button"
                              onClick={() => setComparisonItem(item)}
                              className="p-1.5 rounded-lg bg-purple-950 text-purple-300 hover:bg-purple-900 border border-purple-800 transition-colors"
                              title="مقارنة الفيديو الطبيعي والمحسن بالذكاء الاصطناعي"
                            >
                              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                            </button>
                          )}

                          {/* JSON Inspection */}
                          <button
                            type="button"
                            onClick={() => {
                              const details = engine.getJobWithResult(item.id);
                              setSelectedJobData({
                                title: `تفاصيل المهمة: ${item.id}`,
                                data: details.job ? details : item,
                              });
                            }}
                            className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 transition-colors"
                            title="عرض تفاصيل JSON"
                          >
                            <Code className="w-3.5 h-3.5" />
                          </button>

                          {/* Delete Job */}
                          {(isCompleted || isFailed) && (
                            <button
                              type="button"
                              onClick={() => handleDelete(item.id)}
                              disabled={isLoadingThis}
                              className="p-1.5 rounded-lg bg-slate-800 text-rose-400 hover:bg-rose-950 hover:border-rose-800 border border-slate-700 transition-colors"
                              title="حذف المهمة نهائياً من السجل"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Video Preview Modal Player */}
      {videoPreviewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950">
              <div className="flex items-center gap-2 truncate">
                <Film className="w-4 h-4 text-indigo-400 shrink-0" />
                <h3 className="text-xs font-bold text-slate-100 truncate">
                  {videoPreviewItem.clean_title || videoPreviewItem.filename || 'معاينة المقطع'}
                </h3>
                {getAiEnhancedBadge(videoPreviewItem)}
              </div>
              <button
                type="button"
                onClick={() => setVideoPreviewItem(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 bg-black">
              {videoPreviewItem.file ? (
                <video
                  src={videoPreviewItem.file}
                  controls
                  autoPlay
                  className="w-full max-h-[60vh] rounded-xl object-contain bg-black shadow-inner"
                  poster={videoPreviewItem.thumbnail}
                >
                  متصفحك لا يدعم مشغل الفيديو المدمج.
                </video>
              ) : (
                <div className="p-12 text-center text-slate-400">
                  <Film className="w-12 h-12 mx-auto mb-2 text-slate-600" />
                  <p className="text-xs">الملف المباشر غير متوفر للمعاينة المباشرة.</p>
                </div>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {getPlatformBadge(videoPreviewItem.platform)}
                <span className="text-[11px] font-mono text-slate-400">
                  {videoPreviewItem.duration || '0s'}
                </span>
                {videoPreviewItem.resolution_label && (
                  <span className="text-[10px] font-mono font-bold text-slate-300 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                    {videoPreviewItem.resolution_label}
                  </span>
                )}
                {videoPreviewItem.formatted_size && (
                  <span className="text-[10px] font-mono font-bold text-emerald-300 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-500/30 flex items-center gap-1">
                    <HardDrive className="w-3 h-3 text-emerald-400" />
                    <span>{videoPreviewItem.formatted_size}</span>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* Share Button in Preview */}
                <button
                  type="button"
                  onClick={() => {
                    setVideoPreviewItem(null);
                    openShareModal([videoPreviewItem]);
                  }}
                  className="py-1.5 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>مشاركة إلى تيليجرام</span>
                </button>

                {videoPreviewItem.file && (
                  <a
                    href={videoPreviewItem.file}
                    target="_blank"
                    rel="noreferrer"
                    download={videoPreviewItem.filename || 'video.mp4'}
                    className="py-1.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>تحميل الملف</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setVideoPreviewItem(null)}
                  className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                >
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Share to Telegram Channel or User Modal */}
      {shareModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-sky-950/80 border border-sky-800/80 flex items-center justify-center text-sky-400">
                  <Send className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">مشاركة إلى قناة أو مستخدم تيليجرام</h3>
                  <p className="text-[11px] text-slate-400">إرسال الفيديوهات مباشرة بدون علامة مائية وبأعلى جودة</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isSendingShare && setShareModalOpen(false)}
                disabled={isSendingShare}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              {/* Selected items summary */}
              <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-300">العناصر المختارة للمشاركة:</span>
                  <span className="text-indigo-400 font-bold bg-indigo-950 px-2 py-0.5 rounded font-mono">
                    {itemsToShare.length} فيديو
                  </span>
                </div>
                <div className="max-h-24 overflow-y-auto space-y-1 pr-1">
                  {itemsToShare.map((itm) => (
                    <div key={itm.id} className="text-[11px] text-slate-400 truncate flex items-center gap-1.5">
                      <span className="text-indigo-400 font-mono">#</span>
                      <span className="truncate">{itm.clean_title || itm.filename || itm.id}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Target Channel or User Input */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                  <span>الوجهة (معرف القناة أو المستخدم أو الشات):</span>
                  <span className="text-[10px] text-slate-500">مثال: @my_channel أو 5660048569</span>
                </label>
                <div className="relative">
                  <Radio className="w-4 h-4 text-sky-400 absolute right-3.5 top-2.5" />
                  <input
                    type="text"
                    placeholder="@channel_name أو -1004256955823 أو 5660048569"
                    value={targetChatInput}
                    onChange={(e) => setTargetChatInput(e.target.value)}
                    disabled={isSendingShare}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl pr-10 pl-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500 transition-colors font-mono"
                  />
                </div>

                {/* Quick Selection Chips for Recent Channels / Chats */}
                {recentChats.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[10px] text-slate-400">وجهات سريعة من السجل الأخير:</span>
                    <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                      {recentChats.map((rc, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setTargetChatInput(rc.id)}
                          disabled={isSendingShare}
                          className={`text-[10px] px-2.5 py-1 rounded-lg border font-mono transition-all ${
                            targetChatInput === rc.id
                              ? 'bg-sky-950 text-sky-300 border-sky-500 font-bold'
                              : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200'
                          }`}
                        >
                          {rc.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Share Format Selection */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300">صيغة وهيئة الإرسال:</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setShareFormat('video')}
                    className={`p-2.5 rounded-xl border text-xs font-medium flex flex-col items-center gap-1.5 transition-all ${
                      shareFormat === 'video'
                        ? 'bg-indigo-950 text-indigo-200 border-indigo-500 shadow-xs'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <Film className="w-4 h-4 text-indigo-400" />
                    <span>فيديو MP4 أصلي</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShareFormat('card')}
                    className={`p-2.5 rounded-xl border text-xs font-medium flex flex-col items-center gap-1.5 transition-all ${
                      shareFormat === 'card'
                        ? 'bg-sky-950 text-sky-200 border-sky-500 shadow-xs'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <ExternalLink className="w-4 h-4 text-sky-400" />
                    <span>بطاقة ورابط تنزيل</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShareFormat('audio')}
                    className={`p-2.5 rounded-xl border text-xs font-medium flex flex-col items-center gap-1.5 transition-all ${
                      shareFormat === 'audio'
                        ? 'bg-pink-950 text-pink-200 border-pink-500 shadow-xs'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <Music className="w-4 h-4 text-pink-400" />
                    <span>صوت MP3 فقط</span>
                  </button>
                </div>
              </div>

              {/* Custom Caption / Message */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">ملاحظة أو رسالة إضافية مع الفيديو (اختياري):</label>
                <input
                  type="text"
                  placeholder="مثال: شاهد هذا المقطع المميز 🔥..."
                  value={shareCustomCaption}
                  onChange={(e) => setShareCustomCaption(e.target.value)}
                  disabled={isSendingShare}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              {/* Live progress indicator */}
              {isSendingShare && (
                <div className="p-3 rounded-xl bg-slate-950 border border-sky-500/40 text-xs text-sky-300 flex items-center gap-2 animate-pulse font-medium">
                  <RefreshCw className="w-4 h-4 animate-spin text-sky-400 shrink-0" />
                  <span>{shareProgressMsg || 'جارٍ الإرسال إلى تيليجرام...'}</span>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShareModalOpen(false)}
                disabled={isSendingShare}
                className="py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors disabled:opacity-40"
              >
                إلغاء
              </button>

              <button
                type="button"
                onClick={handleExecuteShare}
                disabled={isSendingShare || !targetChatInput.trim()}
                className="py-2 px-5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center gap-2 transition-all shadow-md shadow-sky-600/30 disabled:opacity-40"
              >
                <Send className={`w-3.5 h-3.5 ${isSendingShare ? 'animate-bounce' : ''}`} />
                <span>{isSendingShare ? 'جارٍ الإرسال...' : 'إرسال ومشاركة الآن 🚀'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Job Details JSON Modal */}
      <JobJsonModal
        isOpen={Boolean(selectedJobData)}
        onClose={() => setSelectedJobData(null)}
        title={selectedJobData?.title || 'تفاصيل المهمة'}
        data={selectedJobData?.data}
      />

      {/* Multiple Quality Download Modal */}
      {qualitiesModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-indigo-400" />
                <h3 className="text-sm font-bold text-slate-100">تحميل بجودات متعددة</h3>
              </div>
              <button
                type="button"
                onClick={() => setQualitiesModalItem(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 text-xs">
                <div className="font-semibold text-slate-200 mb-1 line-clamp-2 leading-relaxed">
                  {qualitiesModalItem.clean_title || qualitiesModalItem.filename || 'ملف الوسائط'}
                </div>
                <div className="text-[11px] text-slate-400 font-mono truncate">
                  {qualitiesModalItem.url}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-300">اختر الجودة المطلوبة:</div>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {qualitiesModalItem.available_qualities?.map((qOpt, idx) => {
                    const isAudioType = qOpt.type === 'audio' || qOpt.quality === 'audio';
                    const activeDownloadUrl = qOpt.url || qualitiesModalItem.file;
                    const customFilename = qualitiesModalItem.clean_title
                      ? `${qualitiesModalItem.clean_title.replace(/\s+/g, '_')}_${qOpt.quality}.${isAudioType ? 'mp3' : 'mp4'}`
                      : (qualitiesModalItem.filename || 'media.mp4');

                    return (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          {isAudioType ? (
                            <div className="w-8 h-8 rounded-lg bg-pink-950/60 border border-pink-800/60 flex items-center justify-center text-pink-400">
                              <Music className="w-4 h-4" />
                            </div>
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-cyan-950/60 border border-cyan-800/60 flex items-center justify-center text-cyan-400">
                              <Film className="w-4 h-4" />
                            </div>
                          )}
                          <div>
                            <div className="text-xs font-bold text-slate-200">{qOpt.label}</div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              {qOpt.resolution || qOpt.quality} {qOpt.size ? `• ${qOpt.size}` : ''}
                            </div>
                          </div>
                        </div>

                        {activeDownloadUrl ? (
                          <a
                            href={activeDownloadUrl}
                            target="_blank"
                            rel="noreferrer"
                            download={customFilename}
                            className="py-1.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
                          >
                            <FileDown className="w-3.5 h-3.5" />
                            <span>تحميل مباشر</span>
                          </a>
                        ) : (
                          <span className="text-xs text-slate-500">غير متوفر</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-800 bg-slate-950 flex justify-end">
              <button
                type="button"
                onClick={() => setQualitiesModalItem(null)}
                className="py-1.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Video Comparison Modal */}
      {comparisonItem && comparisonItem.file && (
        <VideoComparisonModal
          isOpen={Boolean(comparisonItem)}
          onClose={() => setComparisonItem(null)}
          originalVideoUrl={comparisonItem.file}
          enhancedVideoUrl={comparisonItem.file}
          thumbnail={comparisonItem.thumbnail}
          title={comparisonItem.clean_title || comparisonItem.filename || comparisonItem.url}
        />
      )}
    </div>
  );
};
