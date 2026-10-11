// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TurnstileRenderOptions } from "@/lib/auth/captcha";

import { TurnstileWidget } from "./turnstile-widget";

/**
 * The widget is only ever handed to Cloudflare's script, so a fake `window.turnstile`
 * capturing the options is how a test observes what the page asks for. The options are
 * the contract: `appearance` is what keeps the challenge frame out of an already-tall
 * sign-up form, and dropping it silently brings the box back.
 */
function installTurnstile() {
  const renderOptions: TurnstileRenderOptions[] = [];
  const renderWidget = vi.fn((_container: HTMLElement, options: TurnstileRenderOptions) => {
    renderOptions.push(options);
    return "widget-1";
  });
  const remove = vi.fn();
  window.turnstile = { render: renderWidget, remove, reset: vi.fn() };
  return { renderOptions, renderWidget, remove };
}

afterEach(() => {
  cleanup();
  delete window.turnstile;
});

describe("TurnstileWidget", () => {
  it("asks for a flexible challenge that stays hidden until a visitor has to act", () => {
    const { renderOptions, renderWidget } = installTurnstile();

    render(<TurnstileWidget siteKey="site-key" onToken={() => {}} />);

    expect(renderWidget).toHaveBeenCalledTimes(1);
    expect(renderOptions[0]).toMatchObject({
      sitekey: "site-key",
      size: "flexible",
      appearance: "interaction-only",
    });
  });

  it("reports the token, and reports nothing once the challenge expires", () => {
    const { renderOptions } = installTurnstile();
    const onToken = vi.fn();

    render(<TurnstileWidget siteKey="site-key" onToken={onToken} />);

    const options = renderOptions[0];
    options.callback("answer-token");
    expect(onToken).toHaveBeenCalledWith("answer-token");

    options["expired-callback"]?.();
    expect(onToken).toHaveBeenLastCalledWith(null);
  });

  it("routes a late answer to the newest handler without re-rendering the challenge", () => {
    const { renderOptions, renderWidget } = installTurnstile();
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = render(<TurnstileWidget siteKey="site-key" onToken={first} />);
    rerender(<TurnstileWidget siteKey="site-key" onToken={second} />);

    expect(renderWidget).toHaveBeenCalledTimes(1);
    renderOptions[0].callback("answer-token");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("answer-token");
  });

  it("withdraws the widget and its token on unmount", () => {
    const { renderWidget, remove } = installTurnstile();
    const onToken = vi.fn();

    const { unmount } = render(<TurnstileWidget siteKey="site-key" onToken={onToken} />);
    expect(renderWidget).toHaveBeenCalledTimes(1);

    unmount();

    expect(remove).toHaveBeenCalledWith("widget-1");
    expect(onToken).toHaveBeenLastCalledWith(null);
  });

  it("waits for the shared script when another widget already injected it", () => {
    const renderWidget = vi.fn(() => "widget-1");

    const { container } = render(<TurnstileWidget siteKey="site-key" onToken={() => {}} />);
    expect(renderWidget).not.toHaveBeenCalled();

    const script = document.querySelector<HTMLScriptElement>("script[data-pnt-turnstile]");
    expect(script).not.toBeNull();

    window.turnstile = { render: renderWidget, remove: vi.fn(), reset: vi.fn() };
    script?.dispatchEvent(new Event("load"));

    expect(renderWidget).toHaveBeenCalledTimes(1);
    expect(container.querySelector("div")).not.toBeNull();
  });
});
