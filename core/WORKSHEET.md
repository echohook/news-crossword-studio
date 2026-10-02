# 文字試玩、題號與作答檢查 — v1.3.0

此功能只提供文字與 JSON；沒有 GUI、圖片或 PDF。作答版與答案版各自建立，作答版不附帶答案盤、答案詞、候選 ID 或完整事件中繼資料。

## 題號

依起點由上到下、同列由左到右編號。橫向與直向共用起點時，共用數字，靠 H／V 區分，例如 H01、V01。題號不依輸入候選或 placements 的排列順序。

JSON 座標從 0 開始；文字顯示的列、行座標從 1 開始。數字印在答案起點的同一格，不佔用字格，不改變任何 Solver 座標或阻隔格。

## 直接試玩

```powershell
node cli.mjs worksheet examples/news-real-puzzle.json
node cli.mjs worksheet examples/news-real-puzzle.json --answers
node cli.mjs answer-template examples/news-real-puzzle.json
node cli.mjs grade examples/news-real-puzzle.json examples/news-real-sample-submission.json
```

不需要執行程式也可以閱讀已保存的試玩檔：

- reports/news-real-player.txt：空白作答盤與橫直題目。
- reports/news-real-answers.txt：相同盤面的答案版。
- examples/news-real-answer-template.json：所有題目的空白作答欄。
- examples/news-real-sample-submission.json：示範作答，故意保留未答與錯誤。
- reports/news-real-sample-grade.txt：上述示範作答的檢查結果，50 分不是正式玩家成績。

將空白範本另存一份，在 answer 欄填零至四個中文字；未填的題目仍是空字串。number 與 direction 請保留。例如：

```json
{"number":1,"direction":"H","answer":""}
```

同一題號的 H、V 是不同答案，不可只靠數字判題。

## 檔案輸出

```powershell
node cli.mjs worksheet examples/news-real-puzzle.json --out player.txt
node cli.mjs worksheet examples/news-real-puzzle.json --answers --out answers.txt
node cli.mjs worksheet examples/news-real-puzzle.json --json --out player.json
node cli.mjs answer-template examples/news-real-puzzle.json --out my-answers.json
node cli.mjs grade examples/news-real-puzzle.json my-answers.json --json --out grade.json
node cli.mjs grade examples/news-real-puzzle.json my-answers.json --reveal
```

worksheet --out 與畫面輸出一致：預設是文字，有 --json 時是 JSON。answer-template 與 grade --out 固定保存 JSON。Node 需有寫入指定位置的權限；只閱讀既有試玩檔不需要程式寫檔。

三個指令均可用 --clue-max-chars 設定 10～300 字的機械檢查上限，預設 60；若使用較長題目，建立作答範本與判題時也應使用相同上限。

## 輸出前的檢查

所有輸出重新送入獨立 Validator，並檢查 NEWS_SCOPE.md 的娛樂新聞排除規則；包含娛樂候選的舊盤不得建立試玩版或判題。智撤、貼字、衝突、孤立答案等錯誤盤都禁止建立試玩版。

題目必須通過 C01～C04：沒有洩漏本題答案、文字完整、字數提示正確、沒有已知同字數替代答案。附有非 fixture 事件資料者，另要求 C05／C06：保留事實狀態限定語、來源摘錄支持。

若題目提及另一題答案，產生 OTHER_ANSWER_IN_CLUE 提醒；不是認定所有相關詞都禁止互相提及。本次真實新聞試玩版已改寫此類直接提示，沒有這項提醒。

TRIAL_READY 表示可供文字試玩，review_status=REQUIRED、approved_for_print=false。機械檢查不代表已完成新聞新鮮度、唯一性或長輩難度的編輯複核。

## 作答版本與判題

worksheet_id 是盤面、題號、答案及題目文字的固定摘要。候選輸入順序不同不會換 ID；題目或盤面改動則會換 ID。舊範本不可送入新版本判題，避免對錯題號。

判題包括：

- CORRECT：與正式答案相同。
- INCORRECT：不相同；少填字時另標 LENGTH_MISMATCH。
- UNANSWERED：未填或省略該題。
- crossing_conflicts：橫直作答在共用格填了不同字。

預設不輸出正確答案；只有 --reveal 明確要求時才附答案。判題不會修改原始盤面或 Solver 資料。

未知題號、重複題號、錯版本、非中文字及未知欄位會成為輸入錯誤。格式合法但答錯仍是成功完成判題，CLI 結束碼 0；不合法盤或題目阻擋輸出為 1，輸入／選項錯誤為 2。

## 擴充介面

worksheet.mjs 提供 numberEntries、buildWorksheet、createAnswerTemplate、gradeAnswers 與文字 formatter。未來 A4 渲染器可以使用相同題號及 player／answers 資料，並在渲染前重新呼叫 Validator；此階段未實作 A4 或 PDF。
