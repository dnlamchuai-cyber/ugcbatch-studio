// Desktop-only product-link import: load a marketplace product page in a real Chromium window
// with the customer's own IP and a persistent session, so Shopee / TikTok Shop / Taobao etc.
// serve the normal page instead of the anti-bot wall they show to servers.
// The page's own product API responses (e.g. Shopee /api/v4/pdp/get_pc) are captured via the
// DevTools protocol; the rendered HTML is returned too so the server can parse og/ld+json.
// If the marketplace demands a login or captcha, the window is shown so the customer can solve it.
const { BrowserWindow } = require("electron");

const PARTITION = "persist:marketplace";
const API_RE = /\/api\/v4\/(pdp\/get_pc|item\/get|pdp\/get)\b|\/api\/shop\/pdp_desktop\/page_data|mtop\.taobao\.pcdetail|\/product\/detail/i;
const WALL_RE = /\/verify\/|\/buyer\/login|captcha|security[-_ ]check|punish|login\.(taobao|tmall|1688)\.com|havanaone|\/ap\/signin|validatecaptcha/i;
const HIDDEN_TIMEOUT_MS = 25000;
const INTERACTIVE_TIMEOUT_MS = Number(process.env.MARKETPLACE_INTERACTIVE_TIMEOUT_MS) || 180000;

const DEBUG = !!process.env.MARKETPLACE_DEBUG;
const dlog = (...a) => DEBUG && console.log("[marketplace]", ...a);
/** executeJavaScript can hang forever while a page navigates; always bound it */
function evalWithTimeout(win, code, ms, fallback) {
  return Promise.race([win.webContents.executeJavaScript(code).catch(() => fallback), new Promise((r) => setTimeout(() => r(fallback), ms))]);
}

function readDomScript() {
  return `(() => {
    const html = document.documentElement.outerHTML;
    const imgs = [...document.querySelectorAll('img')].map(i => i.currentSrc || i.src)
      .filter(s => /^https:/.test(s) && !/avatar|icon|logo|sprite/i.test(s)).slice(0, 40);
    return { html: html.slice(0, 3000000), title: document.title, imgs };
  })()`;
}

/**
 * @param {string} url product URL (already validated by the server's URL rules)
 * @returns {Promise<{ apiJson?: unknown, html?: string, domImages?: string[], finalUrl: string }>}
 */
async function fetchProductInWindow(url) {
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    title: "Reading product page…",
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  let apiJson;
  const dbg = win.webContents.debugger;
  const pending = new Map();
  dlog("open", url);
  try {
    // Network capture only where the product data lives in an XHR (Shopee pdp API). Attaching the
    // debugger on Taobao-class pages froze the main process under test, and their DOM is enough.
    if (process.env.MARKETPLACE_NO_DEBUGGER || !/shopee\.|shp\.ee/i.test(url)) throw new Error("debugger not used");
    dbg.attach("1.3");
    await Promise.race([dbg.sendCommand("Network.enable"), new Promise((r) => setTimeout(r, 3000))]);
    dlog("debugger attached");
    dbg.on("message", async (_e, method, params) => {
      if (method === "Network.responseReceived" && API_RE.test(params.response.url) && /json/i.test(params.response.mimeType || "")) {
        pending.set(params.requestId, params.response.url);
      } else if (method === "Network.loadingFinished" && pending.has(params.requestId)) {
        pending.delete(params.requestId);
        try {
          const { body, base64Encoded } = await dbg.sendCommand("Network.getResponseBody", { requestId: params.requestId });
          const parsed = JSON.parse(base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body);
          if (!apiJson || (parsed && parsed.data)) apiJson = parsed;
        } catch {
          /* ignore unreadable bodies */
        }
      }
    });
  } catch {
    /* debugger unavailable — DOM read still works */
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    // loadURL resolves only on did-finish-load; pages that keep loading (trackers, long-poll, login
    // redirects) would hang the import forever, so cap the wait and carry on reading the DOM
    await Promise.race([win.loadURL(url).catch(() => undefined), wait(20000)]);
    let deadline = Date.now() + HIDDEN_TIMEOUT_MS;
    let shown = false;
    while (Date.now() < deadline) {
      await wait(1000);
      const cur = win.webContents.getURL();
      dlog("tick", cur.slice(0, 120));
      if (WALL_RE.test(cur) && !shown) {
        // Login / captcha: let the customer solve it once; the session persists for next imports.
        shown = true;
        win.setTitle("Sign in or complete the check — the import continues automatically");
        win.show();
        deadline = Date.now() + INTERACTIVE_TIMEOUT_MS;
        continue;
      }
      if (apiJson && apiJson.data) break;
      if (!WALL_RE.test(cur)) {
        const og = await evalWithTimeout(win, `!!document.querySelector('meta[property="og:title"]') && document.querySelectorAll('img').length > 3`, 3000, false);
        if (og && Date.now() > deadline - HIDDEN_TIMEOUT_MS + 6000) break;
      }
    }
    const dom = await evalWithTimeout(win, readDomScript(), 10000, {});
    dlog("read", url, "->", win.webContents.getURL(), "html", (dom.html || "").length, "imgs", (dom.imgs || []).length, "api", !!apiJson);
    return { apiJson, html: dom.html, domImages: dom.imgs, finalUrl: win.webContents.getURL() };
  } finally {
    try {
      dbg.detach();
    } catch {
      /* ignore */
    }
    win.destroy();
  }
}

/** Wire the server child's IPC requests ({type:"marketplace-fetch", id, url}) to the window reader. */
function attachMarketplaceBridge(child, log = () => {}) {
  child.on("message", async (msg) => {
    if (!msg || msg.type !== "marketplace-fetch" || typeof msg.url !== "string" || !/^https?:\/\//i.test(msg.url)) return;
    try {
      const result = await fetchProductInWindow(msg.url);
      child.send({ type: "marketplace-fetch-result", id: msg.id, ok: true, result });
    } catch (e) {
      log("marketplace-fetch failed: " + (e && e.message));
      child.send({ type: "marketplace-fetch-result", id: msg.id, ok: false, error: String(e && e.message) });
    }
  });
}

module.exports = { fetchProductInWindow, attachMarketplaceBridge };
