import path from "path";
import { fileURLToPath } from "url";
import { withSentryConfig } from "@sentry/nextjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stub = path.join(__dirname, "stubs", "empty.js");
const isDev = process.env.NODE_ENV !== "production";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

let supabaseOrigin = "";
try {
  supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : "";
} catch {
  supabaseOrigin = "";
}

const cspDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https://placehold.co",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  `connect-src 'self' https://*.sentry.io https://fonts.googleapis.com https://fonts.gstatic.com${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  "form-action 'self'",
];

if (!isDev) {
  cspDirectives.push("upgrade-insecure-requests");
}

const csp = cspDirectives.join("; ");

/** @type {import("next").NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "placehold.co",
        port: "",
        pathname: "/**",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: csp,
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
  webpack: (config, { isServer }) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@opentelemetry/exporter-jaeger": stub,
      "@genkit-ai/firebase": stub,
    };
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      async_hooks: false,
      fs: false,
      net: false,
      tls: false,
    };
    if (!isServer) {
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        "@opentelemetry/context-async-hooks": stub,
        "@opentelemetry/otlp-grpc-exporter-base": stub,
        "@genkit-ai/ai": stub,
        "node-fetch": stub,
        "fetch-blob": stub,
        async_hooks: false,
        fs: stub,
        net: stub,
        tls: stub,
        perf_hooks: stub,
        "node:async_hooks": false,
        "node:fs": stub,
        "node:net": stub,
        "node:tls": stub,
        "node:perf_hooks": stub,
      };
    }
    return config;
  },
  devIndicators: false,
  reactStrictMode: true,
};

export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
});
