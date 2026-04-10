/**
 * Shared formatting utilities used across multiple screens.
 */

export function formatBytes(bytes, fallback = '') {
  if (!bytes) return fallback;
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

export function formatDuration(seconds, fallback = '') {
  if (!seconds) return fallback;
  const s = Math.round(seconds);
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

export function formatDate(timestamp) {
  if (!timestamp) return '—';
  // Timestamps < 1e12 are in seconds (Unix), convert to milliseconds
  const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  const d = new Date(ms);
  if (d.getFullYear() < 2000) return '—'; // Invalid date fallback
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
