// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StarRating, StarRatingInput } from "./star-rating";

afterEach(cleanup);

describe("StarRating", () => {
  it("names a fractional average honestly instead of rounding it", () => {
    render(<StarRating value={4.6} />);

    expect(screen.getByRole("img", { name: "4.6 out of 5 stars" })).toBeTruthy();
  });
});

describe("StarRatingInput", () => {
  it("sets a draft rating on click and marks it pressed", () => {
    const onChange = vi.fn();
    render(<StarRatingInput value={0} onChange={onChange} />);

    const fourth = screen.getByRole("button", { name: "Rate 4 out of 5" });
    expect(fourth.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(fourth);

    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("marks the chosen star and leaves the others unpressed", () => {
    render(<StarRatingInput value={3} onChange={() => undefined} />);

    expect(
      screen.getByRole("button", { name: "Rate 3 out of 5" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Rate 5 out of 5" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("does nothing while disabled", () => {
    const onChange = vi.fn();
    render(<StarRatingInput value={2} onChange={onChange} disabled />);

    const stars = screen.getAllByRole("button");
    expect(stars.every((star) => (star as HTMLButtonElement).disabled)).toBe(true);

    stars.forEach((star) => fireEvent.click(star));
    expect(onChange).not.toHaveBeenCalled();
  });
});
