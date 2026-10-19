import { verifyToken, ACCESS_TOKEN_COOKIE } from "@tylix/auth";

/**
 * Wraps a route handler so it only runs if the request carries a valid
 * session. Checks the httpOnly access-token cookie first (what the
 * browser app now uses), then falls back to an
 * "Authorization: Bearer <token>" header (for non-browser API clients
 * that can't rely on cookies). On success, req.user is set to the
 * token's payload (e.g. { userId }); on failure, responds 401 and
 * never calls the wrapped handler.
 *
 * options.hydrate(payload, req) is optional. It runs after the token is
 * verified and can add fields to req.user (for example a team id):
 *   - return an object  -> its fields are merged into req.user
 *   - return null/false -> the request is rejected with 401
 *   - throw             -> the request is rejected with 500
 */
export function requireAuth(handler, secret, options = {}) {
    const { hydrate } = options;

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

        if (typeof hydrate === "function") {
            let extra;
            try {
                extra = await hydrate(result.payload, req);
            } catch (error) {
                console.error("[auth] hydrate failed:", error);
                return res.status(500).json({ error: "Couldn't load your account." });
            }

            if (extra === null || extra === false) {
                return res.status(401).json({ error: "Not authenticated." });
            }
            if (extra && typeof extra === "object") {
                req.user = { ...result.payload, ...extra };
            }
        }

        return handler(req, res);
    };
}