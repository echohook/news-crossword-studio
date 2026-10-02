# 整份遊戲品質報告 — v1.4.0

```powershell
node cli.mjs quality reports/news-real-20261001.json
node cli.mjs quality reports/news-real-20261001.json --json --out quality.json
node cli.mjs quality examples/news-real-puzzle.json
```

可輸入單獨盤面、完整 Solver 報告或完整 Pipeline 報告。單獨盤面不知道未入盤的重點事件，該項不評分；不是假設全部已涵蓋。評分只讀取資料，不修改盤面、題目或選題排序。

權重使用參考對話凍結的 20／20／15／20／15／10。下列細部公式是本原型提出的可重複參考值，不是新增硬門檻，也不是經長輩試玩校準的品質標準。

| 項目 | 權重 | 本原型如何計算 |
| --- | ---: | --- |
| 字數平衡 | 20 | 使用既有字數差距，扣除題數無法三等分時的理論最小差距，再與最大差距相比 |
| 主題多樣性 | 20 | 七類標籤的正規化 Shannon entropy；多重標籤會分別計數 |
| 跨主題交叉 | 15 | 不重複交叉詞對中，兩端已知主題標籤完全不重疊的比例 |
| 難度平衡 | 20 | 已標註 easy／medium／hard 的分布與參考目標差距 |
| 盤面緊湊度 | 15 | 有字格占最小包圍矩形格數的比例 |
| 重點新聞涵蓋 | 10 | 完整上下文內已涵蓋重點事件／所有重點事件 |

跨主題比較只用科技、財經、體育、生活、文化；台灣、國際是地理標籤，不單獨證明不同主題。這個值根據輸入分類，不證明兩詞實際語義不同。

難度參考目標為 easy 50%、medium 50%、hard 0%，只供初版觀察；不是凍結的硬比例。API assessQuality 可傳 difficultyTarget 改成其他總和為一的比例。輸入標籤不等於長輩真實體驗。

所有指令預設題目機械長度上限 60，可用 --clue-max-chars 設定 10～300。較高品質分數不會改變題目檢查門檻。

## 不把缺資料補成零或滿分

缺少任一題分類、難度，或無法完整分類所有交叉詞對時，對應項目為 UNASSESSED、score=null。沒有指定任何重點事件則為 NOT_APPLICABLE；不能因此自動得到十分快速提高總分。

若有未評估項目，total_score=null，另列 available_score／available_weight；不把已評估的部分偷偷放大為滿分一百。

完整 Pipeline 的重點事件分母包括新聞合格但候選被淘汰的事件，沿用選題模組的完整涵蓋率。Solver 報告則使用其候選池中的事件範圍。

## 硬門檻與參考分數分開

- GRID：獨立 Validator。失敗盤不計分。
- NEWS_SCOPE：娛樂新聞排除規則；不合格時 FAIL，即使幾何合法也整體 INVALID。
- CLUE_MECHANICS：文字試玩所要求的機械題目檢查。
- NEWS_FACTS_AND_FRESHNESS：若已知機械狀態或來源支持不合格則 FAIL，其他情況仍 REVIEW_REQUIRED。
- CLUE_UNIQUENESS：已知題目洩漏或替代答案則 FAIL，其他情況仍 REVIEW_REQUIRED。

正式內容的新聞查核、唯一性與出刊前更新必須有真正編輯證據。本原型沒有提供自動或手工填一個旗標就核准出版的捷徑；approved_for_print 始終 false。

V1-R18 的同義／上下位概念型答案比例約 20%，仍列 semantic_relation_review=REVIEW_REQUIRED。沒有人工標註時，不用共同字或同事件猜測詞義關係。

整體品質可能 INVALID 而 grid_status=VALID：表示盤面幾何合法，但已知題目有問題。這不是改變 Validator 的判定。

## 本期實測

本真實新聞快照的完整配置：
字數 17.5、主題 18.26、跨主題 7.5、難度 10、緊湊度 7.27、重點涵蓋 10，參考總分 **70.53／100**。這是排除娛樂後的 v1.5.0 固定配置。

它仍是 REVIEW_REQUIRED；沒有任意設定合格分數。資料全部標為 medium，因此相對初步 50／50 難度目標得到十分，這只是提示題庫分布，不是認定長輩會覺得困難。

九項新增回歸測試涵蓋權重、缺資料、地理標籤、錯盤、已知歧義、可調難度目標、重點事件上下文、只讀取原資料與 CLI 狀態。
