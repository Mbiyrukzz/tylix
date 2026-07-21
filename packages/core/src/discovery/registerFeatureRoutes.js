import { requireAuth } from "../http/requireAuth.js";

export function registerFeatureRoutes(router, features, { secret } = {}) {
    for (const { manifest, controller } of features) {
        const base = `/api/${manifest.table}`;
        const wrap = (fn) => (manifest.auth ? requireAuth(fn, secret) : fn);

        router.get(base, wrap((req, res) => controller.index(req, res)));
        router.get(`${base}/:id`, wrap((req, res) => controller.show(req, res)));
        router.post(base, wrap((req, res) => controller.store(req, res)));
        router.put(`${base}/:id`, wrap((req, res) => controller.update(req, res)));
        router.delete(`${base}/:id`, wrap((req, res) => controller.destroy(req, res)));
    }
}
