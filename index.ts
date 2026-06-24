import type { KeyValueAdapter } from "adminforth";
import { AdapterOptions } from "./types.js";
import { Level } from 'level';

export default class LevelDBKeyValueAdapter implements KeyValueAdapter {
  options: AdapterOptions;
  private db: Level;
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
    this.db = new Level(this.options.dbPath, this.options.dbOptions || {});
  }

  protected getActualKey(key: string, collection?: string): string {
    if (collection) {
      return `${collection}:${key}`;
    }
    return key;
  }

  async set(key, value, expiresInSeconds?, collection?: string) {
    const actualKey = this.getActualKey(key, collection);
    let dataToSave: { value: any; expireAt?: number } = { value: value };
    if (expiresInSeconds) {
      const expireAt = Date.now() + (expiresInSeconds * 1000);
      dataToSave.expireAt = expireAt;
    }
    await this.db.put(actualKey, JSON.stringify(dataToSave));

    if (!expiresInSeconds) return;
    setTimeout(async () => {
      await this.db.del(actualKey).catch(() => null);
    }, (expiresInSeconds || 0) * 1000);
  }

  async get(key, collection?: string) {
    const actualKey = this.getActualKey(key, collection);
    const value = await this.db.get(actualKey).catch(() => null);
    if (value === undefined) return null;
    const parsed = JSON.parse(value);
    if (parsed.expireAt && Date.now() > parsed.expireAt) {
      await this.db.del(actualKey).catch(() => null);
      return null;
    }
    return parsed.value;
  }

  async delete(key, collection?: string) {
    const actualKey = this.getActualKey(key, collection);
    await this.db.del(actualKey);
  }

  async listByPrefix(prefix: string, limit?: number, collection?: string): Promise<Record<string, string>[]> {
    if (typeof limit === 'number' && limit <= 0) return [];

    const actualPrefix = this.getActualKey(prefix, collection);
    const results: Record<string, string>[] = [];
    const upperBound = `${actualPrefix}\xFF`;

    for await (const [key, value] of this.db.iterator({ gte: actualPrefix, lt: upperBound })) {
      const parsed = JSON.parse(String(value));
      if (parsed.expireAt && Date.now() > parsed.expireAt) {
        await this.db.del(String(key)).catch(() => null);
        continue;
      }

      results.push({ [String(key)]: String(parsed.value) });
      if (results.length >= limit) break;
    }

    return results;
  }
}
