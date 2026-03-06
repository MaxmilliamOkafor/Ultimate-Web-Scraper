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
  // inject css
  chrome.scripting.insertCSS(
    {
      target: { tabId: tab.id },
      files: ["bundle/styles.css", "bundle/layers.css"],
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error(
          "[EXTRACT-SERVICE] [HIGHLIGHT] Error injecting styles:",
          chrome.runtime.lastError
        );
      } else {
        console.log(
          "[EXTRACT-SERVICE] [HIGHLIGHT] Styles injected successfully"
        );
      }
    }
  );

  // inject script
  chrome.scripting.executeScript(
    {
      target: { tabId: tab.id },
      files: ["bundle/selector.bundle.js"],
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error(
          "[EXTRACT-SERVICE] [HIGHLIGHT] Error injecting script:",
          chrome.runtime.lastError
        );
      } else {
        console.log(
          "[EXTRACT-SERVICE] [HIGHLIGHT] Script injected successfully"
        );
      }
    }
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// eurotoptech.com – URL scraper fix
// Job cards on this site are <div> elements (no <a href>), so the generic
// link scraper finds nothing. This handler intercepts the scrape-urls message
// and extracts job apply-URLs by:
//   1. Reading the Next.js __NEXT_DATA__ JSON embedded in the page
//   2. Falling back to data-* attributes on job card divs
//   3. Falling back to reading the "Apply Now" button href inside each modal
// ─────────────────────────────────────────────────────────────────────────────
const scrapeEuroTopTechUrls = () => {
  const results = [];

  // Strategy 1: __NEXT_DATA__ (Next.js server-side props)
  try {
    const nextDataEl = document.getElementById("__NEXT_DATA__");
    if (nextDataEl) {
      const nextData = JSON.parse(nextDataEl.textContent);
      const pageProps = nextData?.props?.pageProps || {};
      const jobs =
        pageProps.jobs ||
        pageProps.initialJobs ||
        pageProps.jobListings ||
        pageProps.data?.jobs ||
        [];
      if (Array.isArray(jobs) && jobs.length > 0) {
        jobs.forEach((job) => {
          const url =
            job.url ||
            job.applyUrl ||
            job.apply_url ||
            job.link ||
            job.jobUrl ||
            job.externalUrl ||
            null;
          if (url) {
            results.push({
              title: job.title || job.name || "",
              company: job.company || job.companyName || "",
              location: job.location || "",
              url,
            });
          }
        });
        if (results.length > 0) return results;
      }
    }
  } catch (e) {
    console.warn("[EuroTopTech] __NEXT_DATA__ parse failed:", e);
  }

  // Strategy 2: data-* attributes on job card elements
  const cardSelectors = [
    "[data-job-url]",
    "[data-url]",
    "[data-apply-url]",
    "[data-href]",
    "[data-external-url]",
  ];
  const cards = document.querySelectorAll(cardSelectors.join(","));
  if (cards.length > 0) {
    cards.forEach((card) => {
      const url =
        card.dataset.jobUrl ||
        card.dataset.url ||
        card.dataset.applyUrl ||
        card.dataset.href ||
        card.dataset.externalUrl ||
        null;
      const titleEl = card.querySelector("h2, h3, [class*='title']");
      if (url) {
        results.push({
          title: titleEl ? titleEl.textContent.trim() : "",
          url,
        });
      }
    });
    if (results.length > 0) return results;
  }

  // Strategy 3: Look for Apply Now / Apply links inside rendered job card HTML
  // eurotoptech renders cards as divs; the apply URL is stored in onClick handlers
  // We can find it by searching for anchor tags with common job board domains
  const allLinks = Array.from(document.querySelectorAll("a[href]"));
  const jobBoardDomains = [
    "amazon.jobs",
    "careers.uber.com",
    "careers.google.com",
    "linkedin.com/jobs",
    "greenhouse.io",
    "lever.co",
    "workday.com",
    "myworkdayjobs.com",
    "jobs.netflix.com",
    "careers.microsoft.com",
    "metacareers.com",
    "personio.com",
    "booking.com",
    "cloudflare.com",
    "snowflake.com",
    "spotify.com",
    "adobe.com",
    "affirm.com",
    "miro.com",
    "eu.bendinspoons.com",
    "jobs.ashbyhq.com",
    "boards.greenhouse.io",
    "apply.workable.com",
    "smartrecruiters.com",
  ];
  allLinks.forEach((a) => {
    try {
      const href = a.href;
      const isJobBoardLink = jobBoardDomains.some((domain) =>
        href.includes(domain)
      );
      if (isJobBoardLink) {
        const card = a.closest("[class*='card'], [class*='job'], article, li");
        const titleEl = card
          ? card.querySelector("h2, h3, [class*='title']")
          : null;
        results.push({
          title: titleEl ? titleEl.textContent.trim() : a.textContent.trim(),
          url: href,
        });
      }
    } catch (e) {}
  });

  return results;
};

