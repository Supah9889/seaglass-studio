import { invoke, isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';

export const isDesktopRuntime = () => isTauri();

/** A native save failure whose message is safe to show; the previous file is unchanged. */
export class DesktopSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesktopSaveError';
  }
}

export async function saveDesktopFile(
  bytes: Uint8Array,
  label: string,
  extension: string,
  defaultPath: string,
): Promise<boolean> {
  if (!isTauri()) return false;
  const path = await save({
    title: `Save ${label}`,
    defaultPath,
    filters: [{ name: label, extensions: [extension] }],
  });
  if (!path) return false;
  const targetPath = path.toLowerCase().endsWith(`.${extension.toLowerCase()}`)
    ? path
    : `${path}.${extension}`;
  // SG-05: the native command stages and flushes the bytes, then replaces the
  // dialog-approved destination in one step so a failure keeps the previous file.
  try {
    await invoke('save_file_atomically', bytes, {
      headers: {
        'approved-path': encodeURIComponent(path),
        'target-path': encodeURIComponent(targetPath),
      },
    });
  } catch (error) {
    throw new DesktopSaveError(typeof error === 'string' ? error : error instanceof Error ? error.message : 'The file could not be saved.');
  }
  return true;
}
