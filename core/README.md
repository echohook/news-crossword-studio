# 時事填字樂 V1.0 — Core Prototype

> 目前版本為 **1.7.2**：新增一次產出 1～7 份題目，逐份驗證、各份答案及題目完全不重複，168 項測試通過。用法見 [EDITIONS.md](EDITIONS.md)，驗收見 [EDITIONS_ACCEPTANCE.md](EDITIONS_ACCEPTANCE.md)。時事與成語混合模式預設時事 8 題、成語 4 題。完整規格、資料格式及限制見 [NEWS_PIPELINE.md](NEWS_PIPELINE.md)。直接執行 `node cli.mjs pipeline examples/news-input.json` 或 `node cli.mjs batch examples/news-batch.json`。
> 下方 v1.0.1 更新段落為前一版紀錄；另已新增真實新聞快照驗收，來源與限制見 [REAL_NEWS.md](REAL_NEWS.md)。合成案例繼續保留供離線測試。
可直接閱讀 [文字作答版](reports/news-real-player.txt)、[答案版](reports/news-real-answers.txt)；操作見 [WORKSHEET.md](WORKSHEET.md)，品質評分見 [QUALITY.md](QUALITY.md)。

選題範圍見 [NEWS_SCOPE.md](NEWS_SCOPE.md)；選題取捨與可重跑案例見 [SELECTION.md](SELECTION.md)。本期為固定新聞快照，8×8、12 題、2／3／4 字分布 3／5／4，V01～V08 全 PASS。

已實作資料輸入、Solver、獨立 Validator、文字 CLI 與混合題型。核心為零第三方套件的 Node.js 程式；A4 PDF 試印檔另行提供。

成語模式與來源見 [MIXED.md](MIXED.md)。混合版目前為 9×9、12 題、4／3／5 字數分布；成語與時事共同交叉。

## 快速開始

需要 Node.js 20 以上。本次使用 Node.js 24.19.0 驗證。
在本資料夾開啟終端機後執行：

```powershell
node cli.mjs solve examples/candidates.json
node cli.mjs validate examples/solved.json
node cli.mjs validate examples/historic-valid.json
node cli.mjs validate examples/invalid-zhi-che.json
npm test
```

最後一個 validate 指令**應該失敗**，並列出 V04 的「UNEXPECTED ENTRY: 智撤」及 INVALID。

指定搜尋設定與儲存盤面：

```powershell
node cli.mjs solve examples/candidates.json --target 12 --min 8 --attempts 48 --seed 1 --out my-puzzle.json
```

不用 npm install。CLI 中文輸出為 UTF-8；輸入可有 UTF-8 BOM。
Windows 若開啟受控資料夾存取，寫入檔案的 Node.js 需獲准寫入所選目錄；唯讀排盤／驗證不受此檔案寫入限制。

## 交付內容

- model.mjs：候選資料檢查與字數平衡評分。
- solver.mjs：增量配置及有界、可重現的多次搜尋。
- validator.mjs：不匯入 Solver；直接掃描最終盤面的獨立驗證器。
- cli.mjs：solve / validate，顯示盤面、橫直詞、起訖位置、交叉數、V01～V08。
- interfaces.mjs：新聞蒐集、候選生成、題目生成及 Renderer 的介面契約；提供渲染前重新驗證的實際入口。
- examples/candidates.json：28 筆候選、中繼資料及範例題目。
- examples/solved.json：自動搜尋的 8×8、12 題、4／4／4 盤面。
- examples/historic-valid.json：先前黃金／金牌等 12 題成功案例的固定座標回歸測試。
- examples/invalid-zhi-che.json：人工智慧／無人機合法交叉下方加入「撤」，產生額外直詞「智撤」。
- reports/：成功盤、歷史盤、失敗盤的 CLI 輸出與測試結果。

原始合成範例詞彙只供邏輯測試；來源狀態標示 fixture，**不宣稱已查證為本週新聞**。真實新聞資料請見 examples/news-real-20261001.json 及 REAL_NEWS.md。本版未實作新聞查核、題目唯一性或新聞新鮮度評估。

## 輸入與輸出契約

輸入是候選陣列，或含 candidates 陣列的 JSON 物件：

```json
{
  "candidates": [
    {
      "id": "c001",
      "word": "台積電",
      "event_id": "event001",
      "clue": "台灣晶圓代工企業的常用簡稱。（3字）",
      "difficulty": "easy",
      "answer_score": 90,
      "source_support": [],
      "event": {"fact_status": "fixture"}
    }
  ]
}
```

id、word、event_id 必填。id 與 word 不可重複；word 必須為 2～4 個漢字 Unicode 字元，不接受英數、空格、標點。clue 及其他欄位可省略，所有候選中繼資料原樣保留。娛樂新聞依明示中繼資料在 Solver／分析／新聞管線中排除，詳見 NEWS_SCOPE.md。其他內容品質由上游篩選，Solver 不用交叉便利性替不合格內容加分。

