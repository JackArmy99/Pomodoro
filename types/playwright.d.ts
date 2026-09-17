// Playwright is an OPTIONAL dependency — a ~300MB install that only the portal
// needs, so it is deliberately not in package.json. Declaring it here lets the
// code compile without it; `loadPlaywright()` gives a clear message at runtime
// if someone reaches the portal without running `npm run portal:setup`.
declare module "playwright";
