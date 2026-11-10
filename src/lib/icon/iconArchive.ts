import { Unzip, UnzipInflate } from 'fflate';
import { sourceName, type IconSource } from './iconAssets';

/** Stream entries to retain duplicate names and enforce limits before unbounded unzip. */
export function extractIconZip(bytes: Uint8Array): IconSource[] {
  if (bytes.length > 32 * 1024 * 1024) throw new Error('ZIP 文件不能超过 32 MiB');
  const sources: IconSource[] = [], seen = new Set<string>();
  let total = 0, pending = 0;
  const unzip = new Unzip(file => {
    if (file.name.endsWith('/')) return;
    const name = sourceName(file.name).name;
    if (seen.has(name)) throw new Error(`ZIP 有重复素材: ${file.name}`);
    seen.add(name);
    if (seen.size > 256 || (file.originalSize ?? 0) > 16 * 1024 * 1024) throw new Error('ZIP 素材数量或单个文件过大');
    const parts: Uint8Array[] = []; let size = 0;
    pending++;
    file.ondata = (error, data, final) => {
      if (error) throw error;
      size += data.length; total += data.length;
      if (size > 16 * 1024 * 1024 || total > 64 * 1024 * 1024) throw new Error('ZIP 解压后素材过大（单文件 16 MiB，总计 64 MiB）');
      parts.push(data);
      if (final) {
        const out = new Uint8Array(size); let at = 0;
        for (const part of parts) { out.set(part, at); at += part.length; }
        sources.push({ name, data: out }); pending--;
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.push(bytes, true);
  if (pending || !sources.length) throw new Error('ZIP 不完整或没有可用素材');
  return sources;
}
