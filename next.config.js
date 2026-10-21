/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { instrumentationHook: true },
};

const {withSentryConfig} = require("@sentry/nextjs/config");
module.exports = withSentryConfig(nextConfig, {silent:true,telemetry:false,sourcemaps:{disable:true}});
