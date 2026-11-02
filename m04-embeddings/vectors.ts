// Vector math, by hand. An embedding is just a list of numbers (768 of them for
// nomic-embed-text), and "similar meaning" becomes "pointing in a similar direction".

// Multiply the vectors position by position and add everything up.
export function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

// The length of a vector (Pythagoras, in 768 dimensions).
export function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

// Cosine similarity: the cosine of the angle between two vectors. 1 means the same
// direction, around 0 means unrelated, -1 means opposite. Only direction counts, not
// length, which is why we divide the lengths out.
export function cosine(a: number[], b: number[]): number {
  return dot(a, b) / (norm(a) * norm(b));
}
