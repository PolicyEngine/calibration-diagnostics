import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/populace/variable": ["./scripts/populace_variable_value.py"],
  },
};

export default nextConfig;
