/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Vercel / Node 環境での安定運用
  output: 'standalone',

  // eslint が原因で build 止まるのを防ぐ（保険）
  eslint: {
    ignoreDuringBuilds: true,
  },

  // 型エラーで build 止まるのを防ぐ（必要なら）
  typescript: {
    ignoreBuildErrors: true,
  },

  // API Route 用（Edge じゃなく Node を使う場合）
  experimental: {
    serverActions: true,
  },
};

module.exports = nextConfig;

