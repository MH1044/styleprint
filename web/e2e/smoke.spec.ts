import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import mammoth from "mammoth";

const SAMPLE_ONE = `Look, I didn't think I'd ever enjoy fixing things around the house, but here we are. The garbage disposal died on a Sunday and every plumber in town was closed, so I pulled up a video and found the reset button myself. Four minutes. I'd been avoiding that unit for two years out of pure dread.

That one small win changed something. I started treating every broken thing in the house like a puzzle instead of a verdict — the dripping faucet, the closet door that never sat flush, the dishwasher that smelled faintly of wet dog. One by one, I took them apart and most of the time they went back together fine.

Not everything worked out. I flooded the kitchen once because I didn't shut off the water at the valve first, just at the fixture, and learned that one the hard way with towels everywhere and my wife standing in the doorway saying nothing at all, which said plenty.`;

const SAMPLE_TWO = `I quit my job on a Tuesday, which in hindsight felt wrong — Tuesdays have no ceremony to them. For nine years I'd done the same shape of job at three different companies, different logos, same meetings, and I was good at it, which is its own trap.

So I left with eleven months of savings and a plan that fit on one index card: open a coffee shop. Not a concept, a coffee shop, the kind with a bell on the door and regulars who don't need to order out loud anymore. The first six months were humbling in ways nobody warns you about, even though everyone tries.

Eighteen months in, the shop breaks even most months and turns a real profit in December. I know every regular's order, and I know which ones are going through something just by what they order that week. None of that shows up on a spreadsheet, but it's the whole reason I did this.`;

const SAMPLE_THREE = `My tomatoes failed again this year, and honestly I think I finally know why. I planted them where the afternoon sun hits hardest, which sounded smart in April and turned out to be a slow roast by July.

The basil did fine. The basil always does fine, which is maybe the most annoying thing about it. You ignore it for three weeks and it still shows up looking better than anything you actually tried with.

Next year I'm moving everything two beds over and putting up a cheap shade cloth. Not because I read it somewhere, but because I'm tired of losing the same argument with the same patch of dirt.`;

const DRAFT = `## Remote work at Northwind

In today's fast-paced world, remote collaboration tools have become increasingly crucial for distributed teams. It is important to note that Northwind Logistics, headquartered in Denver, reported that 54% of its 800 employees now work remotely at least three days a week as of Q2 2026.[^1]

Moreover, the company invested $1.4 million in new video conferencing infrastructure across its 9 regional offices. Additionally, leadership emphasized that productivity rose by 11% following the rollout, while employee turnover dropped by 6% year over year.

The leadership team, led by CEO Priya Nair, plans to share a follow-up report in Q4 2026 covering the next phase of the initiative.

[^1]: Northwind Logistics staff survey, June 2026.`;

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
  await expect(page.getByText("Samples (1)")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("paste-textarea").fill(SAMPLE_TWO);
  await page.getByTestId("paste-submit").click();

  await expect(page.getByText("Samples (2)")).toBeVisible({ timeout: 15_000 });

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

  // --- Wizard: keep the first card, then skip the rest ---
  await expect(page.getByTestId("wizard-card")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("action-keep").click();
  await expect(page.getByText(/2 left to review/)).toBeVisible();
  await page.getByTestId("skip-rest").click();
  await expect(page.getByTestId("wizard-summary")).toBeVisible();
  await expect(page.getByText("Skipped: 2")).toBeVisible();
  await expect(page.getByTestId("learning-status")).toContainText("1 review decision logged");
  await page.getByTestId("open-in-editor").click();

  // --- Editor: the draft's heading and footnote are there ---
  const editor = page.locator("[data-testid=editor-content] .ProseMirror");
  await expect(editor.locator("h2")).toHaveText("Remote work at Northwind");
  await expect(page.getByTestId("footnote-text-1")).toHaveValue("Northwind Logistics staff survey, June 2026.");

  await page.getByTestId("voice-check").click();
  await expect(page.getByTestId("voice-check-score")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("heat-view-toggle").click();

  // Type at the end of the last paragraph, then add a second footnote there.
  await editor.locator("p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Hand-typed closing line.");
  await page.getByTestId("add-footnote").click();
  await page.getByTestId("footnote-input").fill("Added in the editor.");
  await page.getByTestId("footnote-insert").click();
  await expect(page.getByTestId("footnote-text-2")).toHaveValue("Added in the editor.");

  // --- Versions: save one, change the text, restore it ---
  await page.getByTestId("versions-toggle").click();
  const versions = page.getByTestId("version-item");
  await expect(versions.filter({ hasText: "Wizard finished" })).toHaveCount(1);
  await page.getByTestId("version-label").fill("Before trimming");
  await page.getByTestId("save-version").click();
  await expect(versions.filter({ hasText: "Before trimming" })).toHaveCount(1);

  await editor.locator("p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Temporary sentence.");
  await versions.filter({ hasText: "Before trimming" }).getByTestId("version-compare").click();
  await expect(page.getByTestId("version-compare-view")).toContainText("Temporary sentence.");
  await versions.filter({ hasText: "Before trimming" }).getByTestId("version-restore").click();
  await expect(editor).not.toContainText("Temporary sentence.");
  await expect(editor).toContainText("Hand-typed closing line.");
  await expect(versions.filter({ hasText: "Before restoring “Before trimming”" })).toHaveCount(1);

  // --- Export: every format renders what the editor shows ---
  await page.getByTestId("open-export").click();
  await expect(page.getByTestId("export-dialog")).toBeVisible();
  const href = async (format: string) => new URL((await page.getByTestId(`export-${format}`).getAttribute("href"))!, page.url()).toString();

  const md = await request.get(await href("md"));
  expect(md.ok()).toBe(true);
  const mdBody = await md.text();
  expect(mdBody).toContain("# E2E Draft");
  expect(mdBody).toContain("## Remote work at Northwind");
  expect(mdBody).toContain("Hand-typed closing line.[^2]");
  expect(mdBody).not.toContain("Temporary sentence.");
  expect(mdBody).toContain("[^1]: Northwind Logistics staff survey, June 2026.\n[^2]: Added in the editor.");

  const docx = await request.get(await href("docx"));
  expect(docx.ok()).toBe(true);
  expect(docx.headers()["content-type"]).toContain("wordprocessingml");
  const { value: docxHtml } = await mammoth.convertToHtml({ buffer: Buffer.from(await docx.body()) });
  expect(docxHtml).toContain("<h2>Remote work at Northwind</h2>");
  expect(docxHtml).toContain("Hand-typed closing line.");
  expect(docxHtml).toContain('<li id="footnote-1"><p>Northwind Logistics staff survey, June 2026.');
  expect(docxHtml).toContain('<li id="footnote-2"><p>Added in the editor.');

  const pdf = await request.get(await href("pdf"));
  expect(pdf.ok()).toBe(true);
  expect(pdf.headers()["content-type"]).toContain("pdf");

  // A click in the app asks for a download, never an in-place view.
  const download = await request.get(`${await href("pdf")}&download=1`);
  expect(download.headers()["content-type"]).toBe("application/octet-stream");
  expect(download.headers()["content-disposition"]).toContain('filename="E2E Draft.pdf"');

  // Each export left a named version behind.
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("versions-toggle").click();
  await page.getByTestId("versions-toggle").click();
  await expect(versions.filter({ hasText: "Exported as .md" })).toHaveCount(1);
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
