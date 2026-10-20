/**
 * Reads the whole request body once.
 * Returns { raw, body }: raw is the exact UTF-8 text the client sent,
 * body is the parsed JSON (or {} for empty or non-JSON bodies).
 *
 * Chunks are collected as Buffers and decoded once at the end. Joining
 * them as strings can split a multi-byte character across two chunks,
 * which would change the text and break webhook signature checks.
 */
export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");

      if (!raw) {
        resolve({ raw: "", body: {} });
        return;
      }

      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("application/json")) {
        resolve({ raw, body: {} });
        return;
      }

      try {
        resolve({ raw, body: JSON.parse(raw) });
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

export async function parseBody(req) {
  const { body } = await readBody(req);
  return body;
}