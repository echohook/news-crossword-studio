import json, sys, tempfile, math, re, subprocess, shutil
from pathlib import Path
from datetime import date, timedelta
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader

if len(sys.argv) not in [2,3]:
    raise SystemExit('Usage: python render_editions.py report.json [output.pdf]')
INPUT=Path(sys.argv[1]).resolve()
BASE=Path(__file__).resolve().parent
node=shutil.which('node')
if not node:raise RuntimeError('Node.js is needed for independent validation before export')
verification="""
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const base=process.argv[2];
const {validatePuzzle}=await import(base+'validator.mjs');
const {buildWorksheet}=await import(base+'worksheet.mjs');
const {MAX_EDITIONS,validateEditionDiversity}=await import(base+'edition-policy.mjs');
const r=JSON.parse(readFileSync(process.argv[1],'utf8').replace(/^\\uFEFF/,''));
assert.equal(r.status,'COMPLETE','Batch is incomplete');
assert.ok(Number.isSafeInteger(r.requested_count)&&r.requested_count>=1&&r.requested_count<=MAX_EDITIONS);
assert.equal(r.generated_count,r.requested_count);
assert.equal(r.editions.length,r.requested_count);
assert.ok(validateEditionDiversity(r.editions).valid,'Repeated answer or clue in batch');
r.editions.forEach((e,i)=>{
 assert.equal(e.edition_number,i+1);
 const v=validatePuzzle(e.puzzle);assert.ok(v.valid,'Independent board scan failed');
 assert.deepEqual(e.grid_validation,JSON.parse(JSON.stringify(v)));
 const settings={maxClueChars:r.render_settings.maxClueChars};
 const p=buildWorksheet(e.puzzle,settings),a=buildWorksheet(e.puzzle,{...settings,includeAnswers:true});
 assert.equal(p.status,'TRIAL_READY');assert.equal(p.clue_warnings.length,0);
 assert.deepEqual(e.player,p);assert.deepEqual(e.answers,a);

});
"""
verified=subprocess.run([node,'--input-type=module','-e',verification,str(INPUT),BASE.as_uri()+'/'],capture_output=True,text=True,encoding='utf-8')
if verified.returncode:raise SystemExit(verified.stderr)
report=json.loads(INPUT.read_text('utf-8-sig'))
editions=report['editions']
TEMP=Path(tempfile.mkdtemp(prefix='news-crossword-editions-'))
PDF=Path(sys.argv[2]).resolve() if len(sys.argv)==3 else TEMP/'multi-editions.pdf'
pdfmetrics.registerFont(TTFont('JhengHei','C:/Windows/Fonts/msjh.ttc',subfontIndex=0))
pdfmetrics.registerFont(TTFont('JhengHeiBold','C:/Windows/Fonts/msjhbd.ttc',subfontIndex=0))
W,H=A4;M=13*mm
period=''
if report.get('issue_date'):
    end=date.fromisoformat(report['issue_date'])
    period='新聞期間：'+(end-timedelta(days=6)).strftime('%Y.%m.%d')+' - '+end.strftime('%Y.%m.%d')
TOTAL=len(editions)*2
c=canvas.Canvas(str(PDF),pagesize=A4,pageCompression=1)
c.setTitle('時事填字樂 - 多份題目試印版')
c.setAuthor('時事填字樂')
c.setSubject('作答頁在前，答案頁在後；每份獨立驗證')
layout=[]

def draw_text(x,y,text,size=13.5,bold=False):
    c.setFont('JhengHeiBold' if bold else 'JhengHei',size)
    c.setFillColorRGB(0,0,0)
    c.drawString(x,y,text)

def wrap(text,width,size):
    lines=[];line=''
    for ch in re.findall(r'（[234]字）|.',text):
        if line and pdfmetrics.stringWidth(line+ch,'JhengHei',size)>width:
            if ch in '，。！？、；：）】》」』％' and len(line)>1:
                lines.append(line[:-1]);line=line[-1]+ch
            else:
                lines.append(line);line=ch
        else:line+=ch
    if line:lines.append(line)
    # Move opening punctuation to the following line if needed.
    for i in range(len(lines)-1):
        if lines[i] and lines[i][-1] in '（【《「『':
            char=lines[i][-1];lines[i]=lines[i][:-1];lines[i+1]=char+lines[i+1]
    assert all(pdfmetrics.stringWidth(line,'JhengHei',size)<=width+0.01 for line in lines)
    return lines

