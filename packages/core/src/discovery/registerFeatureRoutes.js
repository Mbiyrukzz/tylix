export function registerFeatureRoutes(router, features) {
  for (const { manifest, controller } of features) {
    const base = `/api/${manifest.table}`;

    router.get(base, (req, res) => controller.index(req, res));
    router.get(`${base}/:id`, (req, res) => controller.show(req, res));
    router.post(base, (req, res) => controller.store(req, res));
    router.put(`${base}/:id`, (req, res) => controller.update(req, res));
    router.delete(`${base}/:id`, (req, res) => controller.destroy(req, res));
  }
}
