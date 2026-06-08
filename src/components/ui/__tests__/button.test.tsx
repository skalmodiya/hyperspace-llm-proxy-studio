import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renders children and handles click", async () => {
    const onClick = (() => {
      let count = 0;
      const fn = () => {
        count++;
      };
      Object.defineProperty(fn, "count", {
        get: () => count,
      });
      return fn;
    })();

    render(<Button onClick={onClick}>Click me</Button>);
    const btn = screen.getByRole("button", { name: /click me/i });
    expect(btn).toBeInTheDocument();
    await userEvent.click(btn);
    expect((onClick as unknown as { count: number }).count).toBe(1);
  });

  it("applies the destructive variant classes", () => {
    render(<Button variant="destructive">Delete</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("destructive");
  });
});
