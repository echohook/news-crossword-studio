# 選題範圍：排除娛樂新聞 — v1.5.0

依使用者 2026-10-02 的選題要求，本原型排除娛樂新聞。此規則在評分、重點新聞排序及排盤之前執行；高分、重點事件、可交叉或混合科技／文化分類都不會豁免。

## 可使用的中繼資料

上游蒐集或編輯可在事件、候選或候選的 event 中提供：

```json
{
  "categories": ["科技", "娛樂"],
  "is_entertainment": true,
  "scope_note": "分類的編輯理由"
}
```

任何娛樂標記都會排除，不要求上述欄位同時存在。可辨認 categories、category、editorial_domain、source_section，以及 sources 中的 section／category。標籤包含娛樂、娛樂新聞、影劇、影劇新聞、影視娛樂、演藝、演藝新聞、明星八卦、綜藝、追星及 entertainment／showbiz／celebrity／celebrity gossip。比對會正規化 Unicode、大小寫、空白及不可見格式字元；完整清單見 news-policy.mjs。

is_entertainment 若提供，必須是布林值。字串 "false"、數字或 null 會被排除並標示 NEWS_SCOPE_INVALID；布林 false 不會抵銷其他欄位的娛樂標記。

這是依明示分類執行的範圍規則，沒有自動語意分類器。未標記的資料不會由標題或答案猜測；上游仍須正確分類。電競、電影等詞本身不等於娛樂新聞，例如體育比賽可另列體育類；文化資產保存、公共生活議題不因「文化」分類而排除。

## 各入口的結果

- 新聞蒐集：新增 E06；事件被排除後，其 keywords 不會產生候選，也不計入合格重點事件分母。event_reports 保留排除原因及原始快照，方便追溯。
- 明示 candidates：A02 阻擋被排除的事件；A05 再檢查候選本身及嵌入事件的分類，不能以重新綁定事件繞過。
- 直接 solve／analyze：先篩選候選，回報 ENTERTAINMENT_EXCLUDED 或 NEWS_SCOPE_INVALID。Solver 的 news_scope 保存排除清單；不修改輸入資料。
- 所有候選被排除：Pipeline 回傳 NO_ELIGIBLE_CANDIDATES；直接 Solver 回傳 SEARCH_EXHAUSTED，沒有盤面。不宣稱存在合法題盤。
- 舊存檔：Validator 的 V01～V08 仍只判斷盤面幾何；包含娛樂候選的舊盤不能建立試玩版、範本或判題結果。品質報告另列 NEWS_SCOPE=FAIL，整體 INVALID。

沒有可關閉此規則的 CLI 選項。未來 Collector／CandidateGenerator 應保留上述分類欄位，仍使用同一資格檢查；未來 A4 輸出可使用 buildWorksheet 通過後的資料。

## 固定新聞快照的調整

保留 2026-10-01 原始快照中的 11 件事件、34 個候選，另外明示以下兩件不納入本期：

| 事件 | 本期範圍判斷 | 排除候選數 |
| --- | --- | --- |
| tourism-market | 藝人助陣的旅遊宣傳活動，採保守範圍排除 | 3 |
| africa-expo | 漫畫、角色扮演及遊戲娛樂展會，科技分類不豁免 | 4 |

剩餘 9 件合格事件、27 個候選。預設設定及 attempts=256、seed=2 均得到 8×8、12 題、兩則合格重點新聞全涵蓋，2／3／4 字分布為 3／5／4，各類均未超過 50%。不為補齊四題而引入娛樂新聞或牽強詞彙。有界搜尋未證明其他分布不存在。

資料仍是 2026-09-25～2026-10-01 的固定快照；2026-10-02 是套用選題規則的日期，沒有把舊資料改稱當日最新新聞。

## 重複驗收

```powershell
node cli.mjs pipeline examples/news-real-20261001.json --attempts 256 --seed 2
node cli.mjs batch examples/news-scope-batch.json
npm test
```

16 項新增測試涵蓋分類別名、混合分類、布林格式、來源分類、更新版本、候選繞過、全部排除、只讀與重現性、舊盤、真實快照及 CLI。專用批次四案例包含正常排盤與預期無盤兩種結果；預期無盤不是 VALID。