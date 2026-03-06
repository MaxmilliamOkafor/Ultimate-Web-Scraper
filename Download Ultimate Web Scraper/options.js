document
  .getElementById("request-permissions-button")
  .addEventListener("click", () => {
    console.log("[PERMISSIONS] Requesting permissions");
    chrome.permissions.request(
      {
        permissions: [],
        origins: ["<all_urls>"],
      },
      (granted) => {
        console.log("[PERMISSIONS] Permissions granted:", granted);

        if (chrome.runtime.lastError) {
          console.error(
            "[PERMISSIONS] Error requesting permissions:",
            chrome.runtime.lastError
          );
        }

        if (granted) {
          window.close();
          console.log("[PERMISSIONS] Permissions granted");
        } else {
          console.warn("[PERMISSIONS] Permissions not granted");
        }
      }
    );
  });
