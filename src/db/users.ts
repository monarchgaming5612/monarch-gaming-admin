import { count } from 'drizzle-orm';
import { db } from './index.ts';
import { users } from './schema.ts';

const ADMIN_EMAILS = new Set(
  [
    'monarchgaming5612@gmail.com',
    'mzimbagumani@gmail.com',
    (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  ].filter(Boolean)
);

export async function getOrCreateUser(uid: string, email: string) {
  const normalizedEmail = email.trim().toLowerCase();

  try {
    const [{ total }] = await db.select({ total: count() }).from(users);
    const isInitialOrAllowedAdmin =
      total === 0 || ADMIN_EMAILS.has(normalizedEmail);

    const result = await db
      .insert(users)
      .values({
        uid,
        email: normalizedEmail,
        role: isInitialOrAllowedAdmin ? 'admin' : 'user',
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: normalizedEmail,
        },
      })
      .returning();

    const user = result[0];
    if (user && ADMIN_EMAILS.has(normalizedEmail) && user.role !== 'admin') {
      const updated = await db
        .insert(users)
        .values({
          uid,
          email: normalizedEmail,
          role: 'admin',
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: {
            email: normalizedEmail,
            role: 'admin',
          },
        })
        .returning();
      return updated[0];
    }

    return user;
  } catch (error) {
    console.error('Database query failed in getOrCreateUser:', error);
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}
