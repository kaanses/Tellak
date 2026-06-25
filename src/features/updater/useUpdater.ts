import { useState, useEffect } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export function useUpdater() {
    const [update, setUpdate]         = useState<Update | null>(null);
    const [installing, setInstalling] = useState(false);
    const [dismissed, setDismissed]   = useState(false);
    const [error, setError]           = useState<string | null>(null);

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
        setError(null);
        try {
            await update.downloadAndInstall();
            await relaunch();
        } catch (e) {
            // Surface the failure instead of looking like a dead button. The
            // common causes are: the app is running from the DMG / outside
            // /Applications (can't overwrite itself), or an older build whose
            // baked updater pubkey can't verify the new signature. In both
            // cases the user must download the new build manually.
            setError(String(e));
            setInstalling(false);
        }
    };

    return {
        version:   update?.version ?? null,
        available: !!update && !dismissed,
        installing,
        error,
        install,
        dismiss:   () => setDismissed(true),
    };
}
