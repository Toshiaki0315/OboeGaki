// アプリのアイコンの元絵（1024px PNG）を描く。
//
//     make icon   （= swift scripts/make_icon.swift && npx tauri icon …）
//
// 参照実装 hitofude/scripts/make_icon.py（PySide6）の移植。外部の画像編集
// ソフトも Python の依存も要らないよう、macOS の CoreGraphics だけで描く
// （.icns を作れるのは macOS だけなので、ここが macOS 専用でも損はない）。
//
// デザインは「覚書」— 角を折ったメモ用紙に、墨の題と本文の線、書き始めの
// 朱点。**紙の縁に薄い線を引く**（2026-09-10）: 「について」の窓や Finder の
// 白い地では、紙の白が地の白に溶けて絵の境が消えていた。

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let size: CGFloat = 1024
let output = CommandLine.arguments.dropFirst().first ?? "src-tauri/icons/icon-source.png"

func color(_ hex: String) -> CGColor {
    var value: UInt64 = 0
    Scanner(string: String(hex.dropFirst())).scanHexInt64(&value)
    let r = CGFloat((value >> 16) & 0xff) / 255
    let g = CGFloat((value >> 8) & 0xff) / 255
    let b = CGFloat(value & 0xff) / 255
    return CGColor(colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!, components: [r, g, b, 1])!
}

let paper = color("#F8F5EC")   // 紙。旧 #FCFBF7 より一段だけ落とす
let edge = color("#CFC8B8")    // 紙の縁の線（白い地との境）
let fold = color("#E4DFD2")    // 折り返し
let ink = color("#1D1D1F")
let faint = color("#9A9AA0")
let accent = color("#D2553C")

let space = CGColorSpace(name: CGColorSpace.sRGB)!
let context = CGContext(
    data: nil, width: Int(size), height: Int(size), bitsPerComponent: 8, bytesPerRow: 0,
    space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
context.setAllowsAntialiasing(true)
context.setShouldAntialias(true)
// CoreGraphics は左下が原点。上下を返して Qt と同じ座標で描く
context.translateBy(x: 0, y: size)
context.scaleBy(x: 1, y: -1)

let inset = size * 0.06
let radius = size * 0.22
let left = inset, top = inset, right = size - inset, bottom = size - inset
let foldLen = size * 0.24

// 紙。右上の角だけ折り返しぶんを切り欠く
let body = CGMutablePath()
body.move(to: CGPoint(x: right - foldLen, y: top))
body.addLine(to: CGPoint(x: left + radius, y: top))
body.addQuadCurve(to: CGPoint(x: left, y: top + radius), control: CGPoint(x: left, y: top))
body.addLine(to: CGPoint(x: left, y: bottom - radius))
body.addQuadCurve(to: CGPoint(x: left + radius, y: bottom), control: CGPoint(x: left, y: bottom))
body.addLine(to: CGPoint(x: right - radius, y: bottom))
body.addQuadCurve(to: CGPoint(x: right, y: bottom - radius), control: CGPoint(x: right, y: bottom))
body.addLine(to: CGPoint(x: right, y: top + foldLen))
body.closeSubpath()
context.addPath(body)
context.setFillColor(paper)
context.fillPath()

// 折り返した角（覚書らしさの要）。紙より一段沈んだ色の三角
let ear = CGMutablePath()
ear.move(to: CGPoint(x: right - foldLen, y: top))
ear.addLine(to: CGPoint(x: right - foldLen, y: top + foldLen * 0.18))
ear.addQuadCurve(
    to: CGPoint(x: right - foldLen * 0.18, y: top + foldLen),
    control: CGPoint(x: right - foldLen, y: top + foldLen))
ear.addLine(to: CGPoint(x: right, y: top + foldLen))
ear.closeSubpath()
context.addPath(ear)
context.setFillColor(fold)
context.fillPath()

// 紙の縁の線。中身を描いたあと、紙と折り返しの外形にまとめて引く
let outline = CGMutablePath()
outline.addPath(body)
outline.move(to: CGPoint(x: right - foldLen, y: top))
outline.addLine(to: CGPoint(x: right - foldLen, y: top + foldLen * 0.18))
outline.addQuadCurve(
    to: CGPoint(x: right - foldLen * 0.18, y: top + foldLen),
    control: CGPoint(x: right - foldLen, y: top + foldLen))
outline.addLine(to: CGPoint(x: right, y: top + foldLen))
context.addPath(outline)
context.setStrokeColor(edge)
context.setLineWidth(size * 0.016)
context.setLineJoin(.round)
context.strokePath()

func line(_ from: CGPoint, _ to: CGPoint, width: CGFloat, _ stroke: CGColor) {
    context.setStrokeColor(stroke)
    context.setLineWidth(width)
    context.setLineCap(.round)
    context.move(to: from)
    context.addLine(to: to)
    context.strokePath()
}

// 題の墨線。始点を丸く置いて筆の含みを残す
line(CGPoint(x: size * 0.40, y: size * 0.36), CGPoint(x: size * 0.62, y: size * 0.36), width: size * 0.075, ink)
// 本文の線。薄くして題と読み分ける
line(CGPoint(x: size * 0.26, y: size * 0.54), CGPoint(x: size * 0.74, y: size * 0.54), width: size * 0.055, faint)
line(CGPoint(x: size * 0.26, y: size * 0.70), CGPoint(x: size * 0.60, y: size * 0.70), width: size * 0.055, faint)
// 書き始めの朱点。題の頭に置く
context.setFillColor(accent)
let dot = size * 0.055
context.fillEllipse(in: CGRect(x: size * 0.28 - dot, y: size * 0.36 - dot, width: dot * 2, height: dot * 2))

let image = context.makeImage()!
let url = URL(fileURLWithPath: output)
let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else {
    FileHandle.standardError.write("PNG を書けなかった: \(output)\n".data(using: .utf8)!)
    exit(1)
}
print("\(output): \(Int(size))px")
