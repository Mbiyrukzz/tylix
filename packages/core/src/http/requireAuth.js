import { verifyTylixAccessToken, ACCESS_TOKEN_COOKIE } from "@tylix/auth";

// Shared across packages (Symbol.for), so `tylix dev` can print a lock next
// to every guarded route without importing anything from here.
const AUTH_MARK = Symbol.for("tylix.requireAuth");

/**
 * Wraps a route handler so it only runs if the request carries a valid
 * session. Checks the httpOnly access-token cookie first (what the
 * browser app now uses), then falls back to an
 * "Authorization: Bearer <token>" header (for non-browser API clients
 * that can't rely on cookies). On success, req.user is set to the
 * token's payload (e.g. { userId, sid }); on failure, responds 401 and
 * never calls the wrapped handler.
 *
 * Only real access tokens pass: email-verification links and other
 * purpose tokens are refused, and when the app's AuthController manages
 * sessions, a token whose session was ended (logout, "sign out
 * everywhere", password reset) is refused immediately.
 *
 * options.hydrate(payload, req) is optional. It runs after the token is
 * verified and can add fields to req.user (for example a team id):
 *   - return an object  -> its fields are merged into req.user
 *   - return null/false -> the request is rejected with 401
 *   - throw             -> the request is rejected with 500
 */
export function requireAuth(handler, secret, options = {}) {
    const { hydrate } = options;

    const guarded = async (req, res) => {
        const cookieToken = req.cookies?.[ACCESS_TOKEN_COOKIE];

        const authHeader = req.headers?.authorization || "";
        const [scheme, headerToken] = authHeader.split(" ");
        const bearerToken = /^bearer$/i.test(scheme ?? "") ? headerToken : null;

        const token = cookieToken || bearerToken;

        if (!token) {
            return res.status(401).json({ error: "Not authenticated." });
        }

        let result;
        try {
            result = await verifyTylixAccessToken(token, secret);
        } catch (error) {
            console.error("[auth] token check failed:", error);
            return res.status(500).json({ error: "Couldn't check your session." });
        }
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

    guarded[AUTH_MARK] = true;
    return guarded;
}