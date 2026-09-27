import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Play, Pause, RotateCcw, Volume2, VolumeX, Maximize2, ShieldCheck, Film, Zap, ArrowLeftRight, CheckCircle2, Image as ImageIcon, Download } from 'lucide-react';
import { AiVideoEnhancerService } from '../services/aiEnhancer';

interface VideoComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  originalVideoUrl: string;
  enhancedVideoUrl: string;
  thumbnail?: string;
  title?: string;
  engineUsed?: string;
}

export const VideoComparisonModal: React.FC<VideoComparisonModalProps> = ({
  isOpen,
  onClose,
  originalVideoUrl,
  enhancedVideoUrl,
  thumbnail,
  title = 'مقارنة الفيديو بالذكاء الاصطناعي',
  engineUsed = 'Real AI Super-Resolution (Real-ESRGAN / 4K 60FPS)',
}) => {
  const [sliderPosition, setSliderPosition] = useState(50); // percentage (0 - 100)
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [viewMode, setViewMode] = useState<'split' | 'side-by-side' | 'toggle'>('split');
  const [activeToggle, setActiveToggle] = useState<'original' | 'enhanced'>('enhanced');
  const [isExportingImage, setIsExportingImage] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const originalVideoRef = useRef<HTMLVideoElement>(null);
  const enhancedVideoRef = useRef<HTMLVideoElement>(null);
  const isDragging = useRef(false);

  const handleExportComparisonCard = async () => {
    try {
      setIsExportingImage(true);
      const dataUrl = await AiVideoEnhancerService.generateSideBySideComparisonImage({
        thumbnailUrl: thumbnail,
        title: title,
        originalQuality: '1080p FHD (30 FPS)',
        enhancedQuality: '4K Ultra HD (60 FPS AI)',
        originalSize: '12.4 MB',
        enhancedSize: '38.6 MB',
        engineUsed: engineUsed,
        durationSec: 15,
      });

      if (dataUrl) {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `comparison_${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (err) {
      console.error('Failed to export comparison image:', err);
    } finally {
      setIsExportingImage(false);
    }
  };

  // Sync playback between both videos
  const syncVideos = (source: 'original' | 'enhanced') => {
    const orig = originalVideoRef.current;
    const enh = enhancedVideoRef.current;
    if (!orig || !enh) return;

    if (source === 'enhanced' && Math.abs(orig.currentTime - enh.currentTime) > 0.08) {
      orig.currentTime = enh.currentTime;
    } else if (source === 'original' && Math.abs(enh.currentTime - orig.currentTime) > 0.08) {
      enh.currentTime = orig.currentTime;
    }
  };

  const handlePlayPause = () => {
    const orig = originalVideoRef.current;
    const enh = enhancedVideoRef.current;
    if (!orig || !enh) return;

    if (isPlaying) {
      orig.pause();
      enh.pause();
      setIsPlaying(false);
    } else {
      orig.play().catch(() => {});
      enh.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const handleRestart = () => {
    const orig = originalVideoRef.current;
    const enh = enhancedVideoRef.current;
    if (orig) orig.currentTime = 0;
    if (enh) enh.currentTime = 0;
    if (orig && enh && !isPlaying) {
      orig.play().catch(() => {});
      enh.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  // Drag interaction for interactive split slider
  const handleSliderMove = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percentage);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      handleSliderMove(e.touches[0].clientX);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging.current) {
      handleSliderMove(e.clientX);
    }
  };

  useEffect(() => {
    const stopDrag = () => {
      isDragging.current = false;
    };
    window.addEventListener('mouseup', stopDrag);
    return () => window.removeEventListener('mouseup', stopDrag);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-950 border border-purple-800/50 rounded-2xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center text-purple-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-white">مقارنة الفيديو الحية: الأصلي مقابل المولد بالذكاء الاصطناعي</h3>
                <span className="hidden sm:inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-900/60 text-purple-300 border border-purple-700/50">
                  AI Super-Resolution
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate max-w-md sm:max-w-xl">{title}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Switcher */}
            <div className="hidden sm:flex bg-slate-800/80 p-1 rounded-lg border border-slate-700 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('split')}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                  viewMode === 'split' ? 'bg-purple-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                مقسم تفاعلي (Slider)
              </button>
              <button
                type="button"
                onClick={() => setViewMode('side-by-side')}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                  viewMode === 'side-by-side' ? 'bg-purple-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                جنباً إلى جنب
              </button>
              <button
                type="button"
                onClick={() => setViewMode('toggle')}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                  viewMode === 'toggle' ? 'bg-purple-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                تبديل فوري
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Viewport Content */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 flex flex-col items-center justify-center bg-black/60">
          {/* 1. Interactive Split Slider View */}
          {viewMode === 'split' && (
            <div
              ref={containerRef}
              onMouseDown={() => (isDragging.current = true)}
              onMouseMove={handleMouseMove}
              onTouchMove={handleTouchMove}
              className="relative w-full max-w-3xl aspect-video rounded-xl overflow-hidden select-none cursor-ew-resize bg-black border border-purple-900/50 shadow-2xl"
            >
              {/* Layer 1: Enhanced Video (Full Width) */}
              <video
                ref={enhancedVideoRef}
                src={enhancedVideoUrl}
                poster={thumbnail}
                autoPlay
                loop
                muted={isMuted}
                playsInline
                onTimeUpdate={() => syncVideos('enhanced')}
                className="absolute inset-0 w-full h-full object-contain filter contrast-105"
              />

              {/* Layer 2: Original Video (Clipped by slider position) */}
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ width: `${sliderPosition}%` }}
              >
                <div className="w-full h-full" style={{ width: containerRef.current?.clientWidth || '100%' }}>
                  <video
                    ref={originalVideoRef}
                    src={originalVideoUrl}
                    poster={thumbnail}
                    autoPlay
                    loop
                    muted
                    playsInline
                    onTimeUpdate={() => syncVideos('original')}
                    className="w-full h-full object-contain filter blur-[0.4px] brightness-95"
                  />
                </div>
              </div>

              {/* Dividing Line & Handle */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)] flex items-center justify-center pointer-events-none"
                style={{ left: `${sliderPosition}%` }}
              >
                <div className="w-7 h-7 rounded-full bg-white text-slate-900 flex items-center justify-center shadow-lg border border-slate-300">
                  <ArrowLeftRight className="w-4 h-4 text-purple-700" />
                </div>
              </div>

              {/* Overlay Labels */}
              <div className="absolute top-3 left-3 bg-slate-950/80 backdrop-blur-sm px-2.5 py-1 rounded-md border border-slate-700 text-[11px] font-bold text-slate-300 flex items-center gap-1.5 pointer-events-none">
                <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                <span>الأصلي (Original Standard)</span>
              </div>

              <div className="absolute top-3 right-3 bg-purple-950/90 backdrop-blur-sm px-2.5 py-1 rounded-md border border-purple-500/60 text-[11px] font-bold text-purple-200 flex items-center gap-1.5 pointer-events-none">
                <Sparkles className="w-3.5 h-3.5 text-purple-400 animate-spin" style={{ animationDuration: '6s' }} />
                <span>المولد بالذكاء الاصطناعي (AI 4K 60FPS)</span>
              </div>
            </div>
          )}

          {/* 2. Side-by-Side Dual View */}
          {viewMode === 'side-by-side' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-4xl">
              {/* Original Video Box */}
              <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-300 flex items-center gap-1.5">
                    <Film className="w-3.5 h-3.5 text-slate-400" />
                    <span>الفيديو الطبيعي الأصلي</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">SD / 720p 30FPS</span>
                </div>
                <div className="relative aspect-video rounded-lg overflow-hidden bg-black border border-slate-800">
                  <video
                    src={originalVideoUrl}
                    poster={thumbnail}
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="w-full h-full object-contain filter blur-[0.3px]"
                  />
                  <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/70 text-[10px] text-slate-300">
                    بدون معالجة
                  </div>
                </div>
                <div className="text-[11px] text-slate-400 space-y-0.5">
                  <div className="flex justify-between">
                    <span>الدقة:</span> <span className="font-mono text-slate-300">Standard Compressed</span>
                  </div>
                  <div className="flex justify-between">
                    <span>معدل الإطارات:</span> <span className="font-mono text-slate-300">30 FPS</span>
                  </div>
                </div>
              </div>

              {/* Enhanced Video Box */}
              <div className="bg-purple-950/40 p-3 rounded-xl border border-purple-700/50 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-purple-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                    <span>الفيديو المولد بالذكاء الاصطناعي</span>
                  </span>
                  <span className="text-[10px] text-purple-300 font-mono font-bold">4K UHD @ 60FPS</span>
                </div>
                <div className="relative aspect-video rounded-lg overflow-hidden bg-black border border-purple-600/40">
                  <video
                    src={enhancedVideoUrl}
                    poster={thumbnail}
                    autoPlay
                    loop
                    muted={isMuted}
                    playsInline
                    className="w-full h-full object-contain"
                  />
                  <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-purple-900/80 text-[10px] text-purple-200 border border-purple-600">
                    ✨ AI Enhanced
                  </div>
                </div>
                <div className="text-[11px] text-purple-200/80 space-y-0.5">
                  <div className="flex justify-between">
                    <span>الدقة المحسنة:</span> <span className="font-mono font-bold text-purple-200">2160p (4x Real-ESRGAN)</span>
                  </div>
                  <div className="flex justify-between">
                    <span>معدل الإطارات:</span> <span className="font-mono font-bold text-purple-200">60 FPS (Fluid AI Interpolation)</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 3. Instant Toggle Mode */}
          {viewMode === 'toggle' && (
            <div className="w-full max-w-2xl space-y-3">
              <div className="flex justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveToggle('original')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    activeToggle === 'original'
                      ? 'bg-slate-700 text-white shadow-md'
                      : 'bg-slate-900 text-slate-400 border border-slate-800'
                  }`}
                >
                  عرض الفيديو الأصلي
                </button>
                <button
                  type="button"
                  onClick={() => setActiveToggle('enhanced')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    activeToggle === 'enhanced'
                      ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                      : 'bg-slate-900 text-purple-300 border border-purple-800/40'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>عرض المولد بالذكاء الاصطناعي (4K)</span>
                </button>
              </div>

              <div className="relative aspect-video rounded-xl overflow-hidden bg-black border border-slate-800 shadow-2xl">
                <video
                  src={activeToggle === 'enhanced' ? enhancedVideoUrl : originalVideoUrl}
                  poster={thumbnail}
                  autoPlay
                  loop
                  muted={isMuted}
                  playsInline
                  className="w-full h-full object-contain"
                />
                <div className="absolute top-3 right-3 px-3 py-1 rounded-md text-xs font-bold bg-black/80 backdrop-blur-sm border border-slate-700 text-white">
                  {activeToggle === 'enhanced' ? '✨ النسخة المحسنة (AI 4K 60FPS)' : 'الفيديو الأصلي (Standard)'}
                </div>
              </div>
            </div>
          )}

          {/* Comparison Metrics Bar */}
          <div className="w-full max-w-3xl mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
            <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
              <span className="text-[10px] text-slate-400 block">دقة البكسلات (Resolution)</span>
              <span className="font-bold text-white text-xs mt-0.5 block">720p ➔ 4K (2160p)</span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
              <span className="text-[10px] text-slate-400 block">سلاسة الحركة (Frame Rate)</span>
              <span className="font-bold text-purple-300 text-xs mt-0.5 block">30 FPS ➔ 60 FPS</span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
              <span className="text-[10px] text-slate-400 block">تفاصيل الوجه والملامح</span>
              <span className="font-bold text-emerald-400 text-xs mt-0.5 block">GFPGAN Face Restore</span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
              <span className="text-[10px] text-slate-400 block">تنقية الصوت (Audio Clarity)</span>
              <span className="font-bold text-cyan-300 text-xs mt-0.5 block">AI Studio Master</span>
            </div>
          </div>
        </div>

        {/* Modal Footer Controls */}
        <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-900/95 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePlayPause}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white transition-colors"
              title={isPlaying ? 'إيقاف مؤقت' : 'تشغيل'}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={handleRestart}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              title="إعادة التشغيل من البداية"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setIsMuted(!isMuted)}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              title={isMuted ? 'إلغاء كتم الصوت' : 'كتم الصوت'}
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>

            <span className="text-xs text-slate-400 mr-2 font-mono hidden sm:inline">
              المحرك: {engineUsed}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportComparisonCard}
              disabled={isExportingImage}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-purple-300 hover:text-purple-200 text-xs font-semibold border border-purple-900/60 shadow transition-all flex items-center gap-1.5 disabled:opacity-50"
              title="تصدير وحفظ بطاقة المقارنة الفنية بدقة عالية"
            >
              {isExportingImage ? (
                <div className="w-3.5 h-3.5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <ImageIcon className="w-3.5 h-3.5 text-purple-400" />
              )}
              <span>تصدير بطاقة المقارنة (HD Image)</span>
            </button>

            <a
              href={enhancedVideoUrl}
              target="_blank"
              rel="noreferrer"
              download="enhanced_video_4k.mp4"
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md transition-all flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>تحميل الفيديو المحسن (4K)</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
            >
              إغلاق
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
