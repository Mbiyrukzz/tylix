import { verifyToken } from "@tylix/auth";

/**
 * Wraps a route handler so it only runs if the request carries a valid
 * "Authorization: Bearer <token>" header. On success, req.user is set
 * to the token's payload (e.g. { userId }); on failure, responds 401
 * and never calls the wrapped handler.
 */
export function requireAuth(handler, secret) {
  return async (req, res) => {
    const authHeader = req.headers?.authorization || "";
    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({ error: "Missing or malformed Authorization header." });
    }

    const result = verifyToken(token, secret);
    if (!result.valid) {
      return res.status(401).json({ error: result.error || "Invalid token." });
    }

    req.user = result.payload;
    return handler(req, res);
  };
}
