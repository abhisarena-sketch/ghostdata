/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the playground is plain files served locally. There is no server and no API.
  output: "export",
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
