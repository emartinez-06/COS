import path from 'node:path';
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Without this Next walks up past the repo and picks a stray lockfile in the
  // home directory as the workspace root, which breaks file tracing on build.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),

  // @cos/core is consumed as TypeScript source rather than a built artifact,
  // so Next has to compile it alongside the app.
  transpilePackages: ['@cos/core'],

  // The reference templates scaffolded by `astryx template` live here for
  // reading, not for shipping - keep them out of the build.
  eslint: {ignoreDuringBuilds: true},
};

export default nextConfig;
