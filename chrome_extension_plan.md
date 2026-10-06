# 104 職缺 Markdown Chrome Extension 實作計畫

- 文件狀態：規劃中
- 本文件用途：定義後續 Chrome Extension 的實作範圍、架構、驗收方式與既定決策
- 本階段限制：只產生計畫，不新增或修改 Chrome Extension 實作檔案

## 1. 目標

在 Chrome 開啟 104 職缺頁面後，使用者觸發匯出功能，將頁面中的職缺資訊解析成 Markdown，直接下載到 Chrome 設定的 Downloads 目錄。

Extension 版本的解析結果應延續目前 Python parser 的資料欄位與 Markdown 格式：

- 使用 `key: value` 的 bullet list
- 不使用 Markdown table
- 陣列資料使用巢狀 bullet list
- 缺少資料時使用目前的 `未提供`
- 排除帳號資訊、追蹤資料、推薦職缺與其他無關頁面內容

## 2. 已確認需求

- 目標網站：104 職缺頁面
- 支援範圍：只支援 `104.com.tw` 職缺頁面
- 使用方式：使用者已進入職缺頁面後，手動觸發匯出
- 輸出格式：Markdown
- 輸出位置：Chrome 設定的 Downloads 目錄
- Downloads 下建立 `104/` 子目錄
- 檔名格式：`{job_id}-{company}-{title}.md`
- 不需要選擇任意本機目錄
- Parser 改寫成 JavaScript
- 不使用 Python Native Messaging
- 不在 Extension 內打包 Python、`lxml`、Pyodide 或其他大型執行環境
- 現有 `104/extract_job_to_md.py` 與 `104/test_extract_job.py` 作為欄位及行為參考

## 3. 本次不納入範圍

- 批次匯出多個職缺
- 自動監控頁面或自動下載
- 背景爬蟲與 104 API 串接
- 自動登入或處理驗證碼
- 將檔案儲存到任意絕對路徑
- Native Messaging Host
- Chrome 以外瀏覽器的相容性
- 其他網站或其他 104 頁面格式
- 通用型 HTML-to-Markdown 轉換器

## 4. 使用者流程

使用 Chrome Extension 工具列 action 直接作為「匯出 Markdown」入口，讓使用者點擊一次即可完成匯出：

```text
開啟 104 職缺頁面
  -> 點擊 Extension 工具列圖示
  -> 取得目前分頁內容
  -> JavaScript parser 解析職缺資料
  -> Markdown renderer 產生文字
  -> chrome.downloads API 下載 .md
```

如果後續需要在 Popup 中提供按鈕，仍可沿用同一套 parser 與下載流程，但操作會變成「開啟 Popup 後再點擊按鈕」。這是操作介面的選擇，不應影響核心解析模組。

### 4.1 操作入口的複雜度與權限差異

#### 方案 A：工具列圖示直接匯出

- `manifest.json` 不設定 `default_popup`
- 使用 `chrome.action.onClicked` 接收工具列圖示點擊
- Service worker 直接啟動頁面解析與下載流程
- 檔案較少，操作步驟最短，最符合目前「點擊後直接產生 Markdown」的需求
- 若 Extension 沒有固定在工具列，使用者仍需先從 Extensions 選單找到它；要達到真正一鍵，使用者需先將圖示 Pin 到工具列
- 缺點是沒有自然的預覽、欄位選擇或下載前確認畫面

#### 方案 B：開啟 Popup 後按「匯出」

- `manifest.json` 設定 `action.default_popup`，增加 `popup.html` 與 Popup JavaScript
- 使用者點擊工具列圖示後，再點 Popup 內的「匯出」按鈕
- 可顯示目前職缺標題、匯出狀態、錯誤訊息或未來的設定選項
- 需要多一個 UI 與 Popup 到 service worker 的訊息傳遞流程，實作及測試複雜度略高
- Popup 關閉後不應中斷長時間工作，因此解析與下載仍應由 service worker 負責

兩種方案目前都使用相同的：

- `activeTab`
- `scripting`
- `downloads`

Popup 本身不會額外需要檔案系統權限、`nativeMessaging` 或 `host_permissions`。只有未來要保存使用者設定時，才另行評估 `storage` permission；目前需求不需要。

