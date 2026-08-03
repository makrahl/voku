import { Db } from './index.js';
import { migrate } from './migrations.js';
import { config } from '../config.js';

export function openDatabase(path: string = config.databasePath): Db {
  const db = new Db(path);
  migrate(db);
  return db;
}
