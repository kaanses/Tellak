import { create } from 'zustand';

type ToastType = 'error' | 'success' | 'info';

export interface Toast {
    id: string;
    message: string;
    type: ToastType;
}

interface ToastStore {
    toasts: Toast[];
    addToast: (message: string, type?: ToastType) => void;
    removeToast: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
    toasts: [],
    addToast: (message, type = 'error') => {
        const id = Math.random().toString(36).slice(2, 9);
        set(s => ({ toasts: [...s.toasts, { id, message, type }] }));
        setTimeout(() => {
            set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
        }, 5000);
    },
    removeToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}));

export function useToast() {
    const addToast = useToastStore(s => s.addToast);
    return {
        error:   (msg: string) => addToast(msg, 'error'),
        success: (msg: string) => addToast(msg, 'success'),
        info:    (msg: string) => addToast(msg, 'info'),
    };
}
