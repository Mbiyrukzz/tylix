import fs from 'node:fs'
import path from 'node:path'
import { requireAuth } from '../http/requireAuth.js'

// A feature "owns" its routes through app/routes/<table>.(js|ts) when that
// file exists (written by make:feature). registerRouteFiles mounts it, so
// the manifest-based mounting below must step aside to avoid duplicates.
function hasRouteFile(baseDir, table) {
    return ['js', 'ts'].some((ext) =>
        fs.existsSync(path.join(baseDir, 'app', 'routes', `${table}.${ext}`)),
    )
}

// Returns the tables that were skipped because a route file owns them.
export function registerFeatureRoutes(
    router,
    features,
    { secret, hydrate, baseDir = process.cwd() } = {},
) {
    const skipped = []

    for (const { manifest, controller } of features) {
        if (hasRouteFile(baseDir, manifest.table)) {
            skipped.push(manifest.table)
            continue
        }

        const base = `/api/${manifest.table}`;
        const wrap = (fn) => (manifest.auth ? requireAuth(fn, secret, { hydrate }) : fn);

        router.get(base, wrap((req, res) => controller.index(req, res)));
        router.get(`${base}/:id`, wrap((req, res) => controller.show(req, res)));
        router.post(base, wrap((req, res) => controller.store(req, res)));
        router.put(`${base}/:id`, wrap((req, res) => controller.update(req, res)));
        router.delete(`${base}/:id`, wrap((req, res) => controller.destroy(req, res)));
    }

    return skipped
}