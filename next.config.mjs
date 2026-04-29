import path from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { withSentryConfig } from "@sentry/nextjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stub = path.join(__dirname, "stubs", "empty.js");
const isDev = process.env.NODE_ENV !== "production";
const shouldEnableSentryBuildPlugin = Boolean(process.env.SENTRY_AUTH_TOKEN);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const optionalModuleAliases = {
  ...(existsSync(path.join(__dirname, "node_modules", "@capacitor", "status-bar"))
    ? {}
    : { "@capacitor/status-bar": path.join(__dirname, "stubs", "capacitor-status-bar.js") }),
  ...(existsSync(path.join(__dirname, "node_modules", "@capacitor", "push-notifications"))
    ? {}
    : {
        "@capacitor/push-notifications": path.join(
          __dirname,
          "stubs",
          "capacitor-push-notifications.js"
        ),
      }),
  ...(existsSync(path.join(__dirname, "node_modules", "firebase-admin"))
    ? {}
    : {
        "firebase-admin/app": path.join(__dirname, "stubs", "firebase-admin-app.js"),
        "firebase-admin/messaging": path.join(
          __dirname,
          "stubs",
          "firebase-admin-messaging.js"
        ),
      }),
};

let supabaseOrigin = "";
const remoteImagePatterns = [
  {
    protocol: "https",
    hostname: "placehold.co",
  },
];
try {
  const parsedSupabaseUrl = supabaseUrl ? new URL(supabaseUrl) : null;
  supabaseOrigin = parsedSupabaseUrl ? parsedSupabaseUrl.origin : "";
  if (parsedSupabaseUrl) {
    remoteImagePatterns.push({
      protocol: parsedSupabaseUrl.protocol.replace(":", ""),
      hostname: parsedSupabaseUrl.hostname,
    });
  }
} catch {
  supabaseOrigin = "";
}

const cspDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  `img-src 'self' data: blob: https://placehold.co${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  `connect-src 'self' https://*.sentry.io${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  "form-action 'self'",
];

if (!isDev) {
  cspDirectives.push("upgrade-insecure-requests");
}

const csp = cspDirectives.join("; ");

/** @type {import("next").NextConfig} */
const nextConfig = {
  experimental: {
    cpus: 2,
    parallelServerCompiles: false,
    parallelServerBuildTraces: false,
    webpackBuildWorker: false,
    webpackMemoryOptimizations: false,
  },
  images: {
    remotePatterns: remoteImagePatterns,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
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
      ...optionalModuleAliases,
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
        ...optionalModuleAliases,
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

const sentryConfig = {
  silent: true,
  sourcemaps: {
    disable: true,
  },
};

export default shouldEnableSentryBuildPlugin
  ? withSentryConfig(nextConfig, sentryConfig)
  : nextConfig;