Chrome 的 action 若設定了 Popup，`chrome.action.onClicked` 不會觸發，因此兩種入口是互斥的設定，不能同時依賴同一個 action click 事件。[Chrome action API](https://developer.chrome.com/docs/extensions/reference/api/action)

目前已決定採用方案 A：工具列圖示直接匯出。若未來需要預覽、欄位選擇或設定，再另行評估方案 B；本次不納入 Popup。

## 5. 技術架構

採用 Manifest V3，盡量只使用瀏覽器原生 API，不引入第三方套件。

### 5.1 建議檔案結構

預計新增以下 Extension 專用目錄；實作時再建立，不在本階段建立：

```text
104/
  chrome-extension/
    manifest.json
    service-worker.js
    parser.js
    markdown.js
    README.md
```

各檔案責任：

- `manifest.json`
  - 宣告 Manifest V3
  - 設定 Extension 名稱、版本與工具列 action
  - 宣告必要 permissions
- `service-worker.js`
  - 接收 action click
  - 透過 `chrome.scripting.executeScript` 在目前分頁執行 `parser.js`
  - 接收 parser 回傳的職缺資料
  - 呼叫 Markdown renderer
  - 呼叫 `chrome.downloads.download` 寫入 Downloads
  - 將成功或失敗結果回報給使用者
- `parser.js`
  - 由 `scripting` 注入目前分頁，在能存取頁面 DOM 的內容腳本環境執行
  - 使用 `DOMParser`、`querySelector`、`querySelectorAll` 與 `JSON.parse`
  - 將 104 頁面轉成與 Python parser 相同概念的資料結構
- `markdown.js`
  - 將資料結構輸出成目前約定的 Markdown
  - 負責 key/value bullet、巢狀清單、換行與 Markdown 特殊字元處理
- `README.md`
  - 說明 Chrome 的 Load unpacked 安裝方式
  - 說明權限用途與測試方式

### 5.2 Chrome permissions

預計只使用：

- `activeTab`
  - 使用者點擊 Extension 後，取得目前分頁的暫時存取權
- `scripting`
  - 在目前分頁執行讀取 DOM 的腳本
- `downloads`
  - 將產生的 Markdown 下載到 Downloads

若使用 `activeTab`，原則上不需要對所有網站宣告廣泛的 `host_permissions`。Extension 只應在使用者主動觸發匯出時讀取目前頁面。

## 6. Parser 移植計畫

### 6.1 資料來源優先順序

沿用目前 Python parser 的策略：

1. 優先讀取 `script[type="application/ld+json"]` 中 `@type` 為 `JobPosting` 的資料。
2. JSON-LD 沒有提供的欄位，再從 104 頁面 DOM 的固定 class 與 list row 讀取。
3. 同一欄位同時存在時，維持目前 parser 的優先順序，避免移植後產生不必要的格式差異。

### 6.2 JSON-LD 欄位

預計移植以下資料來源：

- `title`
- `identifier`
- `url`
- `datePosted`
- `validThrough`
- `hiringOrganization.name`
- `hiringOrganization.sameAs`
- `industry`
- `baseSalary`
- `employmentType`
- `jobLocation.address`
- `experienceRequirements`
- `educationRequirements`
- `workHours`

### 6.3 DOM 欄位

預計沿用目前 Python parser 使用的頁面結構：

- `.job-description`
- `.job-description__content`
- `.job-requirement`
- `.benefits`
- `.benefits-labels`
- `.benefits-description`
- `.job-address`
- `.job-contact-table`
- `.job-header`
- `.list-row`
- `.list-row__head`
- `.list-row__data`

需保留目前的文字清理行為：

- 去除多餘空白與不必要的換行
- 將 `<br>` 視為換行
- 解碼 HTML entity
- 將福利標籤轉成陣列
- 對 Markdown 特殊字元進行必要處理

### 6.4 不應解析的資料

Parser 只處理職缺本身與明確相關的公司、福利、聯絡及應徵資料，不解析：

- 使用者帳號、Email 或會員資料
- Google Analytics、dataLayer、追蹤參數
- 推薦職缺與其他職缺清單
- 頁面導覽列、頁尾與廣告
- 瀏覽器或其他 Extension 注入的內容

## 7. Markdown 輸出契約

Extension 版本預計保留以下區段：

- `基本資料`
- `工作內容`
- `條件要求`
- `福利制度`
- `聯絡與應徵`
- `來源資訊`

輸出範例形式：

```markdown
## 基本資料

- 公司名稱: 華碩電腦股份有限公司
- 薪資: 待遇面議
- 工作地點: 台北市北投區

## 福利制度

- 法定項目:
  - 勞保
  - 健保
```

### Extension 與本機 HTML parser 的差異

Python CLI 讀取本機 HTML 檔案，因此可以輸出 `原始檔案`，例如 `104/jd_sample_1.html`。Extension 解析的是使用者目前開啟的瀏覽器分頁，沒有可供輸出的本機 HTML 檔案路徑。

已決定 Extension 版本：

- 移除 Markdown 中的 `原始檔案` 這個輸出欄位
- 保留 `來源網址`，填入目前分頁的職缺 URL
- 不刪除 `jd_sample_1.html`，也不修改 Python CLI 的既有輸出；這只代表 Extension Markdown 不輸出不適用的欄位

## 8. 下載策略

使用 `chrome.downloads.download`：

- `saveAs: false`，不顯示另存新檔視窗
- `filename` 使用 `104/{job_id}-{safe_company}-{safe_title}.md`
- `conflictAction: "uniquify"`，避免覆蓋既有職缺檔案
- 下載內容為 Markdown 文字

檔名處理規則：

- `job_id` 取自職缺資料
- `company` 取自公司名稱
- `title` 取自職缺標題
- 將公司名稱與標題中的路徑分隔符、作業系統不允許字元與控制字元替換或移除，形成 `safe_company` 與 `safe_title`
- 保留可辨識的公司名稱與職缺標題，不將名稱任意改成 hash 或流水號
- `104/` 是 Downloads 目錄下的相對子目錄，不是絕對路徑

上述下載不需要額外的檔案系統權限；`downloads` permission 已涵蓋透過 Chrome Downloads API 建立下載檔案。Chrome 實際使用的根目錄會依使用者的 Chrome Downloads 設定而定，不假設固定作業系統路徑。

## 9. 錯誤與可達流程

以下情境屬於正常使用流程中可達，應納入實作及測試：

- 目前分頁不是可解析的 104 職缺頁面
  - 顯示「找不到職缺標題或 JobPosting 資料」
  - 不產生錯誤 Markdown 檔案
- 頁面只有部分欄位
  - 保留輸出
  - 缺少欄位顯示 `未提供`
- Chrome 下載 API 失敗
  - 顯示下載失敗原因
  - 不進行自動重試
- 使用者未授權或 Extension 被重新載入
  - 顯示可操作的錯誤訊息

本階段不加入批次重試、背景監控、頁面自動等待或其他未確認的防禦行為。

## 10. 測試計畫

### 10.1 Parser 單元測試

以現有 `104/jd_sample_1.html` 作為第一個固定 fixture，驗證：

- 職缺標題
- 公司名稱
- 工作地點
- 薪資
- 福利標籤
- 應徵網址
- JSON-LD 與 DOM fallback 的欄位結果
- Markdown 不含 table 語法
- Markdown 不含帳號 Email、追蹤資料與推薦職缺

### 10.2 Extension 整合測試

在 Chrome 載入 unpacked Extension 後驗證：

1. 開啟樣本或實際 104 職缺頁面。
2. 點擊工具列匯出 action。
3. 產生一個 `.md` 檔案。
4. 檔案出現在 Chrome Downloads 目錄。
5. 內容與 parser 單元測試結果一致。
6. 重複下載不覆蓋既有檔案。

### 10.3 回歸驗證

Extension 的 parser 輸出應與現有 Python parser 保持語意一致。若因 `原始檔案` 欄位不適用而有差異，差異必須在輸出契約中明確記錄。

## 11. 效能與封裝大小

- 使用瀏覽器原生 DOM API，避免引入通用 HTML parser 或 HTML-to-Markdown 套件。
- 樣本 HTML 約 1 MB 是執行時輸入，不應打包進 Extension。
- 不打包 Python runtime、`lxml`、Pyodide 或大型 WASM。
- 不透過遠端載入 Extension 執行程式碼，所有必要程式碼隨 Extension 一起封裝。
- 實作完成後檢查封裝內容，確認沒有測試 HTML、暫存檔或不必要依賴。

Chrome Web Store 的套件大小上限遠高於本專案預期；本專案真正需要控制的是依賴與執行環境，而不是單純的封裝上限。

## 12. 實作階段

### Phase 1：建立既定輸出契約

- 固定輸出至 Downloads 下的 `104/` 子目錄
- 固定檔名格式為 `{job_id}-{company}-{title}.md`
- 固定 Extension 使用工具列 action 直接匯出，不建立 Popup
- 固定 Extension 移除 `原始檔案`，只保留 `來源網址`

### Phase 2：移植純解析邏輯

- 將 Python parser 的清理、JSON-LD、DOM、福利與聯絡人邏輯移植成 JavaScript
- 以樣本 HTML 驗證欄位結果
- 保持輸出資料結構與 Python parser 對齊

### Phase 3：建立 Extension 流程

- 建立 Manifest V3 設定
- 實作 action click
- 取得目前分頁 DOM
- 串接 parser 與 Markdown renderer
- 串接 Downloads API

### Phase 4：驗收與文件

- 執行 parser 單元測試
- 執行 Chrome 手動整合測試
- 驗證權限最小化與下載檔名
- 撰寫 Extension 安裝及使用說明

## 13. 驗收條件

完成後需符合：

- 使用者在 104 職缺頁面點擊一次即可開始匯出
- 僅接受 `104.com.tw` 職缺頁面
- 產生 Markdown 並下載至 Chrome Downloads 目錄
- 不需要安裝 Python 或 Native Messaging Host
- 輸出使用 key/value bullet list，不使用 table
- 主要欄位與目前 Python parser 語意一致
- 缺少欄位不會使整個匯出失敗，依既有契約輸出 `未提供`
- 不輸出帳號、Email、追蹤資料與推薦職缺
- 重複下載不會覆蓋既有檔案
- Extension 封裝不包含樣本 HTML 或大型執行環境

## 14. 參考文件

- [Chrome Extensions 開發文件](https://developer.chrome.com/docs/extensions/develop?hl=en)
- [使用 activeTab 與 scripting 讀取目前頁面](https://developer.chrome.com/docs/extensions/get-started/tutorial/scripts-activetab)
- [chrome.downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads?hl=en)
- [Chrome Native Messaging（本計畫不採用，僅作為替代方案參考）](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Chrome Web Store 發佈與套件大小](https://developer.chrome.com/docs/webstore/publish/)
