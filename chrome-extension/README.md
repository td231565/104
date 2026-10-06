# 104 職缺匯出 Markdown

這是一個支援 104 職缺頁面的 Manifest V3 Chrome Extension：
- 職缺詳細頁 (`104.com.tw/job/...`)：匯出單篇職缺完整內容。
- 搜尋列表頁 (`104.com.tw/jobs/search/...`)：匯出當前頁面所有職缺彙總清單。

點擊工具列上的 Extension 圖示後，會將頁面解析成 Markdown，下載到 Chrome 設定的 Downloads 目錄下的 `104/` 子目錄。

## 安裝

1. 開啟 Chrome 的 `chrome://extensions/`。
2. 開啟右上角的「開發人員模式」。
3. 選擇「載入未封裝項目」並選取本目錄：`104/chrome-extension/`。
4. 將 Extension 固定到工具列，方便一鍵匯出。

## 使用

### 1. 單一職缺匯出
1. 開啟 `https://www.104.com.tw/job/<job-id>` 職缺頁面。
2. 等待頁面載入完成後，點擊工具列圖示。
3. 檔案會以 `104/<job-id>-<公司名稱>-<職缺標題>.md` 儲存。

### 2. 搜尋列表匯出
1. 開啟 `https://www.104.com.tw/jobs/search/...` 搜尋列表頁面。
2. 等待頁面載入完成後，點擊工具列圖示。
3. 檔案會以 `104/search-<關鍵字>-p<頁碼>.md` 儲存，內含該頁所有職缺的摘要彙總。

同名檔案會由 Chrome 自動加上編號，不覆蓋舊檔。
成功或失敗狀態會顯示在頁面右上角，也會保留在工具列圖示的 badge 與提示文字。

## 權限

- `activeTab`：只有使用者點擊工具列圖示時，暫時讀取目前分頁。
- `scripting`：在目前分頁執行職缺 DOM parser，以及顯示結果提示。
- `downloads`：將 Markdown 寫入 Chrome 設定的 Downloads 目錄。

Extension 沒有 `host_permissions`、`nativeMessaging`、Popup 或第三方套件，也不會讀取帳號資訊、追蹤資料或推薦職缺。

## 測試

在 `104/` 目錄執行既有 Python parser 回歸測試：

```bash
python3 -m unittest -v
```

瀏覽器 parser 測試頁位於 `104/test_chrome_extension.html`，不包含在 Extension 目錄內；可用 Chrome 開啟後查看測試結果。

Chrome 整合測試需在 `chrome://extensions/` 載入本 Extension，開啟樣本或實際 104 職缺頁面，點擊工具列圖示並確認 Downloads/104/ 下的 Markdown 內容。
