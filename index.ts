import type { KeyValueAdapter } from "adminforth";
import { AdapterOptions } from "./types.js";
import { Level } from 'level';

export default class LevelDBKeyValueAdapter implements KeyValueAdapter {
  options: AdapterOptions;
  private db: Level;

  constructor(options: AdapterOptions) {
    this.options = options;
    this.db = new Level(this.options.dbPath, this.options.dbOptions || {});
  }

  async set(key, value, expiresInSeconds?) {
    await this.db.put(key, value);

    if (!expiresInSeconds) return;
    setTimeout(async () => {
      await this.db.del(key).catch(() => null);
    }, (expiresInSeconds || 0) * 1000);
  }

  async get(key) {
    const value = await this.db.get(key).catch(() => null);
    if (value === undefined) return null;
    return value;
  }

  async delete(key) {
    await this.db.del(key);
  }

}