盤面 JSON 包含：
- schema_version: "1.0"
- board: 正方形二維陣列，每格是一個中文字或 "■"
- expected: **已選為正式答案**的完整候選資料
- placements: candidate_id、direction（H/V）、row、col

JSON 使用 **0 起算**座標；CLI 顯示 **1 起算**。起點加上答案長度即可算終點。交叉位置由 Validator 重新計算於 validation.intersections，絕不信任外部聲稱的交叉數。

未選候選在 Solver 結果的 unselected 中列出；它們不是「正式答案遺漏」。若正式答案在 expected 中但沒排入或盤上不完整，V02 會 FAIL。validate 只驗證輸入檔案，不會修盤。

## Solver 的規則及限制

預設 target=12、minEntries=8、最多 target=14；為了小型單元測試，API/CLI 可明確設定最低 2 題。每個事件最多選 2 題，Anchor Event 的例外尚未啟用。

每個尺寸依序嘗試 8、9、10。小盤只要找到目標題數，就在該尺寸內比較字數平衡，完成後不再放大。若小盤僅有合法但不足目標的方案，會繼續嘗試大盤；最終仍未達標時，可返回不少於 minEntries 的最佳盤，明確標為 PARTIAL。候選結果比較順序是題數、較小尺寸、50% 原則、字數平均程度。

每次配置前檢查：
1. 答案不能越界，起點前／終點後不可有字。
2. 重疊格必須同字且為不同方向，禁止同向重疊。
3. 新填字格的兩側不可貼到別的字。
4. 新詞必須交叉既有詞，或與另一新詞構成合法交叉組後一起加入。
5. 完成候選盤必須再由 Validator 通過。

沿用先前成功案例的概念，**可有多個互不相連的交叉組**；每題都有交叉，但不要求所有題目連成同一連通分量。

字數平衡以 2／3／4 字各約三分之一為目標。評分 penalty = Σ|3 × 該字數題數 − 總題數|，越低越平均；12 題的理想值是 4／4／4。超過 50% 會警告並降低方案優先序，但不是 V01～V08 的硬失敗。歷史盤有 10 題兩字詞，仍可作幾何 VALID 的回歸案例，同時明確標示字數警告。

這是有搜尋預算的啟發式原型；固定候選、設定、seed 可重現，**不保證全域最佳，也不保證找出所有存在的解**。預設每尺寸最多 48 次嘗試。SEARCH_EXHAUSTED 只代表預算內未找到合格盤，不是「證明無解」。可增加 attempts 或改善候選池。

## 獨立 Validator

Validator 只依賴資料模型，不呼叫 Solver 的 canPlace 或配置邏輯。先從最終 board 掃描所有橫向／直向**最長連續、至少兩字**的字串，再比較方向、起點、全文與次數。連續四字詞不會拆成多個二字子詞。

| 檢查 | 內容 |
|---|---|
| V01 | 每一已宣告配置在指定位置形成完整、最大連續字串 |
| V02 | 每個正式答案恰好宣告一次，且確實完整出現在盤上 |
| V03 | 掃描所得橫詞沒有多餘項目，包含同詞在其他位置重複 |
| V04 | 掃描所得直詞沒有多餘項目，包含「智撤」類假詞 |
| V05 | 宣告字元、盤面字元無衝突，且無同方向重疊 |
| V06 | 每個答案內沒有阻隔格、缺格或越界 |
| V07 | 每題至少一個由完整有效橫直答案構成的交叉 |
| V08 | 交叉兩邊宣告的字與盤面完全一致 |

此外，盤面尺寸／格子型別、孤立多餘字格、事件上限等結構檢查也必須通過。即使 V01～V08 全 PASS，結構錯誤仍判 INVALID。空盤不能通過。字數平衡另行報告，不會偽裝成硬性幾何失敗。

CLI 結束代碼：
- 0：SOLVED 或驗證 VALID
- 1：驗證 INVALID
- 2：輸入錯誤，或搜尋未找到達最低題數的合法盤
- 3：PARTIAL；盤面合法但未達題數目標

## 擴充方式

```javascript
import {solve} from './solver.mjs';
import {validatePuzzle} from './validator.mjs';
import {renderValidated} from './interfaces.mjs';

const result = solve(eligibleCandidates, {target:12, minEntries:8, seed:1});
if (result.status === 'SOLVED') {
  const report = validatePuzzle(result.puzzle);
  // 日後接入完成的 A4/PDF renderer：
  // await renderValidated(result.puzzle, renderer);
}
```

renderValidated 會先複製並再次檢查盤面，INVALID 不會呼叫 renderer。未來正式出版仍須另行通過新聞真實性、時效、題目唯一性與內容品質檢查；本版 GRID VALID 只證明本版的字盤規則。裝飾與 PDF 只能讀取已驗證的 board，不能修改字格、座標或阻隔格。

