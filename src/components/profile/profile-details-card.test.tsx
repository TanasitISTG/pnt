// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PROFILE_NAME_MAX_LENGTH } from "@/lib/profile/schemas";
import { ProfileDetailsCard } from "./profile-details-card";

afterEach(cleanup);

function renderCard() {
  const onSubmit = vi.fn(async () => true);
  render(<ProfileDetailsCard initialName="tana" email="tana@example.test" onSubmit={onSubmit} />);
  return {
    onSubmit,
    input: screen.getByLabelText("Display Name") as HTMLInputElement,
    save: screen.getByRole("button", { name: "Save Changes" }),
  };
}

describe("ProfileDetailsCard", () => {
  it("starts from the current name and refuses to edit the sign-in email", () => {
    const { input } = renderCard();

    expect(input.value).toBe("tana");
    expect((screen.getByLabelText("Email") as HTMLInputElement).disabled).toBe(true);
  });

  it("stops typing at the stored limit instead of letting the server refuse it", () => {
    const { input } = renderCard();

    expect(input.maxLength).toBe(PROFILE_NAME_MAX_LENGTH);
  });

  it("submits the trimmed name the admin typed", async () => {
    const { input, onSubmit, save } = renderCard();

    fireEvent.change(input, { target: { value: "  tana thongchai  " } });
    fireEvent.click(save);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: "tana thongchai" }));
  });

  it("refuses a blank name without calling the server", async () => {
    const { input, onSubmit, save } = renderCard();

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(save);

    await waitFor(() => expect(screen.getByText("Display name is required")).toBeDefined());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // The attribute above is the typing guard; this is the contract for a value that
  // arrives past it anyway, such as one restored by the browser or set programmatically.
  it("refuses a name longer than the stored limit without calling the server", async () => {
    const { input, onSubmit, save } = renderCard();

    fireEvent.change(input, { target: { value: "n".repeat(PROFILE_NAME_MAX_LENGTH + 1) } });
    fireEvent.click(save);

    await waitFor(() =>
      expect(
        screen.getByText(`Display name must be at most ${PROFILE_NAME_MAX_LENGTH} characters`),
      ).toBeDefined(),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
