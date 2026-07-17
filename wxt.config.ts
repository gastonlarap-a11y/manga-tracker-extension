import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Manga Tracker",
    // Fixed public key so the extension id is stable across machines/loads
    // (the API's CORS allowlist depends on it). Private key: extension-key.pem
    // (gitignored). Resulting id: cfjiinlnepkmlaafdclmlpjbmpofplop
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw7+own37PxVHAC65UFaiSGKsVVUbRFzQgq7HLSNCVTx7C7rwSkI0gOQptdSsQHPEAWlKsKccVGfKgZjbUik9uMaQGXuZ3woTSR51ok3eBeZDi6drDKkZiP+D+pp4a6oFL46SR+E79j2cWz+/lpwWnOP4Bz9b1v8Uw5SWlyxsNXnUcWhJA+Ei/lu8nwDloMVQi66chHB2ZxvPUrRABNZkzMUcu9eG2bde9yIm+/L3K+Z2e4iOjElM8Nv9i6S32me/kT88W9PYgodRSSgDF5SwSJ7W3iN8tcJOjx44zU3xxpYIjuWf3fFYxRZu8FofZ/Rzr9Bgn8/53C81NLim6ei0lwIDAQAB",
    permissions: ["storage", "activeTab", "scripting"],
    host_permissions: ["http://localhost:5150/*"],
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
