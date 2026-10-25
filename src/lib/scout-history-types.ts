export interface ScoutHistoryEntry {
    id: string;
    url: string;
    domain: string;
    status: string;
    createdAt: string;
    devices: string[];
    pages: { url: string; title: string }[];
}

export interface ScoutHistoryPage {
    scouts: ScoutHistoryEntry[];
    nextCursor: string | null;
}
