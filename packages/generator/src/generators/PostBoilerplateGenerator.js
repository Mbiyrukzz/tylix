import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile, detectLanguage } from "@tylix/shared";
import { Blueprint } from "../blueprint/Blueprint.js";
import { FeatureGenerator } from "./FeatureGenerator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "templates", "post");

// Writes the fixed "create a post / view it / delete it" boilerplate that
// ships with the starter template.
//
// Model, migration, and the feature.json manifest are produced by the
// same Blueprint -> FeatureGenerator pipeline that `tylix make:feature`
// uses, so discoverFeatures/registerFeatureRoutes pick "posts" up
// automatically at /api/posts, gated behind requireAuth via .auth().
//
// The generated controller/validator don't know about per-user
// ownership or cover images, so those files get overwritten with
// hand-written versions right after generation. Controllers have a
// JavaScript template (name.tyx) and a TypeScript one (name-ts.tyx);
// the project's language decides which is used and which extension the
// output gets.
//
// The public pages (/posts and /posts/:id) are written separately by
// create-tylix (writePage), not here.
export class PostBoilerplateGenerator {
    async generate(baseDir) {
        const isTs = (await detectLanguage(baseDir)) === "typescript";
        const ext = isTs ? "ts" : "js";

        const blueprint = new Blueprint("Post")
            .field("title", "string")
            .field("body", "text")
            .field("cover_image", "string")
            .belongsTo("User")
            .timestamps()
            .auth()
            .crud();

        const results = await new FeatureGenerator().generate(blueprint, baseDir);

        const read = (name) => fs.readFile(path.join(TEMPLATES_DIR, name), "utf-8");

        // Strict: a missing -ts template is a bug and should fail loudly.
        const readVariant = (base) => read(isTs ? `${base}-ts.tyx` : `${base}.tyx`);

        // Lenient: use the -ts template if it exists, else the plain one.
        const readVariantOrPlain = async (base) => {
            if (isTs) {
                try {
                    return await read(`${base}-ts.tyx`);
                } catch (err) {
                    if (err.code !== "ENOENT") throw err;
                }
            }
            return read(`${base}.tyx`);
        };

        results.controller = await writeFile(
            path.join(baseDir, "app", "controllers", `PostController.${ext}`),
            await readVariant("post-controller"),
            { overwrite: true },
        );

        results.uploadController = await writeFile(
            path.join(baseDir, "app", "controllers", `UploadController.${ext}`),
            await readVariant("upload-controller"),
            { overwrite: true },
        );

        results.validator = await writeFile(
            path.join(baseDir, "app", "validators", `PostValidator.${ext}`),
            await readVariantOrPlain("post-validator"),
            { overwrite: true },
        );

        return results;
    }
}