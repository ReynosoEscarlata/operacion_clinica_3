import bcrypt from 'bcryptjs';

import { env } from '../config/env.js';

export const hashPassword = async (plain: string): Promise<string> =>
  bcrypt.hash(plain, env.BCRYPT_SALT_ROUNDS);

export const verifyPassword = async (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plain, hash);
