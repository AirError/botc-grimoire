"""Фрагмент PDF в PNG: python zoom_pdf.py file.pdf out.png x0 y0 x1 y1 (мм) [dpi]"""
import sys
import pymupdf

pdf, out, *box = sys.argv[1:]
dpi = int(box[4]) if len(box) > 4 else 140
mm = 72 / 25.4
page = pymupdf.open(pdf)[0]
x0, y0, x1, y1 = (float(v) * mm for v in box[:4])
page.get_pixmap(dpi=dpi, clip=pymupdf.Rect(x0, y0, x1, y1)).save(out)