// Message listener: handle scrape-urls request from eurotoptech.com
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "scrape-eurotoptech-urls") {
    chrome.scripting
      .executeScript({
        target: { tabId: sender.tab.id },
        func: scrapeEuroTopTechUrls,
      })
      .then((results) => {
        sendResponse({ success: true, data: results?.[0]?.result || [] });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true; // keep message channel open for async response
  }
});

// Intercept navigation on eurotoptech.com to capture apply URLs from modals
// When a job card is clicked, the modal opens and the Apply Now button href
// contains the real job URL – we listen for tab URL changes to capture it.
const capturedEuroTopTechUrls = new Map();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    tab.url &&
    tab.url.includes("eurotoptech.com")
  ) {
    // Inject a content script to intercept Apply Now button clicks
    chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Wait for DOM to be ready, then attach click listeners to all job cards
        const attachCardListeners = () => {
          // eurotoptech job cards: divs with role button or onClick
          // When clicked they open a modal – the modal has an Apply Now <a href>
          document.querySelectorAll(
            "[class*='JobCard'], [class*='job-card'], [class*='jobCard']"
          ).forEach((card) => {
            if (card.dataset.listenerAttached) return;
            card.dataset.listenerAttached = "true";
            card.addEventListener("click", () => {
              // Give modal time to render
              setTimeout(() => {
                const applyBtn = document.querySelector(
                  "a[href*='amazon.jobs'], " +
                  "a[href*='careers.uber'], " +
                  "a[href*='greenhouse.io'], " +
                  "a[href*='lever.co'], " +
                  "a[href*='workday'], " +
                  "a[href*='linkedin.com/jobs'], " +
                  "a[href*='personio'], " +
                  "a[href*='metacareers'], " +
                  "a[href*='careers.google'], " +
                  "a[href*='netflix.com'], " +
                  "a[href*='spotify.com/jobs'], " +
                  "a[href*='microsoft.com/jobs'], " +
                  "a[href*='smartrecruiters'], " +
                  "a[href*='ashbyhq']"
                );
                if (applyBtn) {
                  const titleEl = document.querySelector(
                    "[class*='modal'] h1, [class*='modal'] h2, [class*='dialog'] h1"
                  );
                  window.dispatchEvent(
                    new CustomEvent("eurotoptech-job-url", {
                      detail: {
                        url: applyBtn.href,
                        title: titleEl ? titleEl.textContent.trim() : "",
                      },
                    })
                  );
                }
              }, 800);
            });
          });
        };

        // Run immediately and also observe for dynamically loaded cards
        attachCardListeners();
        const observer = new MutationObserver(attachCardListeners);
        observer.observe(document.body, { childList: true, subtree: true });
      },
    });
  }
});

// Panda Icon clicked
chrome.action.onClicked.addListener((tab) => {
  console.log("Panda Extract: Action clicked", tab);
  injectPandaScripts(tab);
  // injectPageDetailsScripts(tab);
});

importScripts("bundle/service.bundle.js");
