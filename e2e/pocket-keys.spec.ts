import { expect, test, type Page } from "@playwright/test";

/** Counts oscillators started, so tests can tell that sound was actually made. */
async function countSound(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __starts: number };
    w.__starts = 0;
    const proto = OscillatorNode.prototype as unknown as { start: (...a: unknown[]) => void };
    const original = proto.start;
    proto.start = function (this: unknown, ...args: unknown[]) {
      w.__starts++;
      return original.apply(this, args);
    };
  });
}
const starts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __starts: number }).__starts);

test("plays notes from the on-screen keys and lights them while held", async ({ page }) => {
  await countSound(page);
  await page.goto("/");
  const key = page.getByRole("button", { name: "E 4", exact: true });
  const box = (await key.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 15);
  await page.mouse.down();
  await expect(key).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".lcd__note")).toHaveText("E4");
  await page.mouse.up();
  await expect(key).toHaveAttribute("aria-pressed", "false");
  expect(await starts(page)).toBeGreaterThan(0);
});

test("slides across keys like a glissando", async ({ page }) => {
  await page.goto("/");
  const c = (await page.getByRole("button", { name: "C 4", exact: true }).boundingBox())!;
  const g = (await page.getByRole("button", { name: "G 4", exact: true }).boundingBox())!;
  const y = c.y + c.height - 15;
  await page.mouse.move(c.x + c.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, y, { steps: 12 });
  await expect(page.locator(".lcd__note")).toHaveText("G4");
  await expect(page.getByRole("button", { name: "G 4", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "C 4", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.mouse.up();
});

test.describe("desktop keyboard", () => {
  test.skip(({ isMobile }) => isMobile, "needs a physical keyboard");

  test("computer keys play chords, Shift sustains and minus/equals change octave", async ({
    page,
  }) => {
    await page.goto("/");
    await page.keyboard.down("KeyZ");
    await page.keyboard.down("KeyC");
    await expect(page.locator(".key--on")).toHaveCount(2);
    await page.keyboard.up("KeyZ");
    await page.keyboard.up("KeyC");
    await expect(page.locator(".key--on")).toHaveCount(0);

    await page.keyboard.down("Shift");
    await page.keyboard.down("KeyZ");
    await page.keyboard.up("KeyZ");
    await expect(page.locator(".key--on")).toHaveCount(1);
    await page.keyboard.up("Shift");
    await expect(page.locator(".key--on")).toHaveCount(0);

    await page.keyboard.press("Equal");
    await expect(page.locator(".lcd")).toContainText("C5–C7");
  });

  test("records a loop, plays it back, and downloads WAV and MIDI", async ({ page }) => {
    await countSound(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Record" }).click();
    for (const code of ["KeyZ", "KeyC", "KeyB"]) {
      await page.keyboard.down(code);
      await page.waitForTimeout(120);
      await page.keyboard.up(code);
    }
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Recorded 3 notes" })).toBeVisible();

    const before = await starts(page);
    await page.getByRole("button", { name: "Play" }).click();
    await expect(page.locator(".lcd__status")).toContainText("LOOP");
    await expect.poll(() => starts(page)).toBeGreaterThan(before);
    await page.getByRole("button", { name: "Stop" }).click();

    const wav = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download WAV" }).click();
    const wavFile = await wav;
    expect(wavFile.suggestedFilename()).toMatch(/^pocket-keys-piano-.*\.wav$/);
    const wavBytes = await (await import("node:fs/promises")).readFile((await wavFile.path())!);
    expect(wavBytes.subarray(0, 4).toString()).toBe("RIFF");
    expect(wavBytes.length).toBeGreaterThan(100_000);

    const mid = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download MIDI" }).click();
    const midFile = await mid;
    expect(midFile.suggestedFilename()).toMatch(/\.mid$/);
  });

  test("keys are reachable by Tab and play with Enter", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "C 4", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.down("Enter");
    await expect(page.locator(".lcd__note")).toHaveText("D4");
    await page.keyboard.up("Enter");
  });
});

test("opens a shared tune from a link", async ({ page }) => {
  await page.goto("/#tune=1~toy~1e~1o.0.f~1s.f.f~1v.u.f");
  await expect(page.getByText("Someone sent you a tune.")).toBeVisible();
  await expect(page.locator(".lcd__status")).toContainText("3 NOTES");
});

test("fits the screen with no sideways scroll", async ({ page }) => {
  await page.goto("/");
  const [scroll, width] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll).toBeLessThanOrEqual(width);
});
