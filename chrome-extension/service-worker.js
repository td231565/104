importScripts("markdown.js");

function getErrorMessage(error) {
  return error && error.message ? error.message : String(error || "未知錯誤");
}

function getSupportedPageType(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== "104.com.tw" && hostname !== "www.104.com.tw") {
      return null;
    }
    if (/^\/job\/[^/]+\/?$/.test(url.pathname)) {
      return "job";
    }
    if (/^\/jobs\/search\/?$/i.test(url.pathname)) {
      return "search";
    }
    return null;
  } catch {
    return null;
  }
}

async function setActionStatus(tabId, success, message) {
  const badgeText = success ? "✓" : "!";
  const badgeColor = success ? "#188038" : "#d93025";
  await Promise.allSettled([
    chrome.action.setBadgeText({ tabId, text: badgeText }),
    chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColor }),
    chrome.action.setTitle({ tabId, title: message }),
  ]);
}

function showPageToast(message, success) {
  const id = "__104_markdown_export_status";
  const oldToast = document.getElementById(id);
  oldToast?.remove();

  const toast = document.createElement("div");
  toast.id = id;
  toast.textContent = message;
  toast.style.cssText = [
    "position:fixed",
    "z-index:2147483647",
    "top:16px",
    "right:16px",
    "max-width:420px",
    "padding:12px 16px",
    "border-radius:8px",
    "font:14px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
    "color:#fff",
    `background:${success ? "#188038" : "#d93025"}`,
    "box-shadow:0 2px 12px rgba(0,0,0,.25)",
  ].join(";");
  (document.body || document.documentElement).append(toast);
  setTimeout(() => toast.remove(), 5000);
}

async function report(tabId, success, message) {
  await setActionStatus(tabId, success, message);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: showPageToast,
      args: [message, success],
    });
  } catch {
    // chrome:// pages and restricted frames cannot display the in-page status.
  }
}

async function exportCurrentTab(tab) {
  if (!tab.id) {
    return;
  }

  const pageType = getSupportedPageType(tab.url);
  if (!pageType) {
    await report(tab.id, false, "請先開啟 104.com.tw 的職缺頁面或搜尋列表頁");
    return;
  }

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["parser.js"],
    });
    const record = injection?.result;
    if (!record || record.__error) {
      throw new Error(record?.__error || "找不到職缺資料或頁面結構不符");
    }

    let markdown;
    let filename;
    let messagePrefix;

    if (record.type === "search") {
      if (!record.jobs || record.jobs.length === 0) {
        throw new Error("搜尋列表未找到任何職缺");
      }
      markdown = render104ListMarkdown(record);
      filename = get104ListDownloadFilename(record);
      messagePrefix = `已匯出列表（共 ${record.jobs.length} 筆）：${filename}`;
    } else {
      markdown = render104Markdown(record);
      filename = get104DownloadFilename(record);
      messagePrefix = `已匯出：${filename}`;
    }

    const downloadId = await chrome.downloads.download({
      url: `data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`,
      filename,
      saveAs: false,
      conflictAction: "uniquify",
    });

    await report(tab.id, true, `${messagePrefix}（下載編號 ${downloadId}）`);
  } catch (error) {
    await report(tab.id, false, `匯出失敗：${getErrorMessage(error)}`);
  }
}

chrome.action.onClicked.addListener((tab) => {
  void exportCurrentTab(tab);
});