def chinese_number(n):
    if not isinstance(n,int) or not 1<=n<=99:
        raise ValueError('Display number must be 1..99')
    digits='零一二三四五六七八九'
    if n<10:return digits[n]
    ten,unit=divmod(n,10)
    return (digits[ten] if ten>1 else '')+'十'+(digits[unit] if unit else '')

def display_numbering(sheet):
    clues={'H':[],'V':[]}
    starts={}
    for direction in ['H','V']:
        ordered=sorted(sheet['clues'][direction],key=lambda e:(e['row'],e['col']))
        for index,e in enumerate(ordered,1):
            label=str(index) if direction=='H' else chinese_number(index)
            annotated={**e,'display_label':label,'display_index':index}
            clues[direction].append(annotated)
            start=(e['row'],e['col'])
            starts.setdefault(start,{})[direction]=label
        assert len(set(e['display_label'] for e in clues[direction]))==len(ordered)
    assert sum(len(v) for v in starts.values())==sheet['entry_count']
    for direction in ['H','V']:
        for e in clues[direction]:
            assert starts[(e['row'],e['col'])][direction]==e['display_label']
    return clues,starts

assert [chinese_number(i) for i in [1,6,10,11,14,20]]==['一','六','十','十一','十四','二十']
# Two directions may start in the same cell; retain both display labels.
shared={'entry_count':2,'clues':{'H':[{'row':0,'col':0}],'V':[{'row':0,'col':0}]}}
assert display_numbering(shared)[1][(0,0)]=={'H':'1','V':'一'}

def grid(sheet):
    display,starts=display_numbering(sheet)
    cell=({8:12,9:11.5,10:10.5}[N])*mm
    x=(W-N*cell)/2
    top=H-98
    bottom=top-N*cell
    c.setLineWidth(.75)
    for r,row in enumerate(sheet['board']):
        for col,v in enumerate(row):
            left=x+col*cell;low=top-(r+1)*cell
            if v['block']:
                c.setFillColorRGB(.24,.24,.24)
            else:c.setFillColorRGB(1,1,1)
            c.setStrokeColorRGB(0,0,0)
            c.rect(left,low,cell,cell,stroke=1,fill=1)
            if not v['block']:
                labels=starts.get((r,col),{})
                if 'H' in labels:draw_text(left+2.7,low+cell-10,labels['H'],9,True)
                if 'V' in labels:
                    label=labels['V']
                    lx=left+cell-2.7-pdfmetrics.stringWidth(label,'JhengHeiBold',9) if 'H' in labels else left+2.7
                    draw_text(lx,low+cell-10,label,9,True)
                if sheet['mode']=='answers':
                    ch=v['value'];size=20
                    c.setFont('JhengHei',size);c.setFillColorRGB(0,0,0)
                    c.drawCentredString(left+cell/2,low+4.5,ch)
    return bottom

def header(mode):
    c.setFont('JhengHeiBold',27);c.setFillColorRGB(0,0,0)
    c.drawString(M,H-48,'時事填字樂')
    c.setFont('JhengHeiBold',14)
    c.drawRightString(W-M,H-46,(f'第 {EDITION} 份・作答頁' if mode=='player' else f'第 {EDITION} 份・答案頁'))
    subtitle=period
    if mode=='player':subtitle+=('　　' if subtitle else '')+'填答日期：________________'
    assert pdfmetrics.stringWidth(subtitle,'JhengHei',10.5)<=W-2*M
    draw_text(M,H-70,subtitle,10.5)

def footer(page,mode):
    c.setStrokeColorRGB(.65,.65,.65);c.setLineWidth(.4)
    c.line(M,42,W-M,42)
    player_note='多份題目・試印版'
    draw_text(M,27,player_note if mode=='player' else '答案頁請另行保管，勿與作答頁同時發放。',9)
    c.setFont('JhengHei',9);c.drawRightString(W-M,27,f'{page} / {TOTAL}')

