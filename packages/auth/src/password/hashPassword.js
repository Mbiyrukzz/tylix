import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(plainPassword) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scrypt(plainPassword, salt, KEY_LENGTH);
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(plainPassword, storedHash) {
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) return false;

  const derivedKey = await scrypt(plainPassword, salt, KEY_LENGTH);
  return derivedKey.toString("hex") === key;
}
