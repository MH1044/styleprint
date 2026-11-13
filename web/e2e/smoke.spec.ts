import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

const SAMPLE_ONE = `Look, I didn't think I'd ever enjoy fixing things around the house, but here we are. The garbage disposal died on a Sunday and every plumber in town was closed, so I pulled up a video and found the reset button myself. Four minutes. I'd been avoiding that unit for two years out of pure dread.

That one small win changed something. I started treating every broken thing in the house like a puzzle instead of a verdict — the dripping faucet, the closet door that never sat flush, the dishwasher that smelled faintly of wet dog. One by one, I took them apart and most of the time they went back together fine.

Not everything worked out. I flooded the kitchen once because I didn't shut off the water at the valve first, just at the fixture, and learned that one the hard way with towels everywhere and my wife standing in the doorway saying nothing at all, which said plenty.`;

const SAMPLE_TWO = `I quit my job on a Tuesday, which in hindsight felt wrong — Tuesdays have no ceremony to them. For nine years I'd done the same shape of job at three different companies, different logos, same meetings, and I was good at it, which is its own trap.

So I left with eleven months of savings and a plan that fit on one index card: open a coffee shop. Not a concept, a coffee shop, the kind with a bell on the door and regulars who don't need to order out loud anymore. The first six months were humbling in ways nobody warns you about, even though everyone tries.

Eighteen months in, the shop breaks even most months and turns a real profit in December. I know every regular's order, and I know which ones are going through something just by what they order that week. None of that shows up on a spreadsheet, but it's the whole reason I did this.`;

const SAMPLE_THREE = `My tomatoes failed again this year, and honestly I think I finally know why. I planted them where the afternoon sun hits hardest, which sounded smart in April and turned out to be a slow roast by July.

The basil did fine. The basil always does fine, which is maybe the most annoying thing about it. You ignore it for three weeks and it still shows up looking better than anything you actually tried with.

Next year I'm moving everything two beds over and putting up a cheap shade cloth. Not because I read it somewhere, but because I'm tired of losing the same argument with the same patch of dirt.`;

const DRAFT = `In today's fast-paced world, remote collaboration tools have become increasingly crucial for distributed teams. It is important to note that Northwind Logistics, headquartered in Denver, reported that 54% of its 800 employees now work remotely at least three days a week as of Q2 2026.

Moreover, the company invested $1.4 million in new video conferencing infrastructure across its 9 regional offices. Additionally, leadership emphasized that productivity rose by 11% following the rollout, while employee turnover dropped by 6% year over year.

The leadership team, led by CEO Priya Nair, plans to share a follow-up report in Q4 2026 covering the next phase of the initiative.`;

test("full flow: profile -> ingest -> rewrite -> wizard -> editor -> export", async ({ page, request }) => {
  await page.goto("/");

  const profileName = `E2E Voice ${Date.now()}`;
  await page.getByTestId("new-profile-name").fill(profileName);
  await page.getByTestId("create-profile").click();
  await page.getByTestId(`select-profile-${await getProfileId(page, profileName)}`).click();

  // --- Ingest ---
  await page.getByTestId("consent-checkbox").check();

  await page.getByTestId("paste-textarea").fill(SAMPLE_ONE);
  await page.getByTestId("paste-submit").click();
  await expect(page.getByText(/words ingested/)).toBeVisible();

  await page.getByTestId("paste-textarea").fill(SAMPLE_TWO);
  await page.getByTestId("paste-submit").click();

  await expect(page.getByText("Samples (2)")).toBeVisible();

  // A real PDF upload: PDF text extraction is loaded on first use, so this is
  // the step that proves it works in a packaged build, not just in the repo.
  await page.getByTestId("file-input").setInputFiles({
    name: "garden-notes.pdf",
    mimeType: "application/pdf",
    buffer: await makePdf(SAMPLE_THREE),
  });
  await expect(page.getByText("Samples (3)")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("build-style").click();
  await expect(page.getByTestId("style-card")).toBeVisible({ timeout: 20_000 });

  await page.getByTestId("go-to-rewrite").click();

  // --- Rewrite ---
  await page.getByTestId("document-title").fill("E2E Draft");
  await page.getByTestId("draft-textarea").fill(DRAFT);
  await page.getByTestId("run-rewrite").click();
  await expect(page.getByTestId("rewrite-result")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("go-to-wizard").click();

  // --- Wizard: keep everything until the summary shows ---
  await expect(page.getByTestId("wizard-card").or(page.getByTestId("wizard-summary"))).toBeVisible({
    timeout: 10_000,
  });
  for (let i = 0; i < 10; i++) {
    if (await page.getByTestId("wizard-summary").isVisible()) break;
    try {
      await page.getByTestId("action-keep").click({ timeout: 3_000 });
    } catch {
      break;
    }
    await page.waitForTimeout(500);
  }
  await expect(page.getByTestId("wizard-summary")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("open-in-editor").click();

  // --- Editor ---
  await expect(page.getByTestId("editor-content")).toBeVisible();
  await page.getByTestId("voice-check").click();
  await expect(page.getByTestId("voice-check-score")).toBeVisible({ timeout: 10_000 });

  await page.getByTestId("heat-view-toggle").click();

  await page.getByTestId("open-export").click();
  await expect(page.getByTestId("export-dialog")).toBeVisible();

  const docxHref = await page.getByTestId("export-docx").getAttribute("href");
  const mdHref = await page.getByTestId("export-md").getAttribute("href");
  const pdfHref = await page.getByTestId("export-pdf").getAttribute("href");

  expect(docxHref).toBeTruthy();
  const docxResponse = await request.get(new URL(docxHref!, page.url()).toString());
  expect(docxResponse.ok()).toBe(true);
  expect(docxResponse.headers()["content-type"]).toContain("wordprocessingml");

  const mdResponse = await request.get(new URL(mdHref!, page.url()).toString());
  expect(mdResponse.ok()).toBe(true);
  const mdBody = await mdResponse.text();
  expect(mdBody).toContain("# E2E Draft");

  const pdfResponse = await request.get(new URL(pdfHref!, page.url()).toString());
  expect(pdfResponse.ok()).toBe(true);
  expect(pdfResponse.headers()["content-type"]).toContain("pdf");
});

/** A one-page PDF with the text laid out in wrapped lines, one block per paragraph. */
async function makePdf(text: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  let y = 740;
  for (const paragraph of text.split(/\n\s*\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (font.widthOfTextAtSize(`${line} ${word}`, 11) > 500) {
        page.drawText(line, { x: 56, y, size: 11, font });
        y -= 15;
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    page.drawText(line, { x: 56, y, size: 11, font });
    y -= 30;
  }
  return Buffer.from(await pdf.save());
}

async function getProfileId(page: import("@playwright/test").Page, name: string): Promise<string> {
  const row = page.locator("li", { hasText: name });
  const button = row.getByRole("button", { name: "Open" });
  const testId = await button.getAttribute("data-testid");
  if (!testId) throw new Error(`could not find profile row for ${name}`);
  return testId.replace("select-profile-", "");
}
