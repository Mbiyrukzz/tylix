/**
 * Splits a .tyx single-file component into its three named sections.
 * Tylix components always have exactly this shape:
 *
 *   <script> ... </script>
 *   <template> ... </template>
 *   <style> ... </style>  (optional)
 */
export function parseComponent(source) {
  const script = extractTag(source, "script");
  const template = extractTag(source, "template");
  const style = extractTag(source, "style");

  if (template === null) {
    throw new Error(".tyx component is missing a required <template> block.");
  }

  return {
    script: script ?? "",
    template,
    style: style ?? "",
  };
}

function extractTag(source, tagName) {
  const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`);
  const match = pattern.exec(source);
  return match ? match[1].trim() : null;
}
