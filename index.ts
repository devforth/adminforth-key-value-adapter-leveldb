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

  async set(key, value, expiresInSeconds?) {
    let dataToSave: { value: any; expireAt?: number } = { value: value };
    if (expiresInSeconds) {
      const expireAt = Date.now() + (expiresInSeconds * 1000);
      dataToSave.expireAt = expireAt;
    }
    await this.db.put(key, JSON.stringify(dataToSave));

    if (!expiresInSeconds) return;
    setTimeout(async () => {
      await this.db.del(key).catch(() => null);
    }, (expiresInSeconds || 0) * 1000);
  }

  async get(key) {
    const value = await this.db.get(key).catch(() => null);
    if (value === undefined) return null;
    const parsed = JSON.parse(value);
    if (parsed.expireAt && Date.now() > parsed.expireAt) {
      await this.db.del(key).catch(() => null);
      return null;
    }
    return parsed.value;
  }

  async delete(key) {
    await this.db.del(key);
  }

  async listByPrefix(prefix: string, limit: number): Promise<Record<string, string>[]> {
    if (limit <= 0) return [];

    const results: Record<string, string>[] = [];
    const upperBound = `${prefix}\xFF`;

    for await (const [key, value] of this.db.iterator({ gte: prefix, lt: upperBound })) {
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
