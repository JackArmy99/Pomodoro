/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Uploads (research briefs, manuals) go through server actions. A full
    // Tagetik manual is ~17MB (649 pages), so 15MB refused real ones.
    serverActions: { bodySizeLimit: "60mb" },
  },
  // Knowledge became Library (29 Oct). Old links and bookmarks keep working.
  // Order matters: the topic routes must match before the item route.
  async redirects() {
    return [
      { source: "/knowledge", destination: "/library", permanent: false },
      { source: "/knowledge/base", destination: "/library?tab=topics", permanent: false },
      { source: "/knowledge/base/:moduleId", destination: "/library/topics/:moduleId", permanent: false },
      { source: "/knowledge/:id", destination: "/library/:id", permanent: false },
      { source: "/library/topics", destination: "/library?tab=topics", permanent: false },    ];
  },
};

export default nextConfig;
