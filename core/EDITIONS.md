# 一次產出多份題目
目前版本 1.7.2。份數指定 1～7。**同一批次各份的題目與答案均不得重複，這是硬性規則。**
前一份使用過的答案與提示會在下一份排盤之前移出候選池。相同答案即使改編號、換提示或換位置仍禁止；提示也不能只換標點、空白或字數標示再使用。交叉的單一中文字可共用。同一事件的不同答案與不同提示仍可使用，本規則不限制新聞事件僅出現一次。

## 操作
```powershell
node cli.mjs generate examples/mixed-input.json --count 2 --attempts 256 --seed 2 --out reports/editions-report.json --json
```
現有示範成語題庫只有四題，每份要四題，因此此指令會回傳 INCOMPLETE（指定兩份、完成一份，CLI 結束碼 3）；第二份成語剩餘零題、需要四題，不會用重複內容補數。
要做兩份各 8 題時事＋4 題成語，至少需 16 個不同時事答案與 8 個不同成語，全部須有不同提示、通過題目檢查並可合法交叉。單有足夠數量不保證能排盤。第一份為固定新聞快照，並非即時新聞。

generate 接受現有混合、新聞、候選答案輸入格式。新聞與候選模式可指定 --target；混合模式每份題數由 mix 設定。--count 是幾份，--target 是每份幾題。
--variant-attempts（預設 3，上限 10）控制搜尋預算；同一輸入、設定及 seed 可重現。已通過新聞篩選與題目檢查的候選才供多份產題使用，娛樂新聞持續排除。
回傳 requested_count、generated_count、COMPLETE / INCOMPLETE、diversity_validation、shortage、每份 V01～V08、作答版與答案版。shortage 顯示下一份需要的總題數及時事／成語題數與剩餘數量。
字串比對使用 NFKC，提示忽略標點、空白與字數標示；語意改寫或同義答案仍需編輯複核。本版只檢查同一批次，尚未建立跨歷期使用紀錄。
每份依序選題，不進行整批分配的完整回溯；INCOMPLETE 不是無解證明。若題庫數量不足，增加搜尋次數不會解決缺題，須先補充題庫。
原 v1.7.0 的兩份 PDF 與程式包保留為歷史成品，其允許重複的示範已不符合目前規則，不得採用作新版驗收。

## PDF
```powershell
python render_editions.py reports/editions-report.json multi-editions.pdf
```
只接受 COMPLETE 批次。輸出前重新檢查每份 V01～V08、作答與答案資料，以及**整批無重複答案及提示**，不信任儲存的 PASS。舊版共有答案的批次也會被攔下。若為 INCOMPLETE 不建立 PDF。
需 Python、reportlab、pypdf 及 Windows 微軟正黑體。版面仍為作答頁在前、答案頁在後，每份標示份次，橫向阿拉伯數字、直向國字；僅作答頁保留填答日期。
一般使用者未有操作網頁，後續介面使用同一 generateEditions 功能接入份數欄位。
