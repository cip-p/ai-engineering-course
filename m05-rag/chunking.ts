// Lesson 5.1: chunking. Cut each section into pieces of about `size` characters. Each
// piece repeats the last `overlap` characters of the one before it, so a sentence cut
// at a boundary still appears whole in one of the two pieces. Every piece keeps its
// section's title, so a piece from the middle still says which document it came from.

import type { Chunk } from "../m04-embeddings/corpus";

export function splitBySize(sections: Chunk[], size: number, overlap: number): Chunk[] {
  return sections.flatMap((section) => {
    if (section.text.length <= size) return [section];
    return pieces(section.text, size, overlap).map((text, i) => ({
      id: `${section.id} [part ${i + 1}]`,
      title: section.title,
      text,
    }));
  });
}

// Split on whitespace, so no word gets cut in half, into windows of up to `size`
// characters. (Line breaks become spaces: fixed-size chunking ignores the structure.)
function pieces(text: string, size: number, overlap: number): string[] {
  const words = text.split(/\s+/);
  const result: string[] = [];
  let start = 0;

  while (start < words.length) {
    let end = start;
    let length = 0;
    while (end < words.length && (end === start || length + words[end].length + 1 <= size)) {
      length += words[end].length + 1;
      end++;
    }
    result.push(words.slice(start, end).join(" "));
    if (end >= words.length) break;

    // Step back so the next piece starts with about `overlap` characters of this one.
    let next = end;
    let repeated = 0;
    while (next - 1 > start && repeated + words[next - 1].length + 1 <= overlap) {
      next--;
      repeated += words[next].length + 1;
    }
    start = next;
  }
  return result;
}
