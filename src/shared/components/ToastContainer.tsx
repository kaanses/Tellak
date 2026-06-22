import { createPortal } from 'react-dom';
import { useToastStore, Toast } from '../store/toastStore';

const COLORS: Record<string, { border: string; bg: string; text: string }> = {
    error:   { border: 'rgba(248,113,113,0.4)',  bg: 'rgba(248,113,113,0.15)',  text: '#fca5a5' },
    success: { border: 'rgba(212,146,10,0.35)', bg: 'rgba(212,146,10,0.12)',  text: '#E8A820' },
    info:    { border: 'rgba(96,165,250,0.35)',   bg: 'rgba(96,165,250,0.12)',   text: '#93c5fd' },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
    const c = COLORS[toast.type];
    return (
        <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '12px 14px',
            background: c.bg,
            border: `1px solid ${c.border}`,
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderRadius: 12,
            pointerEvents: 'auto',
            animation: 'toast-in 0.2s ease',
        }}>
            <p style={{ margin: 0, flex: 1, fontSize: 13, color: c.text, lineHeight: 1.5, wordBreak: 'break-word' }}>
                {toast.message}
            </p>
            <button
                onClick={onDismiss}
                style={{
                    flexShrink: 0, marginTop: 1,
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'rgba(255,255,255,0.3)', fontSize: 14, lineHeight: 1,
                    padding: '0 2px', transition: 'color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.3)')}
            >
                ✕
            </button>
        </div>
    );
}

export function ToastContainer() {
    const toasts     = useToastStore(s => s.toasts);
    const removeToast = useToastStore(s => s.removeToast);

    return createPortal(
        <>
            <style>{`
                @keyframes toast-in {
                    from { opacity: 0; transform: translateX(20px); }
                    to   { opacity: 1; transform: translateX(0); }
                }
            `}</style>
            <div style={{
                position: 'fixed',
                bottom: 24,
                right: 24,
                zIndex: 99999,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                maxWidth: 380,
                width: 'max-content',
                pointerEvents: 'none',
            }}>
                {toasts.map(t => (
                    <ToastItem key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
                ))}
            </div>
        </>,
        document.body
    );
}