## 測試範圍

固定成功盤、人工智慧／無人機、橫／直「智撤」、漏題、斷字、越界、字元衝突、交叉不一致、無交叉、同向重疊、重複字串、孤立字格、格式錯誤、非漢字、字數限制、50% 軟性目標、事件上限、同 seed 重現、8→9 真實回退、9／10 字盤、搜尋失敗、PARTIAL、Renderer gate 及 CLI 結束代碼。

另包含 20 個 seed 的 Solver 結果獨立驗證，以及歷史盤 64 個逐格變異全數被攔截。測試只是已執行案例的證據，不宣稱涵蓋所有可能輸入。

## Core Prototype v1.0.1 更新

本次維持 V1.0 字盤規則與 schema_version=1.0，補強可重複使用的 CLI 與診斷。50 項自動測試通過，六個批次案例符合預期。

### 候選分析

```powershell
node cli.mjs analyze examples/candidates.json
node cli.mjs analyze examples/candidates.json --json
```

analysis.mjs 從共同中文字建立交叉圖，回報各字數候選數、可交叉候選數、無共同字候選、交叉群組，以及每事件最多兩題後的保守題數上限。交叉群組可以分離，不要求整盤連通。

這些是「必要條件」：例如上限小於最低題數可確定該候選池不足；反過來，上限夠大仍不保證能在格子內排出盤面。字數不足提示也不會降低 Validator 的硬性合法門檻。

solve 的完整 API 結果新增 analysis 與 exclusions。未選候選的 reason 分為：
- NO_SHARED_CHARACTER：候選池內沒有可用共同字。
- EVENT_LIMIT：此方案已達該事件兩題上限。
- NOT_SELECTED_WITHIN_BUDGET：本次方案未選入，不代表一定排不進。

diagnostics.bestCount 會列出本次尺寸最多配置了幾題，即使未達 minEntries 也不會一律顯示 0；meetsMinimum 表示是否找到達最低題數且驗證合法的方案。seed 限定為 0～4294967295 的整數。

### 批次執行

```powershell
node cli.mjs batch examples/batch.json
node cli.mjs batch examples/batch.json --json
node cli.mjs batch examples/batch.json --out batch-report.json
```

batch.mjs 提供 runBatch(manifest, {baseDir})。每案可讀取獨立輸入檔，或使用內嵌 data；同一案例不能同時指定 input、data。相對路徑以批次檔所在資料夾為起點。

```json
{
  "cases": [
    {
      "id": "weekly-pool",
      "operation": "solve",
      "input": "candidates.json",
      "options": {"target": 12, "minEntries": 8, "attempts": 48, "seed": 1},
      "expect": {"status": "SOLVED", "valid": true, "size": 8, "entryCount": 12}
    },
    {
      "id": "reject-extra-word",
      "operation": "validate",
      "input": "invalid-zhi-che.json",
      "expect": {"status": "INVALID", "valid": false}
    }
  ]
}
```

operation 為 solve 或 validate。expect 可指定 status、valid、size、entryCount、lengthCounts；若指定 lengthCounts，需包含 2、3、4 的完整非負整數分布。省略 expect 時，solve 要達 SOLVED、validate 要達 VALID 才算批次案例成功。

預期 INVALID 被正確攔截時，該回歸案例會 PASS，但字盤本身仍是 INVALID。每個案例的輸入錯誤、讀檔錯誤以 INPUT_ERROR 留在報告中，不會中斷後續案例；批次檔本身格式錯誤或重複 id 則直接拒絕。

批次報告包含完整案例結果、V01～V08、盤面、搜尋診斷與候選分析，可供未來新聞管線使用。批次全部符合預期時 CLI 回傳 0；有不符合預期的案例回傳 1；批次檔／CLI 輸入錯誤回傳 2。

### JSON 與輸入邊界

solve、validate、analyze、batch 都支援 --json，使標準輸出只有 JSON，便於其他程式接入。solve --out 仍只儲存可獨立驗證的盤面；validate / analyze / batch --out 則儲存對應完整報告。

已修復：
- CLI 接到空配置項目，現在輸出 INVALID 並回傳 1，避免讀取方向時中斷。
- 稀疏盤面陣列、缺少字格、空配置及不安全座標，均拒絕或驗證失敗。
- 特殊候選 id（例如 __proto__、constructor）的交叉資料可完整 JSON 匯出。
- 正式答案超過 14 題、未知資料版本，Validator 會拒絕。
- CLI 選項重複、缺少值或使用於錯誤指令時，明確報告輸入錯誤。

### 執行完整測試

```powershell
npm test
```

或：

```powershell
npm test
```

reports/tests.txt 保存 50 項測試的實際輸出；reports/batch.txt、reports/batch.json 保存六案批次的文字與 JSON 報告；reports/analysis.json 保存候選圖分析。