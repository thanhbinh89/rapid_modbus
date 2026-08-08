/**
 * Autosave to IndexedDB.
 *
 * A field session is often interrupted — the laptop sleeps, the tab is closed
 * by accident, the browser updates. Losing twenty carefully entered register
 * definitions to any of those is unacceptable, so the workspace is written
 * back on every change.
 */

import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import type { Workspace } from './workspace';
import { validateWorkspace } from './workspace';

const DB_NAME = 'rapid_modbus';
const DB_VERSION = 1;
const STORE = 'workspace';
const CURRENT_KEY = 'current';

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE);
      }
    },
  });
  return dbPromise;
}

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  try {
    const database = await db();
    await database.put(STORE, workspace, CURRENT_KEY);
  } catch {
    // Private browsing and full disks both make IndexedDB throw. Autosave is
    // a convenience — never let it break the session in progress.
  }
}

export async function loadWorkspace(): Promise<Workspace | null> {
  try {
    const database = await db();
    const raw = await database.get(STORE, CURRENT_KEY);
    if (!raw) return null;
    return validateWorkspace(raw);
  } catch {
    // A workspace written by an incompatible build should not wedge startup.
    return null;
  }
}

export async function clearWorkspace(): Promise<void> {
  try {
    const database = await db();
    await database.delete(STORE, CURRENT_KEY);
  } catch {
    // Nothing to do.
  }
}

/** Coalesces bursts of edits into one write. */
export function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  ms: number,
): (...args: T) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: T) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
