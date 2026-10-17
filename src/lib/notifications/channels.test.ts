import { describe, expect, it } from "vitest";

import {
  NOTIFICATION_CHANNEL_PREFIX,
  NOTIFICATION_MESSAGE_NAME,
  notificationChannel,
} from "./channels";

/**
 * The channel name is the boundary between what the server publishes and what a token allows,
 * so it is spelled in exactly one place. These cases pin the shape that the token's capability
 * and the publish call both depend on.
 */
describe("notification channel vocabulary", () => {
  it("names one channel per account under one prefix", () => {
    expect(notificationChannel("user-1")).toBe("notifications:user-1");
    expect(notificationChannel("user-2")).toBe("notifications:user-2");
    expect(notificationChannel("user-1").startsWith(NOTIFICATION_CHANNEL_PREFIX)).toBe(true);
  });

  it("keeps the event name distinct from the channel name", () => {
    expect(NOTIFICATION_MESSAGE_NAME).toBe("notification");
    expect(NOTIFICATION_MESSAGE_NAME).not.toBe(NOTIFICATION_CHANNEL_PREFIX);
  });
});
