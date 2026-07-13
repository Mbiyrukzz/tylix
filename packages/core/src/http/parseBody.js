export function parseBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = "";

    req.on("data", (chunk) => {
      chunks += chunk;
    });

    req.on("end", () => {
      if (!chunks) {
        resolve({});
        return;
      }

      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("application/json")) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(chunks));
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}
