import type { KeyValueAdapter } from "adminforth";
import { AdapterOptions } from "./types.js";
import { Level } from 'level';
import path from 'node:path';

const DEFAULT_COLLECTION = 'default_collection';

export default class LevelDBKeyValueAdapter implements KeyValueAdapter {
  options: AdapterOptions;
  private dbs: Map<string, Level> = new Map();
  private static registeredDbPaths: string[] = [];

  constructor(options: AdapterOptions) {
    this.options = options;
    if (LevelDBKeyValueAdapter.registeredDbPaths.includes(this.options.dbPath)) {
      throw new Error(`Database path "${this.options.dbPath}" is already registered.
        Seems like you are trying to use the same database path for multiple instances of LevelDBKeyValueAdapter.
        If you want to use the same database path for multiple instances, then you should use a single instance of LevelDBKeyValueAdapter and share it across your application.
        For example:
        const levelDbAdapter = new LevelDBKeyValueAdapter({ dbPath: 'path/to/db' });
        //instance 1
        new StorageAdapter({... keyValueAdapter: levelDbAdapter });
        //instance 2
        new StorageAdapter({... keyValueAdapter: levelDbAdapter });
      `);
    }
    LevelDBKeyValueAdapter.registeredDbPaths.push(this.options.dbPath);
  }

  // Each collection lives in its own LevelDB. The collection-less database is
  // stored directly at `dbPath`, while every named collection gets its own
  // subdirectory, e.g. `dbPath/dev` and `dbPath/live`. Connections are opened
  // lazily and cached so a collection is opened at most once.
  protected getDb(collection?: string): Level {
    const collectionKey = collection || DEFAULT_COLLECTION;
    let db = this.dbs.get(collectionKey);
    if (!db) {
      const dbPath = collection
        ? path.join(this.options.dbPath, collection)
        : this.options.dbPath;
      db = new Level(dbPath, this.options.dbOptions || {});
      this.dbs.set(collectionKey, db);
    }
    return db;
  }

  async set(key, value, expiresInSeconds?, collection?: string) {
    const db = this.getDb(collection);
    let dataToSave: { value: any; expireAt?: number } = { value: value };
    if (expiresInSeconds) {
      const expireAt = Date.now() + (expiresInSeconds * 1000);
      dataToSave.expireAt = expireAt;
    }
    await db.put(key, JSON.stringify(dataToSave));

    if (!expiresInSeconds) return;
    setTimeout(async () => {
      await db.del(key).catch(() => null);
    }, (expiresInSeconds || 0) * 1000);
  }

  async get(key, collection?: string) {
    const db = this.getDb(collection);
    const value = await db.get(key).catch(() => null);
    if (value === undefined || value === null) return null;
    const parsed = JSON.parse(value);
    if (parsed.expireAt && Date.now() > parsed.expireAt) {
      await db.del(key).catch(() => null);
      return null;
    }
    return parsed.value;
  }

  async delete(key, collection?: string) {
    const db = this.getDb(collection);
    await db.del(key);
  }

  async listByPrefix(prefix: string, limit?: number, collection?: string): Promise<Record<string, string>[]> {
    if (typeof limit === 'number' && limit <= 0) return [];

    const db = this.getDb(collection);
    const results: Record<string, string>[] = [];
    const upperBound = `${prefix}\xFF`;

    for await (const [key, value] of db.iterator({ gte: prefix, lt: upperBound })) {
      const parsed = JSON.parse(String(value));
      if (parsed.expireAt && Date.now() > parsed.expireAt) {
        await db.del(String(key)).catch(() => null);
        continue;
      }

      results.push({ [String(key)]: String(parsed.value) });
      if (results.length >= limit) break;
    }

    return results;
  }
}
