const injectPandaScripts = (tab) => {
  chrome.scripting
    .insertCSS({
      target: { tabId: tab.id },
      files: ["bundle/layers.css", "bundle/styles.css"],
    })
    .then(() => {
      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          files: ["bundle/main.bundle.js"],
        },
        () => {
          chrome.tabs.sendMessage(tab.id, { action: "open" });
        }
      );
    });
};

const injectPageDetailsScripts = (tab) => {
  chrome.scripting.insertCSS(
    {
      target: { tabId: tab.id },
      files: ["bundle/styles.css", "bundle/layers.css"],
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error("[EXTRACT-SERVICE] [HIGHLIGHT] Error injecting styles:", chrome.runtime.lastError);
      } else {
        console.log("[EXTRACT-SERVICE] [HIGHLIGHT] Styles injected successfully");
      }
    }
  );
  chrome.scripting.executeScript(
    {
      target: { tabId: tab.id },
      files: ["bundle/selector.bundle.js"],
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error("[EXTRACT-SERVICE] [HIGHLIGHT] Error injecting script:", chrome.runtime.lastError);
      } else {
        console.log("[EXTRACT-SERVICE] [HIGHLIGHT] Script injected successfully");
      }
    }
  );
};

// =============================================================================
// EUROTOPTECH.COM - MULTI-CARD CLICK + URL EXTRACTION
// =============================================================================
// eurotoptech.com job cards are plain <div> elements with no href.
// To get the Apply URL we must:
//   1. Find ALL job cards on the current page
//   2. Click each one in sequence
//   3. Wait for the modal to open (~800ms)
//   4. Read the "Apply Now" <a href> from the modal
//   5. Close the modal (press Escape or click X)
//   6. Wait for modal to close (~400ms)
//   7. Move to next card
//   8. Repeat until all cards on this page are done
//   9. Report all collected URLs back to the extension
// =============================================================================

// This function runs INSIDE the page (injected via executeScript)
const euroTopTechClickAndScrapeAllCards = async () => {
  const results = [];
  const delay = (ms) => new Promise((res) => setTimeout(res, ms));

  // Known job board domains to match Apply Now links
  const JOB_DOMAINS = [
    "amazon.jobs", "careers.uber", "greenhouse.io", "lever.co",
    "workday.com", "myworkdayjobs", "linkedin.com/jobs", "metacareers.com",
    "careers.google", "jobs.netflix", "spotify.com", "microsoft.com/en-us/research",
    "smartrecruiters.com", "ashbyhq.com", "personio.com", "booking.com",
    "cloudflare.com", "snowflake.com", "adobe.com", "affirm.com",
    "miro.com", "bendinspoons.com", "jobs.apple", "careers.salesforce",
    "stripe.com/jobs", "dropbox.com/jobs", "airbnb.io", "uber.com/careers",
    "grammarly.com/jobs", "notion.so/careers", "figma.com/careers",
  ];

  const isJobLink = (href) =>
    href && JOB_DOMAINS.some((d) => href.includes(d));

  // Find the Apply Now link in the currently open modal
  const getApplyUrlFromModal = () => {
    // Try all anchor tags visible in modal/dialog overlays
    const modalSelectors = [
      "[role='dialog'] a[href]",
      "[class*='modal'] a[href]",
      "[class*='Modal'] a[href]",
      "[class*='drawer'] a[href]",
      "[class*='Drawer'] a[href]",
      "[class*='overlay'] a[href]",
      "[class*='panel'] a[href]",
      "[class*='Panel'] a[href]",
      "[class*='sheet'] a[href]",
    ];
    for (const sel of modalSelectors) {
      const links = Array.from(document.querySelectorAll(sel));
      const match = links.find((a) => isJobLink(a.href));
      if (match) return match.href;
    }
    // Fallback: scan ALL visible links on page for job board domains
    const allLinks = Array.from(document.querySelectorAll("a[href]"));
    const match = allLinks.find((a) => isJobLink(a.href));
    return match ? match.href : null;
  };

  // Close modal by pressing Escape key
  const closeModal = () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
    // Also try clicking a close button
    const closeBtn = document.querySelector(
      "[aria-label='Close'], [aria-label='close'], button[class*='close'], button[class*='Close'], " +
      "[class*='modal'] button, [role='dialog'] button"
    );
    if (closeBtn) closeBtn.click();
  };

  // Check if a modal is currently open
  const isModalOpen = () => {
    return !!(
      document.querySelector("[role='dialog']:") ||
      document.querySelector("[class*='modal'][class*='open']")||
      document.querySelector("[class*='Modal'][class*='open']")||
      document.querySelector("[class*='drawer'][class*='open']")||
      document.querySelector("[class*='overlay'][class*='active']")
    );
  };

  // Get all job cards on the current page
  // eurotoptech cards are divs inside a grid - they contain h2/h3 titles
  const getCards = () => {
    // Try multiple selector strategies
    const strategies = [
      () => Array.from(document.querySelectorAll("[class*='JobCard']")),
      () => Array.from(document.querySelectorAll("[class*='job-card']")),
      () => Array.from(document.querySelectorAll("[class*='jobCard']")),
      () => Array.from(document.querySelectorAll("[class*='card'][class*='job']")),
      // Fallback: find divs that contain job titles (h2/h3) and comp data
      () => {
        const allDivs = Array.from(document.querySelectorAll("div"));
        return allDivs.filter((el) => {
          const hasTitle = el.querySelector("h2, h3");
          const hasComp = el.textContent.includes("Total Comp");
          const isCard = hasTitle && hasComp;
          const isNotParent = !el.querySelector("[class*='card']");
          return isCard && isNotParent;
        });
      },
    ];
    for (const strategy of strategies) {
      const cards = strategy();
      if (cards.length > 0) return cards;
    }
    return [];
  };

  const cards = getCards();
  console.log(`[EuroTopTech] Found ${cards.length} job cards to process`);

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const titleEl = card.querySelector("h2, h3");
    const title = titleEl ? titleEl.textContent.trim() : `Job ${i + 1}`;
    const companyEl = card.querySelector("[class*='company'], [class*='Company'], span:first-child");
    const company = companyEl ? companyEl.textContent.trim() : "";

    try {
      // Scroll card into view
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      await delay(300);

      // Click the card to open the modal
      card.click();
      console.log(`[EuroTopTech] Clicked card ${i + 1}/${cards.length}: ${title}`);

      // Wait for modal to open
      await delay(900);

      // Try to get the apply URL from the modal
      const url = getApplyUrlFromModal();

      if (url) {
        console.log(`[EuroTopTech] Got URL for ${title}: ${url}`);
        results.push({ title, company, url, index: i });
      } else {
        console.warn(`[EuroTopTech] No URL found for card ${i + 1}: ${title}`);
        results.push({ title, company, url: null, index: i });
      }

      // Close the modal
      closeModal();
      await delay(500);

    } catch (err) {
      console.error(`[EuroTopTech] Error on card ${i + 1}:`, err);
      results.push({ title, company, url: null, index: i, error: err.message });
      // Try to close modal if stuck
      closeModal();
      await delay(400);
    }
  }

  console.log(`[EuroTopTech] Done. Collected ${results.filter(r => r.url).length}/${cards.length} URLs`);
  return results;
};

