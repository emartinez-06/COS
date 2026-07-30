import path from 'node:path';
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Without this Next walks up past the repo and picks a stray lockfile in the
  // home directory as the workspace root, which breaks file tracing on build.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),

  // @cos/core is now consumed as built ES2022 output rather than TypeScript
  // source, because services/api runs it as real Node ESM. It no longer needs
  // transpiling here, but it does have to be built before the app.

  // The reference templates scaffolded by `astryx template` live here for
  // reading, not for shipping - keep them out of the build.
  eslint: {ignoreDuringBuilds: true},
};

export default nextConfig;
