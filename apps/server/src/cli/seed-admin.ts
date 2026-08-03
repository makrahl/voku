import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { openDatabase } from '../db/open.js';
import { createTeacher, findTeacherByEmail, setTeacherPassword } from '../services/auth.js';

/**
 * Creates or resets the single teacher account.
 *   npm run seed-admin -- teacher@school.de
 * Password is read from VOKU_ADMIN_PASSWORD or prompted for.
 */
const [, , emailArg] = process.argv;

const db = openDatabase();

const rl = createInterface({ input: stdin, output: stdout });
try {
  const email = emailArg ?? (await rl.question('Email: '));
  if (!email.trim()) {
    console.error('An email address is required.');
    process.exit(1);
  }

  let password = process.env.VOKU_ADMIN_PASSWORD ?? '';
  if (!password) password = await rl.question('Password: ');
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const existing = findTeacherByEmail(db, email);
  if (existing) {
    setTeacherPassword(db, existing.id, password);
    console.log(`Password reset for ${existing.email}.`);
  } else {
    const created = createTeacher(db, email, password);
    // The first account created this way owns the instance.
    const first = !db.get('SELECT 1 FROM teachers WHERE id != :id', { id: created.id });
    if (first) db.run('UPDATE teachers SET is_admin = 1 WHERE id = :id', { id: created.id });
    console.log(`Created ${first ? 'admin' : 'teacher'} account ${created.email}.`);
  }
} finally {
  rl.close();
  db.close();
}
