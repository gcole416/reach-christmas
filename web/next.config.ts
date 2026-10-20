import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The staff help-docs route reads these PDFs from disk at request time, so
  // make sure they ship with the deployed function.
  outputFileTracingIncludes: {
    "/admin/help/[doc]": ["./help-docs/**/*"],
  },
};

export default nextConfig;
