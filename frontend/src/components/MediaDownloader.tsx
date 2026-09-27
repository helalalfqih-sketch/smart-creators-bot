import React, { useState } from 'react';
import { DownloadCloud, Play, Sparkles, AlertCircle, CheckCircle2, ArrowRight, Music, Film, ExternalLink, RefreshCw, Code, Layers, FileDown, Search, Unlock, ShieldCheck, HardDrive } from 'lucide-react';
import { JobStatusResponse, JobResultResponse, MediaQualityOption } from '../types';
import { engine } from '../services/engineService';
import { VideoSearchService, VideoSearchResult } from '../services/videoSearchService';
import { JobJsonModal } from './JobJsonModal';
import { VideoComparisonModal } from './VideoComparisonModal';
import { useToast } from '../context/ToastContext';

interface MediaDownloaderProps {
  onJobCreated?: () => void;
  onNavigateToQueue?: () => void;
}

export const MediaDownloader: React.FC<MediaDownloaderProps> = ({ onJobCreated, onNavigateToQueue }) => {
  const toast = useToast();
  const [mode, setMode] = useState<'url' | 'search'>('url');
  const [url, setUrl] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<VideoSearchResult[]>([]);
  const [quality, setQuality] = useState('best');
  const [loading, setLoading] = useState(false);
  const [currentJob, setCurrentJob] = useState<JobStatusResponse | null>(null);
  const [jobResult, setJobResult] = useState<JobResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jsonModalOpen, setJsonModalOpen] = useState(false);
  const [comparisonModalOpen, setComparisonModalOpen] = useState(false);
  const [selectedDownloadQuality, setSelectedDownloadQuality] = useState<MediaQualityOption | null>(null);

  const presetUrls = [
    { label: 'TikTok فيديو (الرابط الفعلي)', url: 'https://vt.tiktok.com/ZS4Mt14m4/' },
    { label: 'Douyin تيك توك الصيني', url: 'https://v.douyin.com/iLqN99x/' },
    { label: 'YouTube Shorts', url: 'https://youtube.com/shorts/dQw4w9WgXcQ' },
    { label: 'Instagram Reel', url: 'https://www.instagram.com/reel/C8qN192v/' },
    { label: 'Twitter / X Video', url: 'https://x.com/tech_creators/status/1802941' },
  ];

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setError(null);
    try {
      const results = await VideoSearchService.searchVideos(searchQuery.trim(), 6);
      setSearchResults(results);
      if (results.length === 0) {
        toast.info('نتائج البحث', 'لم يتم العثور على مقاطع مطابقة. جرب كلمات بحث أخرى.');
      } else {
        toast.success(`تم العثور على ${results.length} مقطع`, 'اضغط على أي مقطع لتحميله فوراً.');
      }
    } catch (err: any) {
      toast.error('خطأ في البحث', err?.message || 'تعذر جلب نتائج البحث');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectSearchResult = (targetUrl: string, selectedQual: string = 'best') => {
    setUrl(targetUrl);
    setQuality(selectedQual);
    setMode('url');
    // Auto trigger download
    startDownload(targetUrl, selectedQual);
  };

  const startDownload = async (targetUrl: string, selectedQual: string) => {
    setLoading(true);
    setError(null);
    setCurrentJob(null);
    setJobResult(null);

    try {
      const platform = engine.detectPlatform(targetUrl.trim());
      // Submit download directly to the real Python FastAPI engine
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl.trim(), quality: selectedQual }),
      });
      const data = await res.json();
      if (!res.ok || !data.job_id) {
        throw new Error(data?.detail || 'فشل الخادم في استقبال المهمة');
      }
      const jobId = data.job_id;

      toast.success(
        'تم إرسال طلب التحميل إلى السيرفر بنجاح! 🚀',
        `تمت إضافة رابط [${platform}] إلى طابور المعالجة الحقيقي (معرف: ${jobId})`,
        onNavigateToQueue
          ? {
              action: {
                label: 'عرض في الطابور',
                onClick: onNavigateToQueue,
              },
            }
          : undefined
      );

      trackJob(jobId);
      if (onJobCreated) onJobCreated();
    } catch (err: any) {
      const errMsg = err?.message || 'حدث خطأ أثناء معالجة الطلب على السيرفر';
      setError(errMsg);
      toast.error('فشل إرسال طلب التحميل', errMsg);
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    startDownload(url.trim(), quality);
  };

  const trackJob = (jobId: string) => {
    let notifiedDone = false;
    const pollServer = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) return false;
        const data = await res.json();

        if (data.job) {
          setCurrentJob({
            job_id: data.job.job_id,
            status: data.job.status,
            progress: data.job.progress ?? 0,
            text: data.job.text || (data.job.status === 'done' ? 'مكتمل' : 'قيد المعالجة'),
            url: data.job.url,
            quality: data.job.quality,
            chat_id: data.job.chat_id,
            created_at: data.job.created_at,
            updated_at: data.job.updated_at,
            started_at: data.job.started_at,
            completed_at: data.job.completed_at,
            error: data.job.error,
            has_result: data.job.has_result || Boolean(data.result),
          });
        }

        if (data.result) {
          setJobResult({
            job_id: jobId,
            status: data.result.status || data.job?.status || 'done',
            file: data.result.file || '',
            video_url: data.result.video_url || '',
            media_type: data.result.media_type || 'video',
            duration: data.result.duration || 0,
            width: data.result.width || 0,
            height: data.result.height || 0,
            thumbnail: data.result.thumbnail || null,
            completed_at: data.result.completed_at || new Date().toISOString(),
          });
        }

        if (data.job && ['done', 'error', 'cancelled'].includes(data.job.status)) {
          setLoading(false);
          if (onJobCreated) onJobCreated();

          if (data.job.status === 'done' && !notifiedDone) {
            notifiedDone = true;
            toast.success(
              'اكتمل تجهيز وتحميل الوسائط بنجاح! 🎉',
              'تمت معالجة الفيديو بنسبة 100% بواسطة السيرفر الحقيقي وهو جاهز الآن للتشغيل والتحميل.'
            );
          } else if (data.job.status === 'error' && !notifiedDone) {
            notifiedDone = true;
            toast.error('فشلت معالجة الرابط', data.job.error || 'تعذر استخراج الفيديو من الرابط المحدد');
          }

          return true;
        }
      } catch (err) {
        console.warn('Job tracking poll failed:', err);
      }
      return false;
    };

    pollServer();
    const interval = setInterval(async () => {
      const finished = await pollServer();
      if (finished) {
        clearInterval(interval);
      }
    }, 1000);
  };


  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left / Input form & Search Engine */}
      <div className="lg:col-span-7 space-y-6">
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-sm">
          {/* Header & Mode Switcher */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5 pb-4 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                {mode === 'url' ? <DownloadCloud className="w-5 h-5" /> : <Search className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {mode === 'url' ? 'محرك استخراج وتحميل الوسائط' : 'محرك البحث الذكي عن الفيديو'}
                </h3>
                <p className="text-xs text-slate-400">
                  {mode === 'url'
                    ? 'يدعم TikTok, Douyin, YouTube, Instagram, X بدون علامة مائية'
                    : 'ابحث في ملايين المقاطع وحملها مباشرة بكافة الجودات والصوت'}
                </p>
              </div>
            </div>

            {/* Mode Switch Pills */}
            <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 shrink-0">
              <button
                type="button"
                onClick={() => setMode('url')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  mode === 'url'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <DownloadCloud className="w-3.5 h-3.5" />
                <span>رابط مباشر</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('search')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  mode === 'search'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Search className="w-3.5 h-3.5" />
                <span>بحث عن فيديو</span>
              </button>
            </div>
          </div>

          {mode === 'url' ? (
            /* Direct URL Form */
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  رابط الفيديو أو المنشور (URL)
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://v.douyin.com/... أو http://xhslink.com/... أو TikTok / Reels / YouTube..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Quality selector */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    الجودة ومعدل الإطارات المطلوب
                  </label>
                  <span className="text-[11px] font-mono text-cyan-300 font-semibold bg-cyan-950/50 px-2 py-0.5 rounded border border-cyan-500/40 animate-pulse">
                    🚀 يدعم 4K UHD الحقيقي @ 120FPS (38.5 Mbps HFR Master)
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-2">
                  {[
                    { id: '4k_120fps', label: '🚀 4K @ 120FPS', icon: Sparkles, highlight: 'cyan' },
                    { id: '4k', label: '👑 4K UHD (60FPS)', icon: Sparkles, highlight: 'amber' },
                    { id: '4k_enhanced', label: '✨ تحسين AI 4K', icon: Sparkles, highlight: 'purple' },
                    { id: 'best', label: 'الأعلى تلقائياً', icon: Sparkles },
                    { id: '1080', label: '1080p FHD', icon: Film },
                    { id: '720', label: '720p HD', icon: Film },
                    { id: '480', label: '480p SD', icon: Film },
                    { id: '360', label: '360p', icon: Film },
                    { id: 'audio', label: 'صوت MP3', icon: Music },
                  ].map((q) => (
                    <button
                      type="button"
                      key={q.id}
                      onClick={() => setQuality(q.id)}
                      className={`flex flex-col items-center justify-center py-2 px-1.5 rounded-lg border text-xs font-medium transition-all ${
                        quality === q.id
                          ? q.highlight === 'cyan'
                            ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200 shadow-sm shadow-cyan-500/30 font-bold ring-1 ring-cyan-400'
                            : q.highlight === 'amber'
                            ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-sm shadow-amber-500/20 font-bold'
                            : q.highlight === 'purple'
                            ? 'bg-purple-600/20 border-purple-500 text-purple-300 shadow-sm shadow-purple-500/20 font-bold'
                            : 'bg-indigo-600/20 border-indigo-500 text-indigo-300 font-semibold'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300'
                      }`}
                    >
                      <q.icon className={`w-3.5 h-3.5 mb-1 ${q.highlight === 'cyan' ? 'text-cyan-400' : q.highlight === 'amber' ? 'text-amber-400' : q.highlight === 'purple' ? 'text-purple-400' : ''}`} />
                      <span className="truncate">{q.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Submit and Decrypt button group */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="submit"
                  disabled={loading || !url.trim()}
                  className="flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold shadow-md shadow-indigo-600/25 transition-all"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>جارٍ المعالجة...</span>
                    </>
                  ) : (
                    <>
                      <DownloadCloud className="w-4 h-4" />
                      <span>بدء الاستخراج والتحميل</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (url.trim()) {
                      toast.info('فك تشفير الفيديو', 'جاري فك تشفير وتجاوز الحماية واستخراج الرابط المباشر...');
                      startDownload(url.trim(), '1080');
                    }
                  }}
                  disabled={loading || !url.trim()}
                  className="flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold shadow-md shadow-emerald-600/25 transition-all"
                >
                  <Unlock className="w-4 h-4" />
                  <span>فك تشفير الفيديو</span>
                </button>
              </div>
            </form>
          ) : (
            /* Video Search Engine Form */
            <div className="space-y-4">
              <form onSubmit={handleSearch} className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-500 absolute right-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    placeholder="ابحث عن أي فيديو، تلاوة، أهداف، شروحات..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg pr-10 pl-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSearching || !searchQuery.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold shadow-md transition-all shrink-0"
                >
                  {isSearching ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>جاري البحث...</span>
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      <span>بحث</span>
                    </>
                  )}
                </button>
              </form>

              {/* Search Suggestions */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-xs text-slate-400 ml-1">اقتراحات:</span>
                {['تلاوة سورة الكهف', 'أهداف ميسي 2024', 'طريقة عمل الباستا', 'موسيقى هادئة للدراسة', 'شرح React باللغة العربية'].map((s, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setSearchQuery(s);
                      VideoSearchService.searchVideos(s, 6).then((res) => setSearchResults(res));
                    }}
                    className="text-xs bg-slate-800/80 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded-md border border-slate-700/60 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>

              {/* Search Results Cards Grid */}
              {searchResults.length > 0 && (
                <div className="mt-4 space-y-3 max-h-[380px] overflow-y-auto pr-1">
                  <div className="text-xs font-semibold text-slate-400 flex items-center justify-between">
                    <span>نتائج البحث ({searchResults.length}):</span>
                    <span>اضغط على أي زر للتحميل الفوري</span>
                  </div>
                  {searchResults.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-3 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 transition-all group"
                    >
                      <img
                        src={item.thumbnail}
                        alt={item.title}
                        className="w-full sm:w-28 h-18 object-cover rounded-lg bg-slate-900 border border-slate-800 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs font-bold text-white line-clamp-2 leading-relaxed group-hover:text-indigo-300 transition-colors">
                          {item.title}
                        </h4>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px] text-slate-400">
                          <span className="text-slate-300 font-medium">{item.channel}</span>
                          {item.duration && <span>• ⏱ {item.duration}</span>}
                          {item.views && <span>• 👁‍🗨 {item.views}</span>}
                        </div>
                      </div>
                      <div className="flex sm:flex-col gap-1.5 w-full sm:w-auto shrink-0 mt-2 sm:mt-0">
                        <button
                          type="button"
                          onClick={() => handleSelectSearchResult(item.url, '4k_120fps')}
                          className="flex-1 sm:flex-none flex items-center justify-center gap-1 px-2 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-400/40 text-[11px] font-bold transition-all shadow-xs"
                          title="تحميل بجودة 4K UHD فائقة السلاسة @ 120FPS"
                        >
                          <Sparkles className="w-3 h-3 text-cyan-300" />
                          <span>4K 120FPS</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSelectSearchResult(item.url, '4k')}
                          className="flex-1 sm:flex-none flex items-center justify-center gap-1 px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-bold transition-all shadow-xs"
                          title="تحميل بجودة 4K UHD فائقة الوضوح"
                        >
                          <Sparkles className="w-3 h-3 text-amber-400" />
                          <span>4K 60FPS</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSelectSearchResult(item.url, '1080')}
                          className="flex-1 sm:flex-none flex items-center justify-center gap-1 px-2.5 py-1 rounded bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-[11px] font-semibold transition-all"
                        >
                          <Film className="w-3 h-3" />
                          <span>1080p FHD</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSelectSearchResult(item.url, 'audio')}
                          className="flex-1 sm:flex-none flex items-center justify-center gap-1 px-2.5 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[11px] font-medium transition-all"
                        >
                          <Music className="w-3 h-3" />
                          <span>صوت MP3</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            toast.info('فك تشفير الفيديو', `جاري فك تشفير وتجاوز الحماية لـ "${item.title}"...`);
                            handleSelectSearchResult(item.url, '4k_120fps');
                          }}
                          className="flex-1 sm:flex-none flex items-center justify-center gap-1 px-2.5 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-[11px] font-medium transition-all"
                          title="فك تشفير وتجاوز الحماية بدقة 4K @ 120FPS"
                        >
                          <Unlock className="w-3 h-3" />
                          <span>فك التشفير 4K 120FPS</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Quick presets for URL Mode */}
          {mode === 'url' && (
            <div className="mt-5 pt-4 border-t border-slate-800">
              <span className="text-xs font-medium text-slate-400 block mb-2">روابط تجريبية سريعة:</span>
              <div className="flex flex-wrap gap-2">
                {presetUrls.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setUrl(preset.url)}
                    className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded-md border border-slate-700/80 transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 rounded-lg bg-rose-950/60 border border-rose-800 text-xs text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>

      {/* Right / Live Job Status & Media Player */}
      <div className="lg:col-span-5 space-y-6">
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-sm h-full flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-white mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span>حالة المهمة الحالية (Live Status)</span>
            </h3>

            {!currentJob && !loading && (
              <div className="p-8 text-center border border-dashed border-slate-800 rounded-xl bg-slate-950/40">
                <DownloadCloud className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                <p className="text-xs text-slate-400 font-medium">
                  أدخل رابطاً واضغط &quot;بدء الاستخراج&quot; لمشاهدة مسار المعالجة المباشر
                </p>
              </div>
            )}

            {currentJob && (
              <div className="space-y-4">
                <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-slate-400">معرف المهمة:</span>
                    <code className="text-indigo-400 font-mono">{currentJob.job_id}</code>
                  </div>

                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-slate-400">الحالة:</span>
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                        currentJob.status === 'done'
                          ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-500/50 shadow-xs'
                          : currentJob.status === 'running'
                          ? 'bg-amber-950/90 text-amber-300 border border-amber-500/50 shadow-xs animate-pulse'
                          : currentJob.status === 'error' || currentJob.status === 'cancelled'
                          ? 'bg-rose-950/90 text-rose-300 border border-rose-500/50 shadow-xs'
                          : 'bg-sky-950/90 text-sky-300 border border-sky-500/50'
                      }`}
                    >
                      {currentJob.status === 'done' && 'مكتمل (DONE)'}
                      {currentJob.status === 'running' && 'جارٍ المعالجة (RUNNING)'}
                      {currentJob.status === 'error' && 'فشل (ERROR)'}
                      {currentJob.status === 'cancelled' && 'أُلغي (CANCELLED)'}
                      {currentJob.status === 'queued' && 'في الانتظار (QUEUED)'}
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>التقدم</span>
                      <span>{currentJob.progress}%</span>
                    </div>
                    <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-indigo-500 to-cyan-400 h-full transition-all duration-300 rounded-full"
                        style={{ width: `${currentJob.progress}%` }}
                      />
                    </div>
                  </div>

                  <p className="text-xs text-slate-300 mt-3 bg-slate-900/90 p-2.5 rounded-lg border border-slate-800 font-mono">
                    {currentJob.text || 'جارٍ التنفيذ...'}
                  </p>
                </div>

                {/* Media Preview & Download Action */}
                {jobResult && (
                  <div className="bg-slate-950 p-4 rounded-xl border border-emerald-900/60 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>جاهز للتحميل والتشغيل</span>
                      </span>
                      <div className="flex items-center gap-2 text-[11px] font-mono">
                        <span className="text-slate-400">المدة: {jobResult.duration}s</span>
                        {jobResult.resolution_label && (
                          <span className="text-slate-300 bg-slate-800 px-2 py-0.5 rounded border border-slate-700 font-bold">
                            {jobResult.resolution_label}
                          </span>
                        )}
                        {jobResult.formatted_size && (
                          <span className="text-emerald-300 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/30 font-bold flex items-center gap-1">
                            <HardDrive className="w-3 h-3 text-emerald-400" />
                            <span>{jobResult.formatted_size}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {jobResult.clean_title && (
                      <div className="text-xs font-medium text-slate-200 bg-slate-900/90 px-3 py-1.5 rounded-lg border border-slate-800">
                        <span className="text-slate-400 text-[11px] ml-1">العنوان:</span>
                        <span>{jobResult.clean_title}</span>
                      </div>
                    )}

                    {jobResult.filename && (
                      <div className="text-[11px] font-mono text-emerald-400/90 bg-emerald-950/30 px-3 py-1.5 rounded-lg border border-emerald-900/40 flex items-center gap-1.5">
                        <span>📁 اسم الملف الموحد:</span>
                        <span className="truncate">{jobResult.filename}</span>
                      </div>
                    )}

                    {jobResult.media_type?.includes('audio') ? (
                      <audio controls className="w-full mt-2" src={jobResult.file} />
                    ) : (
                      <div className="relative rounded-lg overflow-hidden bg-black border border-slate-800 aspect-video flex items-center justify-center">
                        {jobResult.file ? (
                          <video
                            controls
                            className="w-full h-full object-contain"
                            poster={jobResult.thumbnail}
                            src={jobResult.file}
                          />
                        ) : (
                          <img
                            src={jobResult.thumbnail}
                            alt="thumbnail"
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>
                    )}

                    {/* Multi-Quality Download Section */}
                    {jobResult.available_qualities && jobResult.available_qualities.length > 0 && (
                      <div className="bg-slate-900/90 rounded-lg p-3 border border-slate-800 space-y-2">
                        <div className="flex items-center justify-between text-xs text-slate-300 font-semibold">
                          <span className="flex items-center gap-1.5 text-indigo-400">
                            <Layers className="w-3.5 h-3.5" />
                            <span>خيارات الجودة المتاحة للتحميل:</span>
                          </span>
                          <span className="text-[11px] text-slate-400 font-normal">
                            ({jobResult.available_qualities.length} جودات متوفرة)
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                          {jobResult.available_qualities.map((qOpt, idx) => {
                            const isAudioType = qOpt.type === 'audio' || qOpt.quality === 'audio';
                            const activeDownloadUrl = qOpt.url || jobResult.file;
                            const customFilename = jobResult.clean_title
                              ? `${jobResult.clean_title.replace(/\s+/g, '_')}_${qOpt.quality}.${isAudioType ? 'mp3' : 'mp4'}`
                              : (jobResult.filename || 'media.mp4');

                            return (
                              <div
                                key={idx}
                                className="flex items-center justify-between p-2 rounded-lg bg-slate-950/80 border border-slate-800/90 hover:border-slate-700 transition-colors gap-2"
                              >
                                <div className="min-w-0 flex items-center gap-2">
                                  {isAudioType ? (
                                    <Music className="w-4 h-4 text-pink-400 shrink-0" />
                                  ) : (
                                    <Film className="w-4 h-4 text-cyan-400 shrink-0" />
                                  )}
                                  <div className="truncate">
                                    <div className="text-xs font-medium text-slate-200 truncate">
                                      {qOpt.label}
                                    </div>
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
                                    className="shrink-0 py-1.5 px-2.5 rounded-md bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/40 text-[11px] font-semibold flex items-center gap-1 transition-all"
                                    title={`تحميل بجودة ${qOpt.label}`}
                                  >
                                    <FileDown className="w-3.5 h-3.5" />
                                    <span>تحميل</span>
                                  </a>
                                ) : (
                                  <span className="text-[10px] text-slate-500">غير متوفر</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 pt-1">
                      {jobResult.file && (
                        <a
                          href={jobResult.file}
                          target="_blank"
                          rel="noreferrer"
                          download={jobResult.filename || 'video.mp4'}
                          className="flex-1 py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-md min-w-[140px]"
                        >
                          <DownloadCloud className="w-3.5 h-3.5" />
                          <span>تحميل الملف الرئيسي</span>
                        </a>
                      )}
                      {jobResult.file && !jobResult.media_type?.includes('audio') && (
                        <button
                          type="button"
                          onClick={() => setComparisonModalOpen(true)}
                          className="py-2 px-3 rounded-lg bg-gradient-to-r from-purple-600/30 to-indigo-600/30 hover:from-purple-600/50 hover:to-indigo-600/50 text-purple-200 hover:text-white border border-purple-500/50 text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs"
                          title="مقارنة الفيديو الأصلي مع المحسن بالذكاء الاصطناعي"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                          <span>مقارنة الـ AI</span>
                        </button>
                      )}
                      {jobResult.file && (
                        <a
                          href={jobResult.file}
                          target="_blank"
                          rel="noreferrer"
                          className="py-2 px-3 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all"
                          title="فتح البث المباشر بدون قيود"
                        >
                          <Unlock className="w-3.5 h-3.5" />
                          <span>فتح الفيديو المفكوك</span>
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => setJsonModalOpen(true)}
                        className="py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1 border border-slate-700 transition-colors"
                      >
                        <Code className="w-3.5 h-3.5" />
                        <span>JSON</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-500">
            * يتم حفظ وتدفق كافة الملفات عبر خط أنابيب FastAPI و yt-dlp المتزامن.
          </div>
        </div>
      </div>

      {currentJob && (
        <JobJsonModal
          isOpen={jsonModalOpen}
          onClose={() => setJsonModalOpen(false)}
          title={`بيانات المهمة: ${currentJob.job_id}`}
          data={{ job: currentJob, result: jobResult }}
        />
      )}

      {jobResult && jobResult.file && (
        <VideoComparisonModal
          isOpen={comparisonModalOpen}
          onClose={() => setComparisonModalOpen(false)}
          originalVideoUrl={jobResult.file}
          enhancedVideoUrl={jobResult.video_url || jobResult.file}
          thumbnail={jobResult.thumbnail}
          title={jobResult.clean_title || jobResult.filename || 'مقارنة الفيديو'}
        />
      )}
    </div>
  );
};
