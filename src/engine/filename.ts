/** Best file name for a download: Content-Disposition first, then the URL path. */
export function fileNameFrom(url: string, contentDisposition?: string | null): string {
  const fromHeader = contentDisposition && parseContentDisposition(contentDisposition);
  if (fromHeader) return sanitize(fromHeader);
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    if (last) return sanitize(decodeURIComponent(last));
  } catch {
    // fall through
  }
  return 'download';
}

function parseContentDisposition(header: string): string | undefined {
  // RFC 5987 form wins: filename*=UTF-8''na%C3%AFve.txt
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[2]!.trim().replace(/^"|"$/g, ''));
    } catch {
      // malformed escape; try the plain form
    }
  }
  const plain = /filename\s*=\s*("((?:\\.|[^"\\])*)"|[^;]+)/i.exec(header);
  if (plain) return (plain[2] ?? plain[1]!).replace(/\\(.)/g, '$1').trim();
  return undefined;
}

function sanitize(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned || 'download';
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/** "12 MB/s". */
export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(Math.round(bytesPerSecond))}/s`;
}

/** "about 3 min left", rounded so it doesn't jump around. */
export function formatTimeLeft(seconds: number): string {
  if (seconds < 60) return 'less than a minute left';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `about ${hours} h ${rest} min left` : `about ${hours} h left`;
}