// Message listener for the extension UI to trigger the scrape
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Trigger multi-card click scrape on eurotoptech.com
  if (message.action === "scrape-eurotoptech-urls") {
    const tabId = message.tabId || sender?.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: "No tabId provided" });
      return true;
    }
    chrome.scripting
      .executeScript({
        target: { tabId },
        func: euroTopTechClickAndScrapeAllCards,
      })
      .then((injectionResults) => {
        const data = injectionResults?.[0]?.result || [];
        sendResponse({ success: true, data });
      })
      .catch((err) => {
        console.error("[EuroTopTech] executeScript error:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // keep channel open for async response
  }

  // Get count of cards without clicking (quick preview)
  if (message.action === "eurotoptech-count-cards") {
    const tabId = message.tabId || sender?.tab?.id;
    chrome.scripting
      .executeScript({
        target: { tabId },
        func: () => {
          const cards = document.querySelectorAll(
            "[class*='JobCard'], [class*='job-card'], [class*='jobCard']"
          );
          // Fallback count
          if (cards.length === 0) {
            return Array.from(document.querySelectorAll("div")).filter(
              (el) => el.querySelector("h2,h3") && el.textContent.includes("Total Comp")
            ).length;
          }
          return cards.length;
        },
      })
      .then((res) => sendResponse({ count: res?.[0]?.result || 0 }))
      .catch((err) => sendResponse({ count: 0, error: err.message }));
    return true;
  }
});

// Auto-inject on eurotoptech.com page load
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    tab.url &&
    tab.url.includes("eurotoptech.com")
  ) {
    // Inject a passive listener that fires when extension sends scrape request
    chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (window.__euroTopTechListenerAttached) return;
        window.__euroTopTechListenerAttached = true;
        // Listen for custom scrape trigger from extension popup
        window.addEventListener("message", (event) => {
          if (event.data?.type === "EUROTOPTECH_SCRAPE_START") {
            console.log("[EuroTopTech] Scrape triggered via window message");
          }
        });
        console.log("[EuroTopTech] Content listener ready");
      },
    }).catch(() => {});
  }
});

// Panda Icon clicked
chrome.action.onClicked.addListener((tab) => {
  console.log("Panda Extract: Action clicked", tab);
  injectPandaScripts(tab);
  // injectPageDetailsScripts(tab);
});

importScripts("bundle/service.bundle.js");
