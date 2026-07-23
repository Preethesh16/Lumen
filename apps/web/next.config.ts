import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: process.cwd().endsWith('/apps/web')
    ? `${process.cwd()}/../..`
    : process.cwd(),
  transpilePackages: ['@lumen/shared-types'],
  poweredByHeader: false,
};

export default nextConfig;
