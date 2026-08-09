import { defineConfig } from "wxt";

/**
 * The Chrome Web Store refuses a first upload whose manifest declares `key`
 * ("key field not allowed in manifest") and assigns an id of its own. So the
 * store build drops it and the local build keeps it — same source, two ids,
 * which is exactly why the API accepts a list of them (EXTENSION_IDS).
 *
 * `bun run zip:store` sets this. Once the store has assigned the id, its public
 * key can be pasted back here (Dashboard → Package → View public key) and both
 * builds converge on one id again.
 */
const forStore = process.env.STORE_BUILD === "1";

const UNPACKED_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw7+own37PxVHAC65UFaiSGKsVVUbRFzQgq7HLSNCVTx7C7rwSkI0gOQptdSsQHPEAWlKsKccVGfKgZjbUik9uMaQGXuZ3woTSR51ok3eBeZDi6drDKkZiP+D+pp4a6oFL46SR+E79j2cWz+/lpwWnOP4Bz9b1v8Uw5SWlyxsNXnUcWhJA+Ei/lu8nwDloMVQi66chHB2ZxvPUrRABNZkzMUcu9eG2bde9yIm+/L3K+Z2e4iOjElM8Nv9i6S32me/kT88W9PYgodRSSgDF5SwSJ7W3iN8tcJOjx44zU3xxpYIjuWf3fFYxRZu8FofZ/Rzr9Bgn8/53C81NLim6ei0lwIDAQAB";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Manga Tracker",
    // Fixed public key so the extension id is stable across machines/loads
    // when loaded unpacked. Private key: extension-key.pem (gitignored).
    // Resulting id: cfjiinlnepkmlaafdclmlpjbmpofplop
    ...(forStore ? {} : { key: UNPACKED_KEY }),
    permissions: ["storage", "activeTab", "scripting"],
    // No port: a match pattern without one matches every port, which is what
    // discovery needs — an installed backend listens wherever it found room.
    // Still localhost only, so this grants nothing on the open internet.
    host_permissions: ["http://localhost/*"],
    optional_host_permissions: ["https://*/*", "http://*/*"],
    // The calibration overlay is a runtime-registered content script, so WXT
    // cannot infer which sites may load its CSS and emits an empty `matches`
    // (= no site can → createShadowRootUi fails silently everywhere). Declare
    // it ourselves for any tracked site.
    web_accessible_resources: [
      {
        resources: ["content-scripts/calibration.css"],
        matches: ["http://*/*", "https://*/*"],
      },
    ],
  },
});
