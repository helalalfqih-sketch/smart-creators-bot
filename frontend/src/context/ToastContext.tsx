import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X, ExternalLink } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  duration?: number; // duration in ms, default 4500
  action?: ToastAction;
  icon?: React.ReactNode;
}

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration: number;
  action?: ToastAction;
  createdAt: number;
}

interface ToastContextValue {
  toasts: ToastItem[];
  addToast: (type: ToastType, title: string, message?: string, options?: ToastOptions) => string;
  success: (title: string, message?: string, options?: ToastOptions) => string;
  error: (title: string, message?: string, options?: ToastOptions) => string;
  warning: (title: string, message?: string, options?: ToastOptions) => string;
  info: (title: string, message?: string, options?: ToastOptions) => string;
  removeToast: (id: string) => void;
  clearAll: () => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setToasts([]);
  }, []);

  const addToast = useCallback(
    (type: ToastType, title: string, message?: string, options?: ToastOptions) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const duration = options?.duration !== undefined ? options.duration : 4500;

      const newToast: ToastItem = {
        id,
        type,
        title,
        message,
        duration,
        action: options?.action,
        createdAt: Date.now(),
      };

      setToasts((prev) => {
        // Keep max 5 visible toasts to avoid overwhelming screen
        const updated = [...prev, newToast];
        if (updated.length > 5) {
          return updated.slice(updated.length - 5);
        }
        return updated;
      });

      return id;
    },
    []
  );

  const success = useCallback(
    (title: string, message?: string, options?: ToastOptions) =>
      addToast('success', title, message, options),
    [addToast]
  );

  const error = useCallback(
    (title: string, message?: string, options?: ToastOptions) =>
      addToast('error', title, message, options),
    [addToast]
  );

  const warning = useCallback(
    (title: string, message?: string, options?: ToastOptions) =>
      addToast('warning', title, message, options),
    [addToast]
  );

  const info = useCallback(
    (title: string, message?: string, options?: ToastOptions) =>
      addToast('info', title, message, options),
    [addToast]
  );

  return (
    <ToastContext.Provider
      value={{
        toasts,
        addToast,
        success,
        error,
        warning,
        info,
        removeToast,
        clearAll,
      }}
    >
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

// Toast Container and Toast Single Item Component
interface ToastContainerProps {
  toasts: ToastItem[];
  onRemove: (id: string) => void;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onRemove }) => {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed bottom-5 left-5 z-[9999] flex flex-col gap-2.5 max-w-sm sm:max-w-md w-full pointer-events-none"
      dir="rtl"
    >
      {toasts.map((toast) => (
        <ToastSingleItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
};

const ToastSingleItem: React.FC<{ toast: ToastItem; onRemove: (id: string) => void }> = ({
  toast,
  onRemove,
}) => {
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(100);
  const remainingTimeRef = useRef(toast.duration);
  const startTimeRef = useRef(Date.now());

  React.useEffect(() => {
    if (toast.duration <= 0) return;

    let timer: any;
    let animFrame: any;
    const intervalDuration = toast.duration;

    const tick = () => {
      if (!isPaused) {
        const elapsed = Date.now() - startTimeRef.current;
        const remaining = Math.max(0, intervalDuration - elapsed);
        const percent = (remaining / intervalDuration) * 100;
        setProgress(percent);

        if (remaining <= 0) {
          onRemove(toast.id);
          return;
        }
      }
      animFrame = requestAnimationFrame(tick);
    };

    animFrame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animFrame);
    };
  }, [toast.id, toast.duration, isPaused, onRemove]);

  const handleMouseEnter = () => {
    setIsPaused(true);
  };

  const handleMouseLeave = () => {
    setIsPaused(false);
    startTimeRef.current = Date.now() - (toast.duration * (100 - progress)) / 100;
  };

  const getTypeStyles = () => {
    switch (toast.type) {
      case 'success':
        return {
          container: 'bg-slate-900/95 border-emerald-500/50 text-slate-100 shadow-emerald-950/40',
          iconBg: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
          icon: <CheckCircle2 className="w-5 h-5 shrink-0" />,
          progressBar: 'bg-emerald-500',
          accent: 'text-emerald-400',
        };
      case 'error':
        return {
          container: 'bg-slate-900/95 border-rose-500/50 text-slate-100 shadow-rose-950/40',
          iconBg: 'bg-rose-500/20 text-rose-400 border border-rose-500/30',
          icon: <AlertCircle className="w-5 h-5 shrink-0" />,
          progressBar: 'bg-rose-500',
          accent: 'text-rose-400',
        };
      case 'warning':
        return {
          container: 'bg-slate-900/95 border-amber-500/50 text-slate-100 shadow-amber-950/40',
          iconBg: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
          icon: <AlertTriangle className="w-5 h-5 shrink-0" />,
          progressBar: 'bg-amber-500',
          accent: 'text-amber-400',
        };
      case 'info':
      default:
        return {
          container: 'bg-slate-900/95 border-indigo-500/50 text-slate-100 shadow-indigo-950/40',
          iconBg: 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30',
          icon: <Info className="w-5 h-5 shrink-0" />,
          progressBar: 'bg-indigo-500',
          accent: 'text-indigo-400',
        };
    }
  };

  const style = getTypeStyles();

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`pointer-events-auto relative overflow-hidden rounded-xl border backdrop-blur-md p-4 shadow-xl transition-all duration-300 transform translate-y-0 opacity-100 animate-in fade-in slide-in-from-bottom-3 ${style.container}`}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${style.iconBg}`}>{style.icon}</div>

        <div className="flex-1 min-w-0 pr-0.5">
          <h4 className="text-xs font-bold text-white leading-snug">{toast.title}</h4>
          {toast.message && (
            <p className="text-[11px] text-slate-300 mt-1 leading-relaxed break-words">
              {toast.message}
            </p>
          )}

          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action?.onClick();
                onRemove(toast.id);
              }}
              className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors shadow-xs"
            >
              <span>{toast.action.label}</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => onRemove(toast.id)}
          className="text-slate-400 hover:text-slate-200 p-1 rounded-md hover:bg-slate-800/60 transition-colors shrink-0"
          aria-label="إغلاق الإشعار"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Progress Bar Timer */}
      {toast.duration > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-800/80 overflow-hidden">
          <div
            className={`h-full ${style.progressBar} transition-all ease-linear`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
};
