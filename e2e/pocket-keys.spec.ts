import { expect, test, type Page } from "@playwright/test";

/**
 * Counts sounds started (synth oscillators and piano recordings), so tests can tell that sound
 * was actually made.
 */
async function countSound(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __starts: number };
    w.__starts = 0;
    for (const node of [OscillatorNode, AudioBufferSourceNode]) {
      const proto = node.prototype as unknown as { start: (...a: unknown[]) => void };
      const original = proto.start;
      proto.start = function (this: unknown, ...args: unknown[]) {
        w.__starts++;
        return original.apply(this, args);
      };
    }
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
    await countSound(page);
    await page.goto("/");
    await page.keyboard.down("KeyZ");
    await page.keyboard.down("KeyC");
    await expect(page.locator(".key--on")).toHaveCount(2);
    await page.keyboard.up("KeyZ");
    await page.keyboard.up("KeyC");
    await expect(page.locator(".key--on")).toHaveCount(0);

    // Sustain is a damper pedal: the key pops back up, only the sound keeps ringing.
    await page.keyboard.down("Shift");
    await expect(page.locator(".lcd")).toContainText("SUSTAIN");
    const before = await starts(page);
    await page.keyboard.down("KeyZ");
    await expect(page.locator(".key--on")).toHaveCount(1);
    await page.keyboard.up("KeyZ");
    await expect(page.locator(".key--on")).toHaveCount(0);
    expect(await starts(page)).toBeGreaterThan(before);
    await page.keyboard.up("Shift");
    await expect(page.locator(".lcd")).not.toContainText("SUSTAIN");

    await page.keyboard.press("Equal");
    await expect(page.locator(".lcd")).toContainText("C5–C7");
  });

  test("records a loop, plays it back, and downloads WAV and MIDI", async ({ page }) => {
    await countSound(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Record a loop" }).click();
    for (const code of ["KeyZ", "KeyC", "KeyB"]) {
      await page.keyboard.down(code);
      await page.waitForTimeout(120);
      await page.keyboard.up(code);
    }
    await expect(page.locator(".lcd__status")).toContainText("REC 0:");
    await page.getByRole("button", { name: "Stop recording" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Recorded 3 notes" })).toBeVisible();

    const before = await starts(page);
    await page.getByRole("button", { name: "Play the loop" }).click();
    await expect(page.locator(".lcd__status")).toContainText("LOOP");
    await expect.poll(() => starts(page)).toBeGreaterThan(before);
    await page.getByRole("button", { name: "Stop the loop" }).click();

    const fs = await import("node:fs/promises");
    const wav = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Download sound/ }).click();
    const wavFile = await wav;
    expect(wavFile.suggestedFilename()).toMatch(/^pocket-keys-grand-.*\.wav$/);
    const wavBytes = await fs.readFile((await wavFile.path())!);
    expect(wavBytes.subarray(0, 4).toString()).toBe("RIFF");
    expect(wavBytes.length).toBeGreaterThan(100_000);
    await expect(page.getByRole("status")).toContainText(`Saved ${wavFile.suggestedFilename()}`);
    // The piano recordings made it into the file: it isn't silent.
    const pcm = new Int16Array(wavBytes.buffer, wavBytes.byteOffset + 44, 20_000);
    expect(Math.max(...pcm.map(Math.abs))).toBeGreaterThan(1000);

    const loop = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Download loop/ }).click();
    const loopFile = await loop;
    expect(loopFile.suggestedFilename()).toMatch(/^pocket-keys-grand-loop-.*\.wav$/);
    const loopBytes = await fs.readFile((await loopFile.path())!);
    expect(loopBytes.includes(Buffer.from("smpl"))).toBe(true);

    const mid = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Download notes/ }).click();
    const midFile = await mid;
    expect(midFile.suggestedFilename()).toMatch(/\.mid$/);
    await expect(page.getByRole("status")).toContainText("not a recording");
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

test("waits for the first note before the recording clock starts", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Record a loop" }).click();
  await expect(page.locator(".lcd__status")).toContainText("PLAY TO START");
  await page.waitForTimeout(400);
  const key = (await page.getByRole("button", { name: "C 4", exact: true }).boundingBox())!;
  await page.mouse.click(key.x + key.width / 2, key.y + key.height - 15);
  await expect(page.locator(".lcd__status")).toContainText("REC 0:0");
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByRole("button", { name: "Play the loop" })).toBeEnabled();
});

test("keeps the keys on screen without scrolling", async ({ page }) => {
  await page.goto("/");
  const box = (await page.locator(".keys").boundingBox())!;
  const height = await page.evaluate(() => window.innerHeight);
  expect(box.y + box.height).toBeLessThanOrEqual(height);
});

test("fits the screen with no sideways scroll", async ({ page }) => {
  await page.goto("/");
  const [scroll, width] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll).toBeLessThanOrEqual(width);
});

test("picks a sound from the grouped list and plays it", async ({ page }) => {
  await countSound(page);
  await page.goto("/");
  const pick = page.getByRole("combobox", { name: "Sound" });
  await expect(pick).toHaveValue("grand");
  await expect(pick.locator("optgroup")).toHaveCount(3);
  await pick.selectOption({ label: "Drum kit" });
  await expect(page.locator("#sound-hint")).toHaveText("Every key is a different drum");
  const before = await starts(page);
  await page.getByRole("button", { name: "C 4", exact: true }).click();
  await expect(page.locator(".lcd__note")).toHaveText("KICK");
  await expect(page.locator(".lcd")).toContainText("DRUM KIT");
  expect(await starts(page)).toBeGreaterThan(before);

  await pick.selectOption({ label: "Alien" });
  await page.getByRole("button", { name: "E 4", exact: true }).click();
  await expect(page.locator(".lcd__note")).toHaveText("E4");
  // The choice is remembered.
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Sound" })).toHaveValue("alien");
});
