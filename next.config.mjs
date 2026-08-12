import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js auto-detects the workspace root by walking up the filesystem
  // for a lockfile. On a machine with another package-lock.json sitting
  // outside this project (e.g. directly in the user's home folder), that
  // auto-detection can pick the wrong directory. Pinning it explicitly
  // avoids relying on that guess.
  // https://nextjs.org/docs/app/api-reference/config/next-config-js/output#caveats
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
