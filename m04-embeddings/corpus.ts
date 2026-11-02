// The corpus for Modules 4 and 5: your course notes. That's COURSE.md, the README of
// every module folder, and any Markdown you add to data/notes/, split into one chunk
// per section (at every ## or ### heading).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type Chunk = {
  id: string; // where it came from, e.g. "m01-basics/README.md › Setup (once)"
  title: string; // the document's title plus the section heading
  text: string; // the section itself, heading included
};
export type Hit = { chunk: Chunk; score: number };

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

// The text that actually gets searched. The title gives a short section like
// "Setup (once)" the context of which document it belongs to.
export const searchableText = (chunk: Chunk) => `${chunk.title}\n${chunk.text}`;

export function loadCorpus(): Chunk[] {
  // Windows editors may save notes with CRLF line endings; the splitter expects LF.
  return corpusFiles().flatMap((file) => splitSections(file, readFileSync(join(ROOT, file), "utf8").replace(/\r\n?/g, "\n")));
}

// The documents, as paths relative to the repo root.
export function corpusFiles(): string[] {
  const files = ["COURSE.md"];
  for (const folder of readdirSync(ROOT).sort()) {
    if (/^m\d\d-/.test(folder) && existsSync(join(ROOT, folder, "README.md"))) files.push(`${folder}/README.md`);
  }
  const notes = join(ROOT, "data", "notes");
  if (existsSync(notes)) {
    for (const file of (readdirSync(notes, { recursive: true }) as string[]).sort()) {
      // Always "/" in the path, so chunk ids and notes:// URIs look the same on Windows.
      if (file.endsWith(".md")) files.push(`data/notes/${file.split(sep).join("/")}`);
    }
  }
  return files;
}

// Split at every ## or ### heading. Lines inside ``` code blocks are never headings.
function splitSections(file: string, markdown: string): Chunk[] {
  const documentTitle = markdown.match(/^# (.+)$/m)?.[1].trim() ?? file;
  const chunks: Chunk[] = [];
  let heading = "(intro)";
  let lines: string[] = [];
  let inCode = false;

  const finish = () => {
    const text = lines.join("\n").trim();
    if (text.length < 80) return; // too short to be worth finding
    chunks.push({ id: `${file} › ${heading}`, title: `${documentTitle} › ${heading}`, text });
  };

  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) inCode = !inCode;
    const match = !inCode && line.match(/^#{2,3} (.+)$/);
    if (match) {
      finish();
      heading = match[1].trim();
      lines = [line];
    } else {
      lines.push(line);
    }
  }
  finish();
  return chunks;
}
