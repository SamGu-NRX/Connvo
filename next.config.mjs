// next.config.mjs

/** @type {import('next').NextConfig} */

const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    webpackBuildWorker: true,
    parallelServerBuildTraces: true,
    turbopackFileSystemCacheForDev: true,
    parallelServerCompiles: true,
    // serverActions: {
    //   allowedOrigins: ["app.localhost:3000"],
    // },},
  },
  // Turbopack config moved to top-level in Next.js 16
  turbopack: {
    rules: {
      "*.svg": {
        loaders: ["@svgr/webpack"],
        as: "*.js",
      },
    },
  },
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: [
        {
          loader: "@svgr/webpack",
          options: {
            svgo: true,
          },
        },
      ],
    });
    return config;
  },
};

export default nextConfig;
