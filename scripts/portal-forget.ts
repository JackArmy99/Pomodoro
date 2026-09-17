// Delete the saved portal session. Run: npm run portal:forget
//
// One command to revoke everything: cookies, local storage, and anything
// Chromium's own password manager saved before that was switched off. After
// this, Beacon has no way into the portal until you sign in again.
import { rmSync, existsSync } from "node:fs";
import { PROFILE_DIR } from "../lib/portal/session";

if (!existsSync(PROFILE_DIR)) {
  console.log("Nothing saved — there is no portal profile.");
} else {
  rmSync(PROFILE_DIR, { recursive: true, force: true });
  console.log(
    `Deleted ${PROFILE_DIR}\n\nThe portal session is gone. Sign in again with:  npm run portal:login`,
  );
}
