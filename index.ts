import type { KeyValueAdapter } from "adminforth";
import { AdapterOptions } from "./types.js";

export default class LevelDBKeyValueAdapter implements KeyValueAdapter {
  options: AdapterOptions;

  constructor(options: AdapterOptions) {
    this.options = options;
  }

  validate() {

  }

 async set(key, value, expiresInSeconds?) {

  }

  async get(key) {
    
    return null;
  }

  async delete(key) {

  }

}
