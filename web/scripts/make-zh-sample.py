"""Generates public/samples/zh-sample.epub: an original Chinese test book with
mixed Latin runs, headings, block quotes, lists, figures and diagrams."""
import io, zipfile, sys, os
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'public', 'samples', 'zh-sample.epub')
FONT = '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc'
if not os.path.exists(FONT):
    FONT = None

def font(sz):
    try:
        return ImageFont.truetype(FONT, sz, index=0) if FONT else ImageFont.load_default()
    except Exception:
        return ImageFont.load_default()

def png(w, h, draw_fn):
    im = Image.new('RGB', (w, h), (250, 246, 238))
    d = ImageDraw.Draw(im)
    draw_fn(d, w, h)
    b = io.BytesIO()
    im.save(b, 'PNG')
    return b.getvalue()

def fig_curve(d, w, h):
    d.rectangle([2, 2, w - 3, h - 3], outline=(60, 50, 40), width=3)
    pts = [(40 + i * (w - 80) / 60, h - 60 - (i / 60) ** 3 * (h - 140) - 8 * (i % 5)) for i in range(61)]
    d.line(pts, fill=(176, 72, 40), width=5)
    d.line([(40, h - 40), (w - 30, h - 40)], fill=(40, 30, 20), width=3)
    d.line([(40, h - 40), (40, 30)], fill=(40, 30, 20), width=3)
    d.text((w // 2 - 120, 20), '技术能力随时间的增长', fill=(30, 20, 10), font=font(30))
    d.text((w - 150, h - 36), '时间', fill=(30, 20, 10), font=font(24))

def fig_wide(d, w, h):
    d.rectangle([2, 2, w - 3, h - 3], outline=(60, 50, 40), width=3)
    for i, name in enumerate(['农业', '文字', '印刷', '电力', '计算机', '人工智能']):
        x = 60 + i * (w - 120) / 5
        d.ellipse([x - 28, h // 2 - 28, x + 28, h // 2 + 28], fill=(210, 150, 80), outline=(60, 40, 20), width=3)
        d.text((x - 30, h // 2 + 44), name, fill=(30, 20, 10), font=font(26))
        if i < 5:
            d.line([(x + 30, h // 2), (x + (w - 120) / 5 - 30, h // 2)], fill=(60, 40, 20), width=4)

def fig_tall(d, w, h):
    d.rectangle([2, 2, w - 3, h - 3], outline=(60, 50, 40), width=3)
    for i in range(6):
        y = 40 + i * (h - 90) / 5
        d.rectangle([w // 2 - 120 + i * 8, y, w // 2 + 120 - i * 8, y + 40], fill=(120 + i * 20, 150, 170 - i * 10), outline=(30, 30, 30), width=2)
        d.text((w // 2 - 50, y + 6), f'第 {i + 1} 层', fill=(255, 255, 255), font=font(26))

def fig_small(d, w, h):
    d.rectangle([2, 2, w - 3, h - 3], outline=(60, 50, 40), width=2)
    d.text((20, h // 2 - 14), '图 · 小插图', fill=(30, 20, 10), font=font(26))

imgs = {
    'curve.png': png(900, 600, fig_curve),
    'wide.png': png(1400, 320, fig_wide),
    'tall.png': png(520, 900, fig_tall),
    'small.png': png(220, 90, fig_small),
    'cover.png': png(600, 900, lambda d, w, h: (d.rectangle([0, 0, w, h], fill=(32, 54, 80)), d.text((120, 300), '智人之后', fill=(240, 230, 200), font=font(96)), d.text((140, 520), 'After Sapiens', fill=(210, 190, 150), font=font(44)))),
}

P1 = [
    '一万年前，没有人会相信，一种生活在东非草原上的灵长类动物，有朝一日会向月球发射探测器，会在地球另一端的屏幕上互相交谈。然而，这正是智人的故事：一个关于想象、合作与工具的故事。',
    '语言让我们得以谈论并不存在的事物。部落、神灵、货币、国家，这些东西没有任何物理实体，却能让成千上万素不相识的人为同一个目标而行动。尤瓦尔·赫拉利把这种能力称为“虚构的力量”，它是智人征服世界的真正秘密。',
    '但故事并没有在这里结束。雷·库兹韦尔在《奇点临近》（The Singularity Is Nearer）一书中提出，信息技术的发展遵循指数规律，每隔十八个月左右，同样价格能买到的算力就会翻一番。如果这个趋势继续下去，我们很快就会面对一种比我们自己更聪明的存在。',
    '这听上去像是科幻小说，可是请回想一下：2012 年之前，没有人认为神经网络能够识别一只猫；2016 年之前，没有人认为计算机能在围棋上击败李世石；2022 年之前，也几乎没有人认为一台机器可以写出像样的十四行诗。每一次“不可能”，都在几年之内变成了“理所当然”。',
]
P2 = [
    '农业革命让人类第一次拥有了剩余的粮食，也让阶级、城市与文字成为可能。印刷术把知识从修道院的抄写室里解放出来，使得宗教改革、科学革命和启蒙运动相继发生。电力和内燃机重塑了工厂与城市，而计算机则重塑了思考本身。',
    '每一次技术革命都带来了赢家与输家。纺织工人砸毁织布机，并不是因为他们愚蠢，而是因为他们清楚地知道，自己的生计正在被机器取代。今天，当插画师、译者、程序员和客服人员看到生成式人工智能（Generative AI，简称 GenAI）飞速进步时，他们的焦虑与两百年前的纺织工人并无二致。',
    '问题在于，这一次的变革可能并不会像过去那样，创造出比它所消灭的更多的新工作。如果机器不仅能够替代我们的体力，还能替代我们的脑力，那么人类还剩下什么比较优势？这是一个我们必须认真对待的问题，而不能用“历史总是如此”来搪塞过去。',
]
QUOTE = '“未来已经到来，只是分布得还不均匀。”——威廉·吉布森（William Gibson），科幻作家'
P3 = [
    '要理解 AI 的影响，不妨先区分三个概念：自动化、增强与替代。自动化指的是机器接手那些重复、规则明确的任务；增强指的是人借助机器完成原本无法完成的工作；替代则意味着整个职业角色的消失。同一项技术，在不同的行业里往往同时扮演这三种角色。',
    '以医学影像为例，算法在筛查早期肺癌方面已经不逊于经验丰富的放射科医生（radiologist）。这并不意味着放射科医生马上会失业——更可能发生的是，医生的时间从“看片子”转向“与病人沟通、制定治疗方案”，而每个医生能服务的病人数量大幅上升。',
    '不过，经济学家也提醒我们，生产率的提高并不会自动转化为普遍的繁荣。收益如何分配，取决于制度、政策与权力结构，而不是技术本身。这一点，是《智人之上》这样的书反复强调的核心论点之一。',
]
LIST = ['理解技术如何改变生产方式；', '识别自己工作中不可替代的部分；', '持续学习，保持好奇心；', '关注制度与伦理，而不只是效率。']
P4 = [
    '长文本中还常常夹杂着英文长词和专有名词，例如 internationalization、Transformer architecture、Reinforcement Learning from Human Feedback，以及网址 https://example.org/a/very/long/path/that/should/never/overflow/the/page/box 之类的字符串。排版引擎必须保证它们不会撑破页面边界，也不会把一行里的汉字拉得稀疏难看。',
    '标点符号也有自己的规矩：句号、逗号、顿号不应出现在行首，而左引号和左括号不应出现在行尾。这套规则在日文里被称为“禁则处理”，在中文排版中同样适用。此外，破折号——像这样——和省略号……都应该占据整整两个汉字的宽度，不应被拆开。',
]
SENT = '这是一个很长的段落，用来测试在不同的缩放比例、不同的视口尺寸以及不同的页面边距下，文字是否始终被约束在页面内容区域之内，不会出现被页面边缘裁切的现象。' * 3

def xhtml(title, body):
    return f'''<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN"><head><meta charset="utf-8"/><title>{title}</title></head>
<body>{body}</body></html>'''

def paras(ps):
    return ''.join(f'<p>{p}</p>' for p in ps)

def fig(src, cap, alt):
    return f'<div class="figure"><img src="images/{src}" alt="{alt}"/><p class="cap">{cap}</p></div>'

chapters = [
    ('序章 · 一个会讲故事的物种', f'<h1>序章</h1><h2>一个会讲故事的物种</h2>{paras(P1)}{fig("curve.png", "图 1  技术能力随时间呈指数增长", "增长曲线")}{paras(P2)}'),
    ('第一章 · 技术革命的回声', f'<h1>第一章</h1><h2>技术革命的回声</h2>{paras(P2[:1])}{fig("wide.png", "图 2  从农业到人工智能的六次浪潮", "六次浪潮")}{paras(P3[:2])}<blockquote>{QUOTE}</blockquote>{paras(P3[2:])}<h3>我们该怎么办</h3><ul>{"".join(f"<li>{x}</li>" for x in LIST)}</ul>'),
    ('第二章 · 版面压力测试', f'<h1>第二章</h1><h2>版面压力测试</h2><p>{SENT}</p>{paras(P4)}{fig("tall.png", "图 3  一幅又高又窄的示意图", "高图")}{paras(P1[:2])}{fig("small.png", "图 4  小插图保持原始尺寸并居中", "小图")}{paras(P3)}<p>{SENT}</p>{paras(P4)}'),
]

opf_items = ''.join(f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(len(chapters)))
opf_items += ''.join(f'<item id="i{k.split(".")[0]}" href="images/{k}" media-type="image/png"{" properties=\"cover-image\"" if k == "cover.png" else ""}/>' for k in imgs)
opf_items += '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
spine = ''.join(f'<itemref idref="c{i}"/>' for i in range(len(chapters)))
opf = f'''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bid">zh-sample-1</dc:identifier><dc:title>智人之后（排版样书）</dc:title><dc:creator>Infinite Reader</dc:creator><dc:language>zh-CN</dc:language></metadata>
<manifest>{opf_items}</manifest><spine>{spine}</spine></package>'''
nav = xhtml('目录', '<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol>' + ''.join(f'<li><a href="c{i}.xhtml">{t}</a></li>' for i, (t, _) in enumerate(chapters)) + '</ol></nav>')

with zipfile.ZipFile(OUT, 'w') as z:
    z.writestr('mimetype', 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
    z.writestr('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
    z.writestr('OEBPS/content.opf', opf)
    z.writestr('OEBPS/nav.xhtml', nav)
    for i, (t, body) in enumerate(chapters):
        z.writestr(f'OEBPS/c{i}.xhtml', xhtml(t, body))
    for k, v in imgs.items():
        z.writestr(f'OEBPS/images/{k}', v)
print('wrote', OUT)
