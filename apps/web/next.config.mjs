/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // shared-types ships as TypeScript source within the workspace.
  transpilePackages: ['@lumen/shared-types'],
};

export default nextConfig;
