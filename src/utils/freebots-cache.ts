const memoryCache = new Map<string, string>();
const XML_BASE = '/xml/';

export const fetchXmlWithCache = async (file: string): Promise<string | null> => {
    if (memoryCache.has(file)) return memoryCache.get(file) || null;
    try {
        const response = await fetch(`${XML_BASE}${file}`);
        if (!response.ok) return null;
        const xml = await response.text();
        memoryCache.set(file, xml);
        return xml;
    } catch {
        return null;
    }
};

export const prefetchAllXmlInBackground = async (files: string[]) => {
    for (let i = 0; i < files.length; i += 3) {
        const batch = files.slice(i, i + 3);
        await Promise.all(batch.map(f => fetchXmlWithCache(f).catch(() => null)));
    }
};

export const getBotsManifest = async (): Promise<{ name: string; file: string }[]> => {
    return [];
};
