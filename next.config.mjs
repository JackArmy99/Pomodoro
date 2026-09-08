/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Allow uploading research briefs (PDF/Word) up to ~15MB via server actions.
    serverActions: { bodySizeLimit: "15mb" },
  },
};

export default nextConfig;
