import fs from "node:fs";
import XLSX from "xlsx";

const source = "attached_assets/Where_are_the_emails_1790905412941.xlsx";
const prefix = "reports/state-export-email-review";
const workbook = XLSX.readFile(source);
const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
const input = rows.map((original, index) => ({ row: index + 2, ...original }));
fs.mkdirSync("reports", { recursive: true });
fs.writeFileSync(`${prefix}-input.json`, JSON.stringify(input, null, 2));

async function crawl() {
  const { crawlWebsite } = await import("../server/lead-discovery");
  const excluded = /(^|\.)(facebook\.com|instagram\.com|vagaro\.com|gingrapp\.com)$/i;
  const eligible = input.filter(row => {
    try { return !excluded.test(new URL(row["Website URL"]).hostname); } catch { return false; }
  });
  const evidence: object[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < eligible.length) {
      const row = eligible[next++];
      try {
        const result = await crawlWebsite(row["Website URL"]);
        evidence.push({
          row: row.row, business: row["Business Name"], website: row["Website URL"],
          candidateEmail: result.email || "", phone: result.phone || "",
          contactForm: result.contactFormUrl || "", software: result.softwareName || "",
          bookingUrl: result.bookingUrl || "",
          status: result.html ? "fetched_requires_source_review" : "fetch_failed",
        });
      } catch (error) {
        evidence.push({ row: row.row, business: row["Business Name"], status: "fetch_failed", error: String(error) });
      }
      fs.writeFileSync(`${prefix}-crawler.json`, JSON.stringify(evidence, null, 2));
      console.log(`Crawled ${row.row}: ${row["Business Name"]}`);
    }
  }));
  console.log(JSON.stringify(evidence, null, 2));
}

