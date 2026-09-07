#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
逐頁產生中文字型子集。

為什麼要這個檔案：
  fonts/ 裡的 noto-*.woff2 是「全站合一份」的子集，每個字重收了 900～1000 個字。
  結果是首頁的宋體只用來排「回春視務所」等二十幾個字，卻要下載 196 KB。
  這支程式改成一頁一份：只把「那一頁真的會顯示到的字」放進去，放在 fonts/page/。

來源與產出：
  來源 = fonts/noto-*.woff2（保留著，當作重新產生的母檔，網頁不再直接引用）
  產出 = fonts/page/<頁名>-<字族>-<字重>.woff2（網頁實際引用的檔案）

什麼時候要重跑：
  ★ 只要改到網頁上會顯示的文字（含 JS 裡的字串），就要重跑，否則新加的字
    不在子集裡，會改用系統字顯示，跟其他字粗細不一致。
  執行方式：  python3 tools/build-fonts.py
  需要套件：  pip install fonttools brotli

怎麼判斷哪些字要收：
  只掃「會被顯示出來的地方」——內文、alt/title 等屬性、CSS 的 content、
  以及 <script> 裡的字串常值（時段表、「已同步」「不可預約」這類 JS 產生的字）。
  中文註解不會被收進去（那是給人看的，不會顯示在畫面上）。
  另外固定補上全形標點與常用符號，避免漏字。
"""
import os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "fonts")
OUT_DIR = os.path.join(ROOT, "fonts", "page")

# 每頁實際用到的「字族-字重」。改 CSS 時若動到 font-family / font-weight，這裡要跟著改。
PAGES = {
    "index":   ["noto-serif-tc-300", "noto-sans-tc-300"],
    "about":   ["noto-serif-tc-300", "noto-serif-tc-700"],
    "map":     ["noto-serif-tc-700", "noto-sans-tc-300", "noto-sans-tc-700"],
    "outfit":  ["noto-serif-tc-700", "noto-sans-tc-400", "noto-sans-tc-700"],
    "booking": ["noto-serif-tc-700", "noto-sans-tc-300", "noto-sans-tc-400", "noto-sans-tc-700"],
}

# 保險字元：頁面上沒出現、但很容易在下次改文案時用到的標點與符號，先收進去，
# 這樣小幅修文字時不一定要重跑這支程式。刻意只收最常用的幾個，多收一個標點
# 每個字重大約多 0.2 KB。母檔沒有的會自動略過。
ALWAYS = set(chr(c) for c in range(0x20, 0x7F))          # 半形英數與標點
ALWAYS |= set("　、。，．；：？！…—－～「」（）")

JS_STRING = re.compile(r"""'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\])*)`""", re.S)
# 注意：不要收 <meta content="...">。那是給搜尋引擎與分享預覽看的，不會顯示在畫面上，
# 但那些描述文字很長，收進來會平白把子集撐大一大截。
RENDERED_ATTR = re.compile(r'(?:alt|title|placeholder|aria-label|value)\s*=\s*"([^"]*)"', re.I)
CSS_CONTENT = re.compile(r'content\s*:\s*["\']([^"\']*)["\']')


def rendered_text(path):
    """回傳這一頁所有『可能被顯示出來』的文字。刻意不收註解。"""
    html = open(path, encoding="utf-8").read()
    out = []

    scripts = re.findall(r"<script[^>]*>(.*?)</script>", html, re.S)
    styles = re.findall(r"<style[^>]*>(.*?)</style>", html, re.S)

    # 1) JS 字串常值：JS 產生的畫面文字（「讀取中」「不可預約」…）都在這裡
    for js in scripts:
        for m in JS_STRING.finditer(js):
            out.append(next(g for g in m.groups() if g is not None))

    # 2) CSS 的 content:""
    for css in styles:
        out += CSS_CONTENT.findall(css)

    # 3) 內文：拿掉 script / style / 註解後剩下的文字節點，加上會顯示的屬性
    body = html
    for block in scripts + styles:
        body = body.replace(block, " ")
    out += RENDERED_ATTR.findall(body)
    body = re.sub(r"<!--.*?-->", " ", body, flags=re.S)
    body = re.sub(r"<[^>]+>", " ", body)
    out.append(body)

    return "".join(out)


def build(page, fonts, text_chars):
    made = []
    for font in fonts:
        src = os.path.join(SRC_DIR, font + ".woff2")
        out = os.path.join(OUT_DIR, "%s-%s.woff2" % (page, font.replace("noto-", "")))
        txt = os.path.join(OUT_DIR, ".chars.tmp")
        with open(txt, "w", encoding="utf-8") as fh:
            fh.write("".join(sorted(text_chars)))
        subprocess.run(["pyftsubset", src, "--text-file=" + txt, "--flavor=woff2",
                        "--layout-features=*", "--output-file=" + out], check=True)
        os.remove(txt)
        made.append((out, os.path.getsize(src), os.path.getsize(out)))
    return made


def main():
    from fontTools.ttLib import TTFont
    os.makedirs(OUT_DIR, exist_ok=True)
    grand_old = grand_new = 0
    problems = []
    for page, fonts in PAGES.items():
        used = set(c for c in rendered_text(os.path.join(ROOT, page + ".html")) if c.strip())
        cover = TTFont(os.path.join(SRC_DIR, fonts[0] + ".woff2")).getBestCmap()
        # 母檔沒有的字：收不進子集，網頁上會改用系統字顯示，值得回報
        missing = sorted(c for c in used if ord(c) > 0x2E80 and ord(c) not in cover)
        if missing:
            problems.append((page, "".join(missing)))
        # 保險字元只收母檔真的有的，避免白白放大子集
        chars = used | set(c for c in ALWAYS if ord(c) in cover)
        old = new = 0
        for path, a, b in build(page, fonts, chars):
            old += a; new += b
            print("  %-46s %6.1f KB" % (os.path.relpath(path, ROOT), b / 1024))
        grand_old += old; grand_new += new
        print("%-9s %4d 字　%6.1f KB -> %6.1f KB\n" % (page, len(chars), old / 1024, new / 1024))
    print("全站合計 %.1f KB -> %.1f KB" % (grand_old / 1024, grand_new / 1024))
    for page, chs in problems:
        print("⚠ %s 有母檔沒收錄的字，會用系統字顯示：%s" % (page, chs), file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
