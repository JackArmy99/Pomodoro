/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Uploads (research briefs, manuals) go through server actions. A full
    // Tagetik manual is ~17MB (649 pages), so 15MB refused real ones.
    serverActions: { bodySizeLimit: "60mb" },
  },
};

export default nextConfig;
