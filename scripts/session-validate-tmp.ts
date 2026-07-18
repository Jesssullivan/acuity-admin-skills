import puppeteer from "puppeteer-core";
import fs from "fs";

async function main() {
  const raw = JSON.parse(fs.readFileSync(".acuity-cookies.json", "utf8")); const cookies = (Array.isArray(raw) ? raw : raw.cookies).map((c: any) => { const k = {...c}; delete k.partitionKey; delete k.sameParty; delete k.sourceScheme; delete k.sourcePort; delete k.priority; return k; });
  const b = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH,
    headless: true,
    args: ["--no-first-run", "--disable-features=ProfilePicker"],
  });
  try {
    const p = await b.newPage();
    await p.setCookie(...cookies);
    await p.goto("https://secure.acuityscheduling.com/appointments.php", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    const body = await p.evaluate(() => document.body.innerText.slice(0, 400));
    const loginForm = await p.$("#login-form, input#username");
    const loggedOut = /Log in to Acuity|FORGOT PASSWORD/i.test(body) || loginForm !== null;
    console.log(loggedOut ? "SESSION-EXPIRED" : "SESSION-VALID");
  } finally {
    await b.close();
  }
}
main().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
