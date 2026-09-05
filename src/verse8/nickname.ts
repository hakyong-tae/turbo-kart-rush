/**
 * Nickname rules shared by client and server. server.js duplicates this logic verbatim
 * (no build step there) — keep the two in sync.
 */
const BLOCKED = ['nigger', 'faggot', 'retard', '씨발', '시발', '병신', '좆'];

export function normalizeNickname(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw
    .normalize('NFC')
    .replace(/[^A-Za-z0-9가-힣 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12)
    .trim();
  const low = cleaned.toLowerCase();
  if (BLOCKED.some((w) => low.includes(w))) return '';
  return cleaned;
}

export function defaultNickname(account: string): string {
  const tail = String(account || '')
    .replace(/^0x/i, '')
    .slice(-4)
    .toUpperCase();
  return tail ? `RACER-${tail}` : 'RACER';
}
