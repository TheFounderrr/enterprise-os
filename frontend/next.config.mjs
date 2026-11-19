const backend = process.env.BACKEND_URL || "http://127.0.0.1:8000";
const config = {
  poweredByHeader: false,
  devIndicators: false,
  experimental: { cpus: 2, middlewareClientMaxBodySize: "12mb" },
  async rewrites() {
    return [{ source: "/api/:path*", destination: backend + "/api/:path*" }];
  },
};
export default config;
