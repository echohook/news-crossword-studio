# 本機新聞資料管線 v1.5.0

這一階段把「事件快照 → 事件資格檢查與去重 → 候選組裝 → 題目機械檢查 → Solver → 獨立 Validator」接起來。原本 2～4 字、8／9／10 字盤、每題至少一交叉、事件最多兩題等規則保持一致。

目前有 146 項可重複測試通過。原始示範資料是合成資料；另外保留人工核對的真實新聞快照，見 REAL_NEWS.md。重點新聞選題與涵蓋率診斷見 SELECTION.md。娛樂新聞排除規則及 E06／A05 見 NEWS_SCOPE.md。

## 執行

在 core-prototype 資料夾：

```powershell
node cli.mjs pipeline examples/news-input.json
node cli.mjs pipeline examples/news-input.json --json
node cli.mjs pipeline examples/news-input.json --out pipeline-report.json
node cli.mjs batch examples/news-batch.json
npm test
```

pipeline --out 儲存完整管線報告，包括可獨立驗證的 puzzle。examples/news-puzzle.json 是示範管線輸出的獨立盤面：

```powershell
node cli.mjs validate examples/news-puzzle.json
node cli.mjs pipeline examples/news-rejected.json
```

第二個指令會排除洩漏答案與字數提示錯誤的候選，回傳 NO_ELIGIBLE_CANDIDATES／結束代碼 4。

## 資料範例

以下只示範兩題邏輯資料；使用 --target 2 --min 2 執行：

```json
{
  "issue_date": "2026-10-01",
  "dataset_mode": "fixture",
  "events": [{
    "event_id": "tech-001",
    "event_date": "2026-09-30",
    "title": "合成技術事件",
    "summary": "測試字詞與來源摘錄關聯。",
    "categories": ["科技"],
    "fact_status": "confirmed",
    "event_score": 90,
    "sources": [{
      "source_id": "s001",
      "publisher": "合成測試資料",
      "kind": "fixture",
      "url": "https://example.invalid/fixture/tech",
      "published_at": "2026-09-30",
      "excerpt": "合成資料包含人工智慧與無人機兩個詞。"
    }],
    "keywords": [
      {"word": "人工智慧", "answer_score": 90, "clue_draft": "讓電腦模擬人類智慧的技術領域。"},
      {"word": "無人機", "answer_score": 90, "clue_draft": "不需機上駕駛操作的飛行器。"}
    ]
  }]
}
```

issue_date 是使用者指定的本期日期，必須為有效 YYYY-MM-DD。本期區間是當天加之前六天，首尾均包含；運算使用 UTC 日期日數，避免執行主機時區改變結果。10 月 1 日這一期即為 9 月 25 日～10 月 1 日。

dataset_mode 可為 news 或 fixture，省略時為 news。來源 kind 可為 official、newswire、newsroom；fixture 僅在合成資料模式允許。來源日期 published_at 也使用 YYYY-MM-DD，且需在本期七日內。程式會檢查網址格式、摘錄與資料關聯；不會因為寫了 publisher 或 kind 就宣稱來源已驗證。

## 事件去重與版本

- event_id 必須唯一；同一事件的不同報導／版本使用不同 id 與相同 dedup_key。
- 沒有 dedup_key 時以 event_id 分組；不依標題做語意猜測。
- 同組以 updated_at（若省略則用 event_date）較新者作為目前版本，同日期以 id 排序維持重現性。
- canonical event_id 使用同組 id 的穩定字典序；aliases 保留所有原始 id，候選可引用原始 id。
- 合併來源時，同 source_id 若網址、摘錄、日期、發布者或類型衝突，整件事件拒絕；不可靜默覆蓋來源。
- content_revision 保存真正選中的版本 id。
- 重大更新可設定 supersedes_candidates=true。候選須帶最新 event_revision；舊版候選拒絕並要求重產。沒有明確重大更新資訊時，仍列為輸出前新鮮度複核，不能自動判定沒有否認或更正。

## E01～E06 事件資格

| 檢查 | 規則 |
|---|---|
| E01 | 事件日期在本期七日內，更新日期有效、不得早於事件或晚於本期 |
| E02 | 至少一筆本期合格結構來源，且 source_id 沒有衝突 |
| E03 | fact_status 是 confirmed／announced／planned／considering／reported；排除 opinion、rumor、advertorial 類內容 |
| E04 | Event Score ≥ 60 |
| E05 | 有 title、summary、非空 categories |

不合格事件仍保留各項失敗原因於 event_reports。invalid 額外來源會排除並記錄數量；只要尚有一筆合格結構來源且無 id 衝突，不必強制兩來源。

評分可直接填 event_score，或提供完整 score_components；兩者皆填時總和必須一致。分項上限：

| key | 上限 |
|---|---:|
| public_impact | 25 |
| taiwan_or_global | 20 |
| visibility | 15 |
| senior_recognition | 15 |
| weekly_value | 15 |
| diversity | 10 |

分數為上游給定的品質資料；本機程式只驗證範圍、合計與門檻。

