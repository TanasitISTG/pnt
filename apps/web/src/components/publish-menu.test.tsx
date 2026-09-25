// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublishMenu } from "./publish-menu";

afterEach(cleanup);

async function openSchedule() {
  fireEvent.click(screen.getByRole("button", { name: "Publishing options" }));
  const scheduleItem = await screen.findByRole("menuitem", { name: "Schedule…" });
  fireEvent.click(scheduleItem);
  return screen.findByLabelText("Publish at") as Promise<HTMLInputElement>;
}

describe("PublishMenu", () => {
  it("resets the local datetime draft from the current publication date on every open", async () => {
    const publishedAt = new Date(2028, 4, 6, 7, 8);
    render(<PublishMenu publishedAt={publishedAt} onChange={vi.fn()} />);

    const input = await openSchedule();
    expect(input.value).toBe("2028-05-06T07:08");

    fireEvent.change(input, { target: { value: "2030-01-02T03:04" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect((await openSchedule()).value).toBe("2028-05-06T07:08");
  });

  it("renders inline validation and does not dispatch an invalid schedule", async () => {
    const onChange = vi.fn();
    render(<PublishMenu publishedAt={null} onChange={onChange} />);

    const input = await openSchedule();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));

    expect(await screen.findByText("Publish time is required")).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("parses datetime-local values as local time and closes after dispatch", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(<PublishMenu publishedAt={null} onChange={onChange} />);

    const input = await openSchedule();
    fireEvent.change(input, { target: { value: "2031-09-10T11:12" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    const scheduled = onChange.mock.calls[0]?.[0] as Date;
    expect([
      scheduled.getFullYear(),
      scheduled.getMonth(),
      scheduled.getDate(),
      scheduled.getHours(),
      scheduled.getMinutes(),
    ]).toEqual([2031, 8, 10, 11, 12]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
