import { ElementNode, AttributeNode, TextNode, InterpolationNode } from "../ast/nodes.js";
import { parseExpressionString } from "./parseExpressionString.js";

const TAG_NAME_RE = /^[a-zA-Z][a-zA-Z0-9-]*/;
const ATTR_NAME_RE = /^[a-zA-Z][a-zA-Z0-9-]*/;
const INTERP_ATTR_RE = /^\{\{\s*([\s\S]*?)\s*\}\}$/;

/**
 * Parses the raw contents of a <template> block into a tree of
 * Element / Text / Interpolation nodes. Character-based rather than
 * token-based, since HTML structure (tags/attrs/text) has different
 * lexical rules than the script grammar.
 */
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

  // Parses a sequence of sibling nodes. If stopTag is given, stops
  // when it hits that tag's closing tag and consumes it. If stopTag
  // is null, stops at end of input (a closing tag here is an error,
  // left for the caller to report).
  parseNodes(stopTag) {
    const nodes = [];
    while (this.pos < this.source.length) {
      if (this.remaining().startsWith("</")) {
        if (stopTag === null) return nodes; // caller (parseTemplate) reports the error
        this.consumeClosingTag(stopTag);
        return nodes;
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
      // Collapse whitespace runs (spaces, tabs, newlines from source
      // formatting) into single spaces, like HTML does. Skip nodes
      // that are entirely whitespace (e.g. indentation between tags),
      // but preserve meaningful single spaces adjacent to real text,
      // like the one between "Hello" and "{{ name }}".
      const collapsed = text.replace(/\s+/g, " ");
      if (collapsed.trim().length > 0) {
        nodes.push(TextNode(collapsed));
      }
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

  parseElement() {
    this.pos++; // skip '<'
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
    this.pos++; // skip '>'

    const children = this.parseNodes(tag);
    return ElementNode(tag, attributes, children);
  }

  consumeClosingTag(expectedTag) {
    this.pos += 2; // skip '</'
    const name = this.readTagName();
    this.skipWhitespace();
    if (this.source[this.pos] !== ">") {
      throw new Error(`Expected '>' after closing tag name '${name}'`);
    }
    this.pos++; // skip '>'
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
    this.pos++; // skip closing quote

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
