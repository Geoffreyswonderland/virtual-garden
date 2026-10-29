# 歸園田居：虛擬園藝活動雛形

中興大學園藝學系造園組專題討論的展示雛形。以陶淵明〈歸園田居〉為故事線：使用者從城市的聲音中推開柴門走進園子，清晨除草、正午種豆澆水，傍晚扛著鋤頭在月色中走回家，最後在月下停留看露水。場景由早晨漸變到夜晚，每一段結束後浮現對應的詩句，並請使用者評一次此刻的放鬆程度。結束時顯示「療癒歷程」時間軸，並可下載完整的事件紀錄。

本雛形用來展示**過程測量**的可能性：傳統研究只在活動前後各測一次，這裡記錄的是活動進行中的變化。

> 這是展示與可行性測試用的雛形，不收集受試者資料。紀錄只存在使用者自己的裝置上，除非他按下「下載紀錄」。

## 檔案結構

```
index.html          頁面骨架與文字
css/style.css       樣式
js/garden.js        3D 場景（田園、柴門、茅屋、晨昏變化）
js/main.js          互動、聲景、流程與紀錄
js/csv.js           讀取 CSV
data/actions.csv    園藝動作、說明、詩句、理論依據
data/questions.csv  前測與後測題目
```

## 用 Excel 修改內容

場景文字、詩句和題目都放在 `data/` 的兩個 CSV 檔裡，改內容不需要動程式。

1. 用 Excel 打開 CSV，修改文字。
2. 另存新檔時選 **「CSV UTF-8（逗號分隔）」**，否則中文會變成亂碼。
3. 把檔案上傳回 GitHub 的 `data/` 資料夾，覆蓋原檔。也可以直接在 GitHub 網頁上點檔案、按鉛筆圖示編輯。

### actions.csv 欄位

| 欄位 | 說明 |
| --- | --- |
| `id` | 動作代號，英文，不可重複 |
| `order` | 出現順序 |
| `name` | 段落名稱，例如「理荒穢」 |
| `target` | 對應的互動程式，目前有 `gate`（推柴門）、`weeds`（除草）、`sow`（種豆＋澆水）、`hoe`（荷鋤走回家）、`linger`（月下停留）五種 |
| `time_of_day` | 這一段的時段：`morning`、`noon`、`dusk`、`night`，場景會漸變過去 |
| `instruction` | 畫面上方的提示文字 |
| `instruction_2` | 第二步的提示（目前只有 `sow` 用到：澆水） |
| `poem`、`poem_source`、`poem_note` | 動作完成後浮現的詩句、出處與短語 |
| `rating_prompt` | 動作後的評分題目 |
| `theory` | 這個動作的理論依據（只作紀錄，不會顯示） |

### questions.csv 欄位

| 欄位 | 說明 |
| --- | --- |
| `phase` | `pre`＝開始前，`post`＝結束後 |
| `text` | 題目 |
| `subscale` | 所屬分量表，會顯示在結果頁 |
| `min`、`max`、`min_label`、`max_label` | 滑桿範圍與兩端文字 |

目前的知覺恢復題目是依概念改寫的**示意題目**，正式研究需使用經驗證的中文版量表。

## 下載的紀錄格式

| 欄位 | 說明 |
| --- | --- |
| `t_ms` | 從開始算起的毫秒數 |
| `type` | 事件類型：`session_start`、`rating`、`action_start`、`action_complete`、`poem_shown`、`soundscape`（城市／田園／夜晚聲景切換）、`gate_open`、`weed_pulled`、`bean_sown`、`watered`、`hoe_taken`、`walk_start`、`walk_end`、`linger`（月下停留的毫秒數）、`view`（每秒記錄一次觀看方向）、`miss`（點到空白處）、`sound`、`session_end` |
| `id` | 題目或動作代號 |
| `value` | 評分、觀看方向（左右;上下，單位弧度）等 |

時間戳可以和心率帶等穿戴裝置的資料對齊。

## 在自己的電腦上開啟

瀏覽器不允許直接雙擊 `index.html` 讀取 CSV，需要透過網址開啟：

- 線上版本：開啟 GitHub Pages 後的網址。
- 本機測試：在這個資料夾執行 `python3 -m http.server`，再打開 `http://localhost:8000`。

## 技術與限制

- 3D 場景使用 [three.js](https://threejs.org/) 0.160，從 jsDelivr 載入。
- 庭園與聲音目前都是數位模擬：場景由簡單幾何體組成，城市車聲、風聲、溪聲、鳥鳴、蟲鳴由瀏覽器即時合成。正式研究會換成實地拍攝的全景照片與音量校正過的實地錄音。
- 詩句皆為公版古典作品。
