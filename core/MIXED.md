# 時事與成語混合模式 — v1.6.0

本輪預設採時事 8 題、成語 4 題，混排在同一張盤面。每個答案至少一個有效交叉；允許分離的交叉組，仍由獨立 Validator 掃描所有橫直字串。

## 重跑

```powershell
node cli.mjs mixed examples/mixed-input.json --attempts 256 --seed 2
node cli.mjs mixed examples/mixed-input.json --attempts 256 --seed 2 --json
node cli.mjs validate examples/mixed-puzzle.json
node cli.mjs worksheet examples/mixed-puzzle.json
npm test
```

本固定案例得到 9×9、12 題，時事 8 題、成語 4 題，2／3／4 字分布 4／3／5；V01～V08 全 PASS，50% 原則通過。先搜尋 8×8，再搜尋 9×9；另增加 8×8 搜尋至每個種子 1,024 次仍未得到全題數，不宣稱數學上不存在 8×8 解。

本輪新增十項回歸測試，累計 156 項通過，包含配額、字盤、輸入不變、辭典來源、混合 CLI、玩家答案保密及「智撤」攔截。

## 輸入契約

mixed-input.json 包含 news（完整既有新聞快照）、idioms（四字成語候選陣列）、mix（news／idiom 的正整數題數，總和不超過 14）。預設 mix 為 8／4；CLI 允許 --attempts 與 --seed。

時事仍先走新聞資格檢查、娛樂排除、來源摘錄及事實狀態檢查，再取 eligible_candidates。成語獨立走四字、來源與釋義、C01～C04 的檢查，不需要新聞日期，也不能附新聞 event 或把自己標成新聞重點。

成語資料保存 knowledge_source.publisher／url／meaning；content_kind 為 idiom。為相容既有核心，event_id 使用個別成語的穩定內容識別碼，並不代表新聞事件。不得以錯誤或缺漏的辭典欄位入盤。

Solver 新增可選 contentTargets: {news:8, idiom:4}。混合模式要求完整目標題數，若不足或配額無法完成則 SEARCH_EXHAUSTED，不回傳少題的混合完成盤。配額同時限制單詞與交叉組的插入；不使用該選項時沿用原有行為。

## 成語題設計與來源

成語題以「【成語】」標示，採生活釋義，加上一個字或字形結構提示，減少近義成語造成的多解。提示不是新聞事實；完整答案仍不出現在作答頁。

| 答案 | 來源 | 本題區分提示 |
| --- | --- | --- |
| 一諾千金 | [教育部《成語典》](https://dict.idioms.moe.edu.tw/idiomView.jsp?ID=69&webMd=1) | 第二字「諾」 |
| 半途而廢 | [教育部《成語典》電子書](https://dict.idioms.moe.edu.tw/bookView.jsp?ID=11111111) | 第二字「途」，採一般用字 |
| 大吉大利 | [教育部《國語辭典簡編本》](https://dict.concised.moe.edu.tw/dictView.jsp?ID=7167&la=0&powerMode=0) | 第一與第三字都是「大」 |
| 國泰民安 | [教育部臺灣客語辭典，對應國語詞](https://hakkadict.moe.edu.tw/search_result/?id=9186) | 第二字「泰」 |

字詞與釋義本輪人工核對於 2026-10-02；程式的來源欄位檢查不能取代語意複核。成語題是否自然、唯一、適合讀者仍為 REVIEW_REQUIRED；正式出版核准保持 false。

## 保存成果

- examples/idioms.json：成語候選與辭典來源。
- examples/mixed-input.json：可重跑的混合輸入。
- examples/mixed-puzzle.json：已驗證盤面。
- reports/mixed-report.json／txt：混合排盤完整報告。
- reports/mixed-player.json／txt、mixed-answers.json／txt：作答與答案資料。
- examples/mixed-answer-template.json：作答範本，使用核心題號。

PDF 使用方向各自編號：橫向 1～6，直向一～六。PDF 顯示號碼是呈現層標籤；JSON／判題範本保留核心 numeric number 加 H／V，必須依同一題的方向與起點對照，不以 PDF 顯示數字直接替換 JSON 的核心題號。

新聞窗口仍為 2026-09-25～2026-10-01；成語不受此時間窗口限制。PDF 頁首新聞期間只表示時事題的期間，不表示成語也是該週新聞。