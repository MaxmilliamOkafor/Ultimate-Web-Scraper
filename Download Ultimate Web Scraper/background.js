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

// Panda Icon clicked
chrome.action.onClicked.addListener((tab) => {
  console.log("Panda Extract: Action clicked", tab);
  injectPandaScripts(tab);
  // injectPageDetailsScripts(tab);
});

importScripts("bundle/service.bundle.js");
