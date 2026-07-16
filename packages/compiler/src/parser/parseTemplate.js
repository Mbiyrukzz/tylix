import { ElementNode, AttributeNode, TextNode, InterpolationNode, IfNode, EachNode } from "../ast/nodes.js";
import { parseExpressionString } from "./parseExpressionString.js";

const TAG_NAME_RE = /^[a-zA-Z][a-zA-Z0-9-]*/;
const ATTR_NAME_RE = /^[a-zA-Z][a-zA-Z0-9-]*/;
const INTERP_ATTR_RE = /^\{\{\s*([\s\S]*?)\s*\}\}$/;
const EACH_HEADER_RE = /^([A-Za-z_$][A-Za-z0-9_$]*)\s+in\s+([\s\S]+)$/;

export function parseTemplate(source) {
  const parser = new TemplateParser(source);
  const nodes = parser.parseNodes(null);
  if (parser.pos < parser.source.length) {
    throw new Error(`Unexpected closing tag near: ${parser.remaining().slice(0, 30)}`);
  }
  return nodes;
}

class TemplateParser {
  constructor(source) {
    this.source = source;
    this.pos = 0;
  }

  remaining() {
    return this.source.slice(this.pos);
  }

  // Parses sibling nodes. `stopTag` (an HTML tag name) or `stopMarker`
  // (a literal like "{{/if}}") tell this call when to return; nested
  // control blocks / elements consume their own closing marker before
  // returning, so recursion handles arbitrary nesting automatically.
  parseNodes(stopTag, stopMarker = null) {
    const nodes = [];
    while (this.pos < this.source.length) {
      if (stopMarker && this.remaining().startsWith(stopMarker)) {
        this.pos += stopMarker.length;
        return nodes;
      }

      if (this.remaining().startsWith("</")) {
        if (stopTag === null) return nodes;
        this.consumeClosingTag(stopTag);
        return nodes;
      }

      if (this.remaining().startsWith("{{#if")) {
        nodes.push(this.parseIfBlock());
        continue;
      }

      if (this.remaining().startsWith("{{#each")) {
        nodes.push(this.parseEachBlock());
        continue;
      }

      if (this.remaining().startsWith("{{")) {
        nodes.push(this.parseInterpolation());
        continue;
      }

      if (this.source[this.pos] === "<") {
        nodes.push(this.parseElement());
        continue;
      }

      const text = this.parseText();
      const collapsed = text.replace(/\s+/g, " ");
      if (collapsed.trim().length > 0) {
        nodes.push(TextNode(collapsed));
      }
    }

    if (stopMarker !== null) {
      throw new Error(`Unclosed block: reached end of template looking for "${stopMarker}"`);
    }
    if (stopTag !== null) {
      throw new Error(`Unclosed tag <${stopTag}>: reached end of template`);
    }
    return nodes;
  }

  parseText() {
    const start = this.pos;
    while (
      this.pos < this.source.length &&
      this.source[this.pos] !== "<" &&
      !this.remaining().startsWith("{{")
    ) {
      this.pos++;
    }
    return this.source.slice(start, this.pos);
  }

  parseInterpolation() {
    const start = this.pos + 2;
    const end = this.source.indexOf("}}", start);
    if (end === -1) {
      throw new Error("Unterminated interpolation: missing '}}'");
    }
    const exprSource = this.source.slice(start, end).trim();
    this.pos = end + 2;
    return InterpolationNode(parseExpressionString(exprSource));
  }

  parseIfBlock() {
    this.pos += 2; // "{{"
    this.pos += 3; // "#if"
    this.skipWhitespace();
    const end = this.source.indexOf("}}", this.pos);
    if (end === -1) {
      throw new Error("Unterminated {{#if}} header: missing '}}'");
    }
    const conditionSource = this.source.slice(this.pos, end).trim();
    this.pos = end + 2;

    const children = this.parseNodes(null, "{{/if}}");
    return IfNode(parseExpressionString(conditionSource), children);
  }

