import { verifyToken, ACCESS_TOKEN_COOKIE } from "@tylix/auth";

/**
 * Wraps a route handler so it only runs if the request carries a valid
 * session. Checks the httpOnly access-token cookie first (what the
 * browser app now uses), then falls back to an
 * "Authorization: Bearer <token>" header (for non-browser API clients
 * that can't rely on cookies). On success, req.user is set to the
 * token's payload (e.g. { userId }); on failure, responds 401 and
 * never calls the wrapped handler.
 */
export function requireAuth(handler, secret) {
    return async (req, res) => {
        const cookieToken = req.cookies?.[ACCESS_TOKEN_COOKIE];

        const authHeader = req.headers?.authorization || "";
        const [scheme, headerToken] = authHeader.split(" ");
        const bearerToken = scheme === "Bearer" ? headerToken : null;

        const token = cookieToken || bearerToken;

        if (!token) {
            return res.status(401).json({ error: "Not authenticated." });
        }

        const result = verifyToken(token, secret);
        if (!result.valid) {
            return res.status(401).json({ error: result.error || "Invalid token." });
        }

        req.user = result.payload;
        return handler(req, res);
    };
}
