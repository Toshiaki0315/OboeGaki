// 取り込みを試す PDF の見本を作る（要望 2026-09-13。`make samples` から）。
//
// **文字と絵の両方が入った PDF** が要る — 文字だけなら PDFKit の抜き出しが
// 効き、絵だけなら OCR に回る（ADR-0041）。その分かれ目を試せるように、
// 1 ページ目は文字、2 ページ目は文字と絵、3 ページ目は**絵だけ**にする。
//
// 使い方: swift scripts/make-sample-pdf.swift <出力先> <埋め込む絵>

import CoreGraphics
import CoreText
import Foundation
import ImageIO

let arguments = CommandLine.arguments
guard arguments.count >= 3 else {
    FileHandle.standardError.write("使い方: make-sample-pdf.swift <out.pdf> <image.png>\n".data(using: .utf8)!)
    exit(2)
}
let out = URL(fileURLWithPath: arguments[1])
let imageURL = URL(fileURLWithPath: arguments[2])

let pageWidth: CGFloat = 595  // A4（ポイント）
let pageHeight: CGFloat = 842
var mediaBox = CGRect(x: 0, y: 0, width: pageWidth, height: pageHeight)

guard let context = CGContext(out as CFURL, mediaBox: &mediaBox, nil) else {
    FileHandle.standardError.write("PDF を作れない\n".data(using: .utf8)!)
    exit(1)
}

/// 日本語の入る書体で 1 行描く
func draw(_ text: String, at point: CGPoint, size: CGFloat, bold: Bool = false) {
    let font = CTFontCreateWithName(
        (bold ? "HiraginoSans-W6" : "HiraginoSans-W3") as CFString, size, nil)
    let line = CTLineCreateWithAttributedString(
        NSAttributedString(string: text, attributes: [
            kCTFontAttributeName as NSAttributedString.Key: font,
            kCTForegroundColorAttributeName as NSAttributedString.Key:
                CGColor(red: 0.12, green: 0.15, blue: 0.27, alpha: 1),
        ]))
    context.textPosition = point
    CTLineDraw(line, context)
}

func page(_ body: () -> Void) {
    context.beginPDFPage(nil)
    context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    context.fill(mediaBox)
    body()
    context.endPDFPage()
}

// 1 ページ目: 文字だけ（抜き出しが効く側）
page {
    draw("PDF の見本", at: CGPoint(x: 60, y: pageHeight - 90), size: 28, bold: true)
    draw("おぼえがきの取り込みを試すための資料です。", at: CGPoint(x: 60, y: pageHeight - 140), size: 14)
    draw("1 ページ目は文字だけ。PDFKit の抜き出しがそのまま効きます。", at: CGPoint(x: 60, y: pageHeight - 170), size: 14)
    draw("・箇条書きに見える行", at: CGPoint(x: 60, y: pageHeight - 210), size: 14)
    draw("・行の折り返しを試すための、少し長めの行をここに置いておきます。", at: CGPoint(x: 60, y: pageHeight - 235), size: 14)
    draw("1", at: CGPoint(x: pageWidth / 2, y: 50), size: 11)  // ページ番号（落とされる側）
}

// 2 ページ目: 文字と絵
page {
    draw("絵の入ったページ", at: CGPoint(x: 60, y: pageHeight - 90), size: 22, bold: true)
    draw("下の絵は埋め込みです。文字と一緒に入っている PDF を試せます。", at: CGPoint(x: 60, y: pageHeight - 130), size: 14)
    if let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
       let image = CGImageSourceCreateImageAtIndex(source, 0, nil) {
        let width: CGFloat = 400
        let height = width * CGFloat(image.height) / CGFloat(image.width)
        context.draw(image, in: CGRect(x: 60, y: pageHeight - 180 - height, width: width, height: height))
    }
    draw("2", at: CGPoint(x: pageWidth / 2, y: 50), size: 11)
}

// 3 ページ目: 絵だけ（OCR に回る側 = ADR-0041）
page {
    if let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
       let image = CGImageSourceCreateImageAtIndex(source, 0, nil) {
        let width: CGFloat = 460
        let height = width * CGFloat(image.height) / CGFloat(image.width)
        context.draw(image, in: CGRect(x: 60, y: pageHeight / 2 - height / 2, width: width, height: height))
    }
}

context.closePDF()
print(out.lastPathComponent)
