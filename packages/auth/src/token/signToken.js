import { createHmac, timingSafeEqual } from "node:crypto";

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(payloadB64, secret) {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export function signToken(payload, secret, { expiresInSeconds } = {}) {
  const body = { ...payload };
  if (expiresInSeconds) {
    body.exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  }

  const payloadB64 = base64url(JSON.stringify(body));
  const signature = sign(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== "string" || !token.includes(".")) {
    return { valid: false, payload: null, error: "Malformed token" };
  }

  const [payloadB64, signature] = token.split(".");
  const expectedSignature = sign(payloadB64, secret);

  const sigBuffer = Buffer.from(signature ?? "", "base64url");
  const expectedBuffer = Buffer.from(expectedSignature, "base64url");

  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    return { valid: false, payload: null, error: "Invalid signature" };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  } catch {
    return { valid: false, payload: null, error: "Invalid payload" };
  }

  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    return { valid: false, payload: null, error: "Token expired" };
  }

  return { valid: true, payload, error: null };
}
