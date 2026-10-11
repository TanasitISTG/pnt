import { describe, expect, it } from "vitest";

import { describeUserAgent } from "./session-label";

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

describe("describeUserAgent", () => {
  it("names the browser and platform", () => {
    expect(describeUserAgent(CHROME_WINDOWS)).toBe("Chrome on Windows");
    expect(describeUserAgent(SAFARI_MAC)).toBe("Safari on macOS");
    expect(describeUserAgent(FIREFOX_LINUX)).toBe("Firefox on Linux");
    expect(describeUserAgent(EDGE_WINDOWS)).toBe("Edge on Windows");
    expect(describeUserAgent(SAFARI_IOS)).toBe("Safari on iOS");
  });

  it("falls back to browser only, or unknown, rather than echoing the header", () => {
    expect(describeUserAgent("curl/8.6.0")).toBe("Browser");
    expect(describeUserAgent("")).toBe("Unknown device");
    expect(describeUserAgent(null)).toBe("Unknown device");
    expect(describeUserAgent(undefined)).toBe("Unknown device");
  });
});