  parseEachBlock() {
    this.pos += 2; // "{{"
    this.pos += 5; // "#each"
    this.skipWhitespace();
    const end = this.source.indexOf("}}", this.pos);
    if (end === -1) {
      throw new Error("Unterminated {{#each}} header: missing '}}'");
    }
    const header = this.source.slice(this.pos, end).trim();
    this.pos = end + 2;

    const match = EACH_HEADER_RE.exec(header);
    if (!match) {
      throw new Error(`Invalid {{#each}} header "${header}": expected "item in items"`);
    }
    const itemName = match[1];
    const iterableSource = match[2].trim();

    const children = this.parseNodes(null, "{{/each}}");
    return EachNode(itemName, parseExpressionString(iterableSource), children);
  }

  parseElement() {
    this.pos++;
    const tag = this.readTagName();
    const attributes = this.parseAttributes();

    this.skipWhitespace();
    if (this.remaining().startsWith("/>")) {
      this.pos += 2;
      return ElementNode(tag, attributes, []);
    }

    if (this.source[this.pos] !== ">") {
      throw new Error(`Expected '>' to close <${tag}> tag`);
    }
    this.pos++;

    // <pre> is a raw-text element, same idea as <script>/<style> in
    // real HTML: its content is captured verbatim -- no whitespace
    // collapsing, and critically no {{ }} interpolation/control-flow
    // parsing -- so code samples containing literal "{{#each}}" etc.
    // display as text instead of being executed as real template
    // syntax.
    if (tag === "pre") {
      const closeTag = "</pre>";
      const closeIndex = this.source.indexOf(closeTag, this.pos);
      if (closeIndex === -1) {
        throw new Error("Unclosed <pre> tag: reached end of template");
      }
      const rawContent = this.source.slice(this.pos, closeIndex);
      this.pos = closeIndex + closeTag.length;
      return ElementNode(tag, attributes, [TextNode(rawContent)]);
    }

    const children = this.parseNodes(tag);
    return ElementNode(tag, attributes, children);
  }

  consumeClosingTag(expectedTag) {
    this.pos += 2;
    const name = this.readTagName();
    this.skipWhitespace();
    if (this.source[this.pos] !== ">") {
      throw new Error(`Expected '>' after closing tag name '${name}'`);
    }
    this.pos++;
    if (name !== expectedTag) {
      throw new Error(`Mismatched closing tag: expected </${expectedTag}>, got </${name}>`);
    }
  }

  readTagName() {
    const match = TAG_NAME_RE.exec(this.remaining());
    if (!match) {
      throw new Error(`Expected a tag name at position ${this.pos}`);
    }
    this.pos += match[0].length;
    return match[0];
  }

  parseAttributes() {
    const attributes = [];
    this.skipWhitespace();
    while (
      this.pos < this.source.length &&
      this.source[this.pos] !== ">" &&
      !this.remaining().startsWith("/>")
    ) {
      attributes.push(this.parseAttribute());
      this.skipWhitespace();
    }
    return attributes;
  }

  parseAttribute() {
    const nameMatch = ATTR_NAME_RE.exec(this.remaining());
    if (!nameMatch) {
      throw new Error(`Expected an attribute name at position ${this.pos}`);
    }
    const name = nameMatch[0];
    this.pos += name.length;
    this.skipWhitespace();

    if (this.source[this.pos] !== "=") {
      throw new Error(`Expected '=' after attribute name '${name}'`);
    }
    this.pos++;
    this.skipWhitespace();

    const quote = this.source[this.pos];
    if (quote !== '"' && quote !== "'") {
      throw new Error(`Expected a quoted value for attribute '${name}'`);
    }
    this.pos++;
    const valueStart = this.pos;
    while (this.pos < this.source.length && this.source[this.pos] !== quote) {
      this.pos++;
    }
    if (this.pos >= this.source.length) {
      throw new Error(`Unterminated attribute value for '${name}'`);
    }
    const rawValue = this.source.slice(valueStart, this.pos);
    this.pos++;

    const interpMatch = INTERP_ATTR_RE.exec(rawValue);
    if (interpMatch) {
      return AttributeNode(name, parseExpressionString(interpMatch[1]), true);
    }
    return AttributeNode(name, rawValue, false);
  }

  skipWhitespace() {
    while (this.pos < this.source.length && /\s/.test(this.source[this.pos])) {
      this.pos++;
    }
  }
}