## 候選生成與資格

如果根物件有 candidates 陣列，使用該陣列；即使是空陣列也不改用 keywords。沒有 candidates 時，StructuredCandidateGenerator 從通過事件檢查的 keywords 組裝候選：

1. 保留 word、評分、難度與題目草案。
2. 缺少 id 時生成「event_id::word」。
3. 把 clue_draft／clue 轉成正式 clue；缺少字數提示時附上正確提示，已有錯誤提示則保留交給檢查器拒絕。
4. 缺少 source_support 時，從來源摘錄挑出含答案的句子，記錄 source_id 與 evidence。
5. 綁定 canonical event_id 與最新 event_revision。

這是**已註記關鍵詞的結構化組裝**，目前不由語言模型閱讀全文、判斷重要性或寫題目。這些工作可透過 CandidateGenerator 介面接入。

候選須符合核心 2～4 字規則、事件通過、Answer Score ≥ 70、版本有效，並通過 C01～C06。重複 id 排除；同答案跨事件重複時，以候選評分、事件評分、穩定 id 順序選一筆。Solver 只拿已合格候選，不用容易交叉來救低分新聞或低分答案。

Answer Score 分項：natural 25、unique_clue 25、familiarity 20、representation 15、length 10、taiwan_usage 5；同樣可直接填分或提供完整 score_components。

## C01～C06 題目機械檢查

| 檢查 | 規則 |
|---|---|
| C01 | 題目不得直接出現答案；先正規化相容字元、標點、空格與不可見格式字元 |
| C02 | 提示以外有至少四個字元，整題不超過預設 60 字元 |
| C03 | 題末提示正確，如「（3字）」「（三字）」；全形數字可正規化 |
| C04 | alternative_answers 中沒有已知同字數替代答案 |
| C05 | considering、planned、reported 保留限定／歸屬語，不把評估或規劃寫成已決定、已完成 |
| C06 | source_support 指向合格來源，evidence 有答案且能對應原始 excerpt |

預設 60 字元是原型的可調參數，不是新增的凍結玩法規則；可用 --clue-max-chars，範圍 10～300。

已知替代答案清單為空，不等於證明唯一性。摘錄中出現答案也不等於證明題目事實正確。每題仍標記 semantic_review=REQUIRED。

## 輸出与狀態

- REVIEW_REQUIRED：達目標題數，字盤與題目機械檢查通過；內容仍待複核。
- PARTIAL：合法但不足目標題數。
- SEARCH_EXHAUSTED：搜尋預算內未找到達最低題數的盤。
- NO_ELIGIBLE_CANDIDATES：事件／候選／題目門檻後沒有可用候選。
- INVALID：最終獨立字盤或題目驗證失敗。

CLI 結束代碼依序為 0、3、2、4、1；輸入／設定錯誤為 2。REVIEW_REQUIRED 的 0 表示這個本機步驟完成，**不表示正式出版核准**。本版 approved_for_print 永遠為 false。

報告保存候選排除原因、E/C/V 各項結果、來源與事件中繼資料、每尺寸搜尋診斷、字數平衡、分類題數與未入盤 Anchor Event。Anchor 沒入盤會明確報告；這一版不保證 Anchor 覆蓋，也不為塞入它而破壞合法字盤。

本版尚待完成的語意／內容工作：真正來源與事實查核、輸出前即時更新重查、題目唯一性、台灣慣用詞、政治中立、長輩難度。pending 標記是管線狀態，不代表現在需要使用者處理合成示範資料。

## 可替換的蒐集與生成器

```javascript
import {JsonSnapshotCollector,runFromAdapters} from './adapters.mjs';

const report = await runFromAdapters(
  {issue_date:'2026-10-01',dataset_mode:'fixture'},
  {collector:new JsonSnapshotCollector('examples/news-input.json')}
);
```

真實新聞蒐集器實作 collect({from,to}) → Promise<Event[]>；候選生成器實作 generate(admittedEvents) → Promise<CandidateAnswer[]>。每個外部 adapter 的輸出都重新進入同一個資格與 Validator 流程，不能跳過檢查。

目前 JsonSnapshotCollector 只讀本機 JSON，不連網；來源網址只保存與驗證格式，不會自動下載。本階段未接實際新聞服務、模型金鑰或出版介面。

## 測試与交付

- examples/news-input.json：28 件合成事件，自動組成候選。
- examples/news-rejected.json：故意洩漏答案與錯誤字數，兩題全部被排除。
- examples/news-puzzle.json：合成管線生成的 8×8／12 題／4、4、4 獨立盤面。
- examples/news-batch.json：原核心六案加新管線兩案的八案回歸。
- reports/news-pipeline.json / .txt：完整成功管線報告。
- reports/news-rejected.json / .txt：詳細排除原因。
- reports/news-batch.json / .txt：八案批次結果。
- reports/tests.txt：85 項測試輸出。

```powershell
node --test test/core.test.mjs test/continuation.test.mjs test/pipeline.test.mjs
```