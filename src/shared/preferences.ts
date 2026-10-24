import type {Preferences} from './contracts';
import {language} from './validation';

export async function readPreferences(): Promise<Preferences> {
    const saved: Record<string, unknown> = await chrome.storage.local.get(['model', 'effort', 'language', 'markdown']);
    return {model: typeof saved.model === 'string' ? saved.model : '',
        effort: typeof saved.effort === 'string' ? saved.effort : '',
        language: saved.language === undefined ? '简体中文' : language(saved.language), markdown: saved.markdown !== false};
}
