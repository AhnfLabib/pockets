import { Config } from "@remotion/cli/config";

// Remotion downloads its own headless Chrome when it can. On machines without network access to that
// download, point it at a local Chromium headless shell: REMOTION_BROWSER=/path/to/chrome-headless-shell
if (process.env.REMOTION_BROWSER) {
  Config.setBrowserExecutable(process.env.REMOTION_BROWSER);
}
Config.setVideoImageFormat("png");
