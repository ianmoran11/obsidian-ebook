/** Parse XML without executing scripts or loading external entities. */
export function parseXml(source: string, label: string): XMLDocument {
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (doc.getElementsByTagName("parsererror").length || doc.documentElement.localName === "parsererror") {
    throw new Error(`The EPUB has invalid XML in ${label}.`);
  }
  return doc;
}

export function elements(parent: Document | Element, name: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS("*", name));
}

export function plainText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * A template's contents are inert: even image/iframe URLs cannot load.
 * Remove resource URLs before moving the content out of the template.
 */
export function inertHtml(html: string): HTMLElement {
  const template = document.createElement("template");
  template.innerHTML = html;
  const content = template.content;
  const title = plainText(content.querySelector("title")?.textContent);
  content.querySelectorAll(
    "script, style, iframe, object, embed, form, input, button, textarea, select, " +
    "link, meta, base, noscript, template, head, title, foreignObject"
  ).forEach(node => node.remove());

  // Many EPUB covers are an SVG wrapper around a raster image.
  for (const svg of Array.from(content.querySelectorAll("svg"))) {
    const image = svg.querySelector("image");
    const source = image?.getAttribute("href") ?? image?.getAttribute("xlink:href");
    if (source) {
      const replacement = document.createElement("img");
      replacement.setAttribute("data-src", source);
      replacement.setAttribute("alt", plainText(svg.querySelector("title")?.textContent) || "Illustration");
      svg.replaceWith(replacement);
    } else {
      svg.replaceWith(document.createTextNode(plainText(svg.textContent)));
    }
  }

  for (const node of Array.from(content.querySelectorAll("*"))) {
    const source = node.tagName === "IMG" ? node.getAttribute("src") ?? node.getAttribute("data-src") : null;
    for (const attr of Array.from(node.attributes)) {
      if (!["id", "name", "href", "alt", "title", "colspan", "rowspan", "start", "epub:type"].includes(attr.name)) {
        node.removeAttribute(attr.name);
      }
    }
    if (source) node.setAttribute("data-epub-src", source);
  }
  const root = document.createElement("div");
  root.dataset.epubTitle = title;
  root.append(content);
  return root;
}

/** SVG attachments must not retain executable or remote-loading content. */
export function sanitizeSvg(source: string): string {
  const doc = parseXml(source, "an SVG image");
  if (doc.documentElement.localName !== "svg") throw new Error("Invalid SVG image.");
  const forbidden = new Set([
    "script", "style", "foreignObject", "iframe", "object", "embed",
    "animate", "animateMotion", "animateTransform", "set", "discard",
  ]);
  for (const node of [doc.documentElement, ...Array.from(doc.documentElement.querySelectorAll("*"))]) {
    if (forbidden.has(node.localName)) {
      node.remove();
      continue;
    }
    for (const attr of Array.from(node.attributes)) {
      const name = attr.localName.toLowerCase();
      const value = attr.value.trim();
      const safeHref = value.startsWith("#") ||
        (node.localName === "image" && /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value));
      const unsafeUrl = /url\s*\(/i.test(value) &&
        !/^url\(\s*["']?#[a-z0-9_.:-]+["']?\s*\)$/i.test(value);
      if (name.startsWith("on") || name === "style" || name === "src" || name === "base" ||
          (name === "href" && !safeHref) || unsafeUrl ||
          /(?:javascript|vbscript):/i.test(value)) node.removeAttributeNode(attr);
    }
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
}
