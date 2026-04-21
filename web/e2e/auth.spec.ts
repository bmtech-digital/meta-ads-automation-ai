import { test, expect } from "@playwright/test";

test.describe("auth gating", () => {
  test("unauthenticated visit to / redirects to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText("כניסה ל-Campaigner")).toBeVisible();
  });

  test("login page sets RTL and shows the email form", async ({ page }) => {
    await page.goto("/login");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("dir", "rtl");
    await expect(html).toHaveAttribute("lang", "he");
    await expect(page.getByLabel("אימייל")).toBeVisible();
  });
});
