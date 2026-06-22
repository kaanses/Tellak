import { useState, useEffect } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export function useUpdater() {
    const [update, setUpdate]         = useState<Update | null>(null);
    const [installing, setInstalling] = useState(false);
    const [dismissed, setDismissed]   = useState(false);

    useEffect(() => {
        // Check 4s after launch so it doesn't delay startup
        const timer = setTimeout(async () => {
            try {
                const result = await check();
                if (result?.available) setUpdate(result);
            } catch {
                // Silently ignore — expected in dev or when offline
            }
        }, 4000);
        return () => clearTimeout(timer);
    }, []);

    const install = async () => {
        if (!update) return;
        setInstalling(true);
        try {
            await update.downloadAndInstall();
            await relaunch();
        } catch {
            setInstalling(false);
        }
    };

    return {
        version:   update?.version ?? null,
        available: !!update && !dismissed,
        installing,
        install,
        dismiss:   () => setDismissed(true),
    };
}
