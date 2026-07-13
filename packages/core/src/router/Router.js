export class Router {
  constructor() {
    this.routes = [];
  }

  register(method, pattern, handler) {
    const keys = [];
    const regexPattern = pattern
      .split("/")
      .map((segment) => {
        if (segment.startsWith(":")) {
          keys.push(segment.slice(1));
          return "([^/]+)";
        }
        return segment;
      })
      .join("/");

    const regex = new RegExp(`^${regexPattern}$`);
    this.routes.push({ method: method.toUpperCase(), pattern, regex, keys, handler });
    return this;
  }

  get(pattern, handler) {
    return this.register("GET", pattern, handler);
  }

  post(pattern, handler) {
    return this.register("POST", pattern, handler);
  }

  put(pattern, handler) {
    return this.register("PUT", pattern, handler);
  }

  delete(pattern, handler) {
    return this.register("DELETE", pattern, handler);
  }

  match(method, url) {
    const pathname = url.split("?")[0];

    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;

      const result = route.regex.exec(pathname);
      if (!result) continue;

      const params = {};
      route.keys.forEach((key, i) => {
        params[key] = result[i + 1];
      });

      return { handler: route.handler, params };
    }

    return null;
  }
}
