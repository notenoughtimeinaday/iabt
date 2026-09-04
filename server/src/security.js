import {
  createHash,
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

export const validatePassword = (password) => {
  const value = String(password || "");
  if (value.length < 10) {
    throw Object.assign(new Error("Password must contain at least 10 characters"), {
      status: 400,
      code: "weak_password"
    });
  }
  if (!/[a-z]/i.test(value) || !/[0-9]/.test(value)) {
    throw Object.assign(new Error("Password must include letters and numbers"), {
      status: 400,
      code: "weak_password"
    });
  }
  return value;
};

export const hashPassword = async (password) => {
  const value = validatePassword(password);
  const salt = randomBytes(16);
  const derived = await scrypt(value, salt, 64);
  return `scrypt:${salt.toString("base64url")}:${Buffer.from(derived).toString("base64url")}`;
};

export const verifyPassword = async (password, encoded) => {
  const [algorithm, saltValue, hashValue] = String(encoded || "").split(":");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  const salt = Buffer.from(saltValue, "base64url");
  const expected = Buffer.from(hashValue, "base64url");
  const actual = Buffer.from(await scrypt(String(password || ""), salt, expected.length));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export const createOpaqueToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token) =>
  createHash("sha256").update(String(token || "")).digest("hex");
export const createOtp = () => String(randomInt(100000, 1000000));
export const createId = () => randomBytes(16).toString("hex");
