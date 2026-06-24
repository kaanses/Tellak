import { useAppStore, type Lang } from "../store";
import { en } from "./en";
import { tr } from "./tr";

export type { Lang };

const dicts: Record<Lang, Record<string, string>> = { en, tr };

// Look up a key for the given language, falling back to English, then the raw
// key itself. Replaces {placeholders} from `vars`.
export function translate(
    lang: Lang,
    key: string,
    vars?: Record<string, string | number>,
): string {
    let s = dicts[lang][key] ?? dicts.en[key] ?? key;
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
    }
    return s;
}

export type TFn = (key: string, vars?: Record<string, string | number>) => string;

export function useI18n(): { t: TFn; lang: Lang; setLang: (l: Lang) => void } {
    const lang = useAppStore((s) => s.lang);
    const setLang = useAppStore((s) => s.setLang);
    const t: TFn = (key, vars) => translate(lang, key, vars);
    return { t, lang, setLang };
}
