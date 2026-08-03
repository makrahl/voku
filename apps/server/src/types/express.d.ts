import type { Db } from '../db/index.js';
import type { Teacher } from '../services/auth.js';

declare global {
  namespace Express {
    interface Request {
      db: Db;
      /** Set by requireTeacher. */
      teacher?: Teacher;
      /** Set by requireStudent. */
      student?: { id: string; class_id: string; name: string; token: string };
    }
  }
}

export {};