sheets=[(e['player'],e) for e in editions]+[(e['answers'],e) for e in editions]
for page,(sheet,edition) in enumerate(sheets,1):
    N=sheet['size'];EDITION=edition['edition_number']
    assert N in [8,9,10]
    header(sheet['mode'])
    bottom=grid(sheet)
    display_clues,display_starts=display_numbering(sheet)
    gap=7*mm
    width=(W-2*M-gap)/2
    columns=[M,M+width+gap]
    y_head=bottom-25
    min_y=10000
    for direction,x in zip(['H','V'],columns):
        label=('橫向' if direction=='H' else '直向')+('題目' if sheet['mode']=='player' else '答案')+(' →' if direction=='H' else ' ↓')
        draw_text(x,y_head,label,15,True)
        c.setStrokeColorRGB(.55,.55,.55);c.setLineWidth(.5)
        c.line(x,y_head-7,x+width,y_head-7)
        y=y_head-28
        for e in display_clues[direction]:
            prefix=e['display_label']+('.' if direction=='H' else '、')
            if sheet['mode']=='player':
                indent=30
                draw_text(x,y,prefix,13.5,True)
                lines=wrap(e['clue'],width-indent,13.5)
                for line in lines:
                    draw_text(x+indent,y,line,13.5)
                    layout.append({'page':page,'direction':direction,'number':e['number'],'display_label':e['display_label'],'text':line,'baseline':round(y,2)})
                    y-=18
                y-=4
            else:
                draw_text(x,y,prefix,15,True)
                draw_text(x+32,y,e['answer'],17,True)
                if e['clue'].startswith('【成語】'):
                    lx=x+32+pdfmetrics.stringWidth(e['answer'],'JhengHeiBold',17)+8
                    draw_text(lx,y,'【成語】',10)
                y-=32
        min_y=min(min_y,y)
    assert min_y>=54, f'Clues too close to footer: {min_y}'
    footer(page,sheet['mode'])
    c.showPage()
c.save()



reader=PdfReader(str(PDF))
assert len(reader.pages)==TOTAL
texts=[p.extract_text() for p in reader.pages]
for index,(sheet,e) in enumerate(sheets):
    t=texts[index];mode=sheet['mode']
    assert '時事填字樂' in t and '銀髮' not in t
    assert ('填答日期：________________' in t)==(mode=='player')
    if period:assert period in t
    assert f"第 {e['edition_number']} 份" in t
    assert not any(s in t for s in ['姓名','12 題','8 × 8'])
    answers=[v['answer'] for d in ['H','V'] for v in e['answers']['clues'][d]]
    if mode=='player':assert all(word not in t for word in answers), 'Answers leaked'
    else:assert all(word in t for word in answers), 'Missing answers'
    assert t.count('【成語】')==sum(v['clue'].startswith('【成語】') for d in ['H','V'] for v in sheet['clues'][d])
    for d in ['H','V']:
        for v in display_numbering(sheet)[0][d]:
            assert v['display_label']+('.' if d=='H' else '、') in t
    p=reader.pages[index]
    assert math.isclose(float(p.mediabox.width),W,abs_tol=.01)
    assert math.isclose(float(p.mediabox.height),H,abs_tol=.01)
    for font in p['/Resources']['/Font'].get_object().values():
        f=font.get_object()
        if str(f.get('/BaseFont',''))=='/Helvetica':continue
        assert '/FontFile2' in f['/FontDescriptor'].get_object()
summary={'pdf':str(PDF),'temp_dir':str(TEMP),'pages':TOTAL,'editions':len(editions),'order':'all players, then all answers','independently_validated':True,'embedded_chinese_fonts':True,'player_answers_hidden':True,'batch_id':report['batch_id']}
(TEMP/'qa.json').write_text(json.dumps({**summary,'layout':layout},ensure_ascii=False,indent=2),'utf-8')
print(json.dumps(summary,ensure_ascii=True))
