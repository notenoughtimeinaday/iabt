import { createZip } from "./zip.js";

const xmlEscape = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const plainText = (line) =>
  String(line || "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\s*[-*+]\s+/, "- ")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .trim();

const docxParagraph = (line) => {
  const source = String(line || "");
  if (!source.trim()) return "<w:p/>";
  const heading = source.match(/^(#{1,2})\s+(.+)$/);
  const bullet = source.match(/^\s*[-*+]\s+(.+)$/);
  const style = heading
    ? (heading[1].length === 1 ? "Heading1" : "Heading2")
    : bullet
      ? "ListParagraph"
      : "Normal";
  const text = heading ? heading[2] : bullet ? "• " + bullet[1] : source;
  return '<w:p><w:pPr><w:pStyle w:val="' + style +
    '"/></w:pPr><w:r><w:t xml:space="preserve">' +
    xmlEscape(text) + "</w:t></w:r></w:p>";
};

export const createDocx = ({ title, markdown }) => {
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    "<w:body>" +
    String(markdown || "").split(/\r?\n/).map(docxParagraph).join("") +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/>' +
    "</w:sectPr></w:body></w:document>";
  const stylesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
    '<w:rPr><w:sz w:val="22"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
    '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>' +
    '<w:rPr><w:b/><w:sz w:val="34"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>' +
    '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>' +
    '<w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>' +
    '<w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/></w:pPr></w:style>' +
    "</w:styles>";
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    "</Types>";
  const packageRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    "</Relationships>";
  const documentRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    "</Relationships>";
  const created = new Date().toISOString();
  const core =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    "<dc:title>" + xmlEscape(title) + "</dc:title><dc:creator>IABT JERICHO Studio</dc:creator>" +
    '<dcterms:created xsi:type="dcterms:W3CDTF">' + created + "</dcterms:created></cp:coreProperties>";
  return createZip({
    "[Content_Types].xml": contentTypes,
    "_rels/.rels": packageRels,
    "word/document.xml": documentXml,
    "word/styles.xml": stylesXml,
    "word/_rels/document.xml.rels": documentRels,
    "docProps/core.xml": core
  });
};

const latin = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7e]/g, "?");

const wrap = (line, width = 86) => {
  const text = latin(plainText(line));
  if (!text) return [""];
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if ((current + " " + word).length <= width) current += " " + word;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
};

const pdfEscape = (value) =>
  latin(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

export const createPdf = ({ markdown }) => {
  const lines = String(markdown || "")
    .split(/\r?\n/)
    .flatMap((line) => wrap(line));
  const linesPerPage = 48;
  const pages = [];
  for (let index = 0; index < lines.length; index += linesPerPage) {
    pages.push(lines.slice(index, index + linesPerPage));
  }
  if (!pages.length) pages.push([""]);

  const objects = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids = pages.map((_, index) => (4 + index * 2) + " 0 R").join(" ");
  objects[2] = "<< /Type /Pages /Count " + pages.length + " /Kids [" + kids + "] >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  pages.forEach((pageLines, index) => {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    const stream = [
      "BT",
      "/F1 11 Tf",
      "14 TL",
      "54 738 Td",
      ...pageLines.map((line) => "(" + pdfEscape(line) + ") Tj T*"),
      "ET"
    ].join("\n");
    const streamBytes = Buffer.from(stream, "latin1");
    objects[pageId] =
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 3 0 R >> >> /Contents " + contentId + " 0 R >>";
    objects[contentId] =
      "<< /Length " + streamBytes.length + " >>\nstream\n" + stream + "\nendstream";
  });

  let pdf = Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1");
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = pdf.length;
    pdf = Buffer.concat([
      pdf,
      Buffer.from(id + " 0 obj\n" + objects[id] + "\nendobj\n", "latin1")
    ]);
  }
  const xrefOffset = pdf.length;
  const xref = [
    "xref",
    "0 " + objects.length,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((offset) => String(offset).padStart(10, "0") + " 00000 n "),
    "trailer",
    "<< /Size " + objects.length + " /Root 1 0 R >>",
    "startxref",
    String(xrefOffset),
    "%%EOF",
    ""
  ].join("\n");
  return Buffer.concat([pdf, Buffer.from(xref, "latin1")]);
};

export const buildDocumentArtifactSet = ({ title, markdown }) => ({
  metadata: {
    formats: ["markdown", "docx", "pdf"],
    rendered: true,
    artifact_count: 3
  },
  artifacts: [
    {
      bytes: Buffer.from(markdown, "utf8"),
      contentType: "text/markdown; charset=utf-8",
      filename: title + ".md",
      kind: "document",
      metadata: { format: "markdown", preview_ready: true, unicode: true }
    },
    {
      bytes: createDocx({ title, markdown }),
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: title + ".docx",
      kind: "document",
      metadata: { format: "docx", office_open_xml: true, unicode: true }
    },
    {
      bytes: createPdf({ markdown }),
      contentType: "application/pdf",
      filename: title + ".pdf",
      kind: "document",
      metadata: { format: "pdf", preview_ready: true, font_strategy: "portable_builtin" }
    }
  ]
});
