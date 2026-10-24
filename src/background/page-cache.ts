import type {CacheEntry, HoverOrigin, TaskKind} from '../shared/contracts';
import {cacheEntries} from '../shared/validation';

function pageKey(tabId: number, url: string): string | null {
    if (url.length > 2048) return null;
    try {
        const page = new URL(url);
        if (!['http:', 'https:'].includes(page.protocol)) return null;
        page.hash = '';
        return `pageCache:v2:${tabId}:${page.href}`;
    } catch { return null; }
}

export async function readPageCache(tabId: number, url: string): Promise<CacheEntry[]> {
    const key = pageKey(tabId, url);
    if (!key) return [];
    const saved: Record<string, unknown> = await chrome.storage.session.get(key);
    return cacheEntries(saved[key] ?? []);
}

export async function rememberHover(origin: HoverOrigin, source: string, kind: TaskKind, result: string): Promise<void> {
    const key = pageKey(origin.tabId, origin.url);
    if (!key || !result) return;
    const entries = await readPageCache(origin.tabId, origin.url);
    const paths = JSON.stringify(origin.paths);
    const existing = entries.find(entry => JSON.stringify(entry.paths) === paths && entry.source === source);
    const entry = {...existing, paths: origin.paths, source, [kind]: result, updatedAt: Date.now()};
    await chrome.storage.session.set({[key]: [entry, ...entries.filter(item => item !== existing)].slice(0, 60)});
}
