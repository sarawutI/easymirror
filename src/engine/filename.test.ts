import { describe, expect, it } from 'vitest';
import { extensionOf, fileNameFrom, formatBytes, formatRate, formatTimeLeft } from './filename';

describe('fileNameFrom', () => {
  it('prefers the RFC 5987 filename* form', () => {
    expect(fileNameFrom('https://x.test/a', `attachment; filename="plain.txt"; filename*=UTF-8''na%C3%AFve%20file.txt`)).toBe(
      'naïve file.txt',
    );
  });

  it('reads a quoted filename', () => {
    expect(fileNameFrom('https://x.test/a', 'attachment; filename="my report.pdf"')).toBe('my report.pdf');
  });

  it('reads an unquoted filename', () => {
    expect(fileNameFrom('https://x.test/a', 'attachment; filename=archive.zip')).toBe('archive.zip');
  });

  it('falls back to the last URL path segment, decoded', () => {
    expect(fileNameFrom('https://x.test/files/My%20Video.mp4?dl=1', null)).toBe('My Video.mp4');
  });

  it('strips characters that are unsafe in file names', () => {
    expect(fileNameFrom('https://x.test/a', 'attachment; filename="../../evil:name?.txt"')).toBe('.._.._evil_name_.txt');
  });

  it('uses "download" when nothing else is available', () => {
    expect(fileNameFrom('https://x.test/', null)).toBe('download');
  });
});

describe('extensionOf', () => {
  it('lowercases the extension', () => expect(extensionOf('A.ZIP')).toBe('zip'));
  it('ignores dotfiles and names without a dot', () => {
    expect(extensionOf('.bashrc')).toBe('');
    expect(extensionOf('README')).toBe('');
  });
});

describe('formatBytes', () => {
  it('formats common sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(200 * 1024 * 1024)).toBe('200 MB');
    expect(formatBytes(5.5 * 1024 ** 3)).toBe('5.5 GB');
  });
});

describe('formatRate and formatTimeLeft', () => {
  it('shows speed per second', () => {
    expect(formatRate(12.4 * 1024 * 1024)).toBe('12.4 MB/s');
    expect(formatRate(500)).toBe('500 B/s');
  });

  it('rounds time left to whole minutes, then hours and minutes', () => {
    expect(formatTimeLeft(20)).toBe('less than a minute left');
    expect(formatTimeLeft(170)).toBe('about 3 min left');
    expect(formatTimeLeft(3600)).toBe('about 1 h left');
    expect(formatTimeLeft(4800)).toBe('about 1 h 20 min left');
  });
});
