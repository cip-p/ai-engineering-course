import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app has its own package.json and lockfile, inside the course repo, which has its own.
  // Tell Next.js this folder is the project's root, so it doesn't guess the repo's.
  turbopack: { root: path.resolve(__dirname) },
  // No gzip: compressing a response can hold back a streamed answer until it's complete.
  compress: false,
};

export default nextConfig;