function buildReport() {
  const parts = [0, 1, 2].flatMap(part =>
    JSON.parse(fs.readFileSync(`${prefix}-part-${part}.json`, "utf8")),
  );
  if (parts.length !== input.length || new Set(parts.map(row => row.row)).size !== input.length) {
    throw new Error("Review must cover all 36 rows exactly once.");
  }
  const byRow = new Map(parts.map(row => [row.row, row]));
  const overrides = JSON.parse(fs.readFileSync(`${prefix}-overrides.json`, "utf8"));
  for (const override of overrides) {
    if (!byRow.has(override.row)) throw new Error(`Override for unknown row ${override.row}`);
    byRow.set(override.row, { ...byRow.get(override.row), ...override });
  }
  const crawler = JSON.parse(fs.readFileSync(`${prefix}-crawler.json`, "utf8"));
  const crawlsByRow = new Map(crawler.map((row: any) => [row.row, row]));
  const checkedOn = new Date().toISOString();
  const review = input.map(original => {
    const result = byRow.get(original.row);
    if (!result || result.business !== original["Business Name"]) {
      throw new Error(`Missing or mismatched identity for row ${original.row}`);
    }
    const confirmed = ["confirmed_first_party", "confirmed_public_directory"].includes(result.emailStatus);
    if (confirmed && (!result.confirmedEmail || !result.emailSourceUrl || !result.identityEvidence || !result.emailContext)) {
      throw new Error(`Confirmed email lacks source evidence on row ${original.row}`);
    }
    if (!confirmed && result.confirmedEmail) throw new Error(`Unreviewed email in confirmed field on row ${original.row}`);
    const email = confirmed ? result.confirmedEmail : "";
    const crawl: any = crawlsByRow.get(original.row);
    const addressZip = original.Address.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1];
    const zipNote = addressZip && original["ZIP Code"] && addressZip !== original["ZIP Code"]
      ? "Export ZIP differs from business-address ZIP; matched using address, not search ZIP." : "";
    return {
      ...original,
      Email: email,
      "Original Email": original.Email,
      "Email Status": result.emailStatus,
      "Email Source URL": result.emailSourceUrl || "",
      "Source Type": result.sourceType || "",
      "Needs Review - Candidate Email": result.candidateEmail || "",
      "Business Identity Evidence": result.identityEvidence || "",
      "Email Publication Context": result.emailContext || "",
      "Discovered Website": result.website || "",
      "Contact Form URL": result.contactFormUrl || "",
      "Unverified Contact Page": result.candidateContactPageUrl || "",
      "Found Phone": result.phone || "",
      "Reviewed Owner First Name": result.ownerFirstName || "",
      "Reviewed Owner Last Name": result.ownerLastName || "",
      "Owner Source URL": result.ownerSourceUrl || "",
      "Crawler Outcome": crawl?.status || "Not crawled: social or booking platform",
      "Crawler Candidate (not approval)": crawl?.candidateEmail || "",
      "New Email Found": email && !original.Email ? "Yes" : "No",
      "Checked On (UTC)": checkedOn,
      "Review Notes": [result.notes, zipNote].filter(Boolean).join(" "),
    };
  });
  const confirmed = review.filter(row => row.Email);
  const newlyFound = confirmed.filter(row => row["New Email Found"] === "Yes");
  const candidates = review.filter(row => row["Needs Review - Candidate Email"]);
  const summary = [
    { Item: "Businesses checked", Value: input.length },
    { Item: "Original rows with emails", Value: input.filter(row => row.Email).length },
    { Item: "Confirmed published business-email rows", Value: confirmed.length },
    { Item: "Newly filled originally blank email rows", Value: newlyFound.length },
    { Item: "Existing email rows confirmed or corrected", Value: confirmed.length - newlyFound.length },
    { Item: "First-party confirmed email rows", Value: review.filter(row => row["Email Status"] === "confirmed_first_party").length },
    { Item: "Live public-directory confirmed email rows", Value: review.filter(row => row["Email Status"] === "confirmed_public_directory").length },
    { Item: "Rows with review-only email candidates", Value: candidates.length },
    { Item: "Rows still without confirmed emails", Value: review.filter(row => !row.Email).length },
    { Item: "Rows with general contact-form paths", Value: review.filter(row => row["Contact Form URL"]).length },
    { Item: "Existing website-crawler attempts", Value: crawler.length },
    { Item: "Existing crawler fetch failures", Value: crawler.filter((row: any) => row.status === "fetch_failed").length },
    { Item: "Paid SerpAPI / DataForSEO calls", Value: 0 },
    { Item: "Contacts imported / messages sent", Value: 0 },
    { Item: "Meaning of confirmed", Value: "Email visibly published on a current matching business or directory page; NOT a deliverability, mailbox-owner or consent test." },
    { Item: "Review-only emails", Value: "Kept out of Email column; indexed social snippets or unresolved identity/purpose need further review." },
    { Item: "Existing addresses", Value: "Original Export sheet and Original Email column preserve original values even if not confirmed for this branch." },
    { Item: "Owner names", Value: "Do not enable personal-name greetings merely because a business owner is identified." },
    { Item: "Source ZIP codes", Value: "Search ZIP may differ from actual business-address ZIP. Original data preserved; source address used for identity." },
    { Item: "Checked on (UTC)", Value: checkedOn },
  ];
  const resultWorkbook = XLSX.utils.book_new();
  const addSheet = (name: string, data: object[]) => {
    const sheet = XLSX.utils.json_to_sheet(data.length ? data : [{ Result: "None" }]);
    sheet["!autofilter"] = { ref: sheet["!ref"]! };
    sheet["!cols"] = Object.keys((data[0] || { Result: "" })).map(key => ({
      wch: /Notes|Evidence|Context|URL|Value/i.test(key) ? 60 : /Name|Business|Email/i.test(key) ? 32 : 22,
    }));
    XLSX.utils.book_append_sheet(resultWorkbook, sheet, name);
  };
  addSheet("Summary", summary);
  addSheet("Reviewed Results", review);
  addSheet("New Confirmed Emails", newlyFound);
  addSheet("Review Only Candidates", candidates);
  addSheet("No Confirmed Email", review.filter(row => !row.Email));
  addSheet("Original Export", rows);
  fs.writeFileSync(`${prefix}-reviewed.json`, JSON.stringify({ checkedOn, summary, rows: review, research: parts }, null, 2));
  XLSX.writeFile(resultWorkbook, `${prefix}.xlsx`);
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv.includes("--crawl")) {
  crawl().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
} else if (process.argv.includes("--build")) {
  buildReport();
} else {
  console.log(`Prepared ${input.length} rows; ${rows.filter(row => row.Email).length} existing emails.`);
}