// スパイク #4: 音声・動画のファイルを macOS 26 の SpeechAnalyzer で文字起こしする（ADR-0070 の下調べ）。
// この Mac の中だけで動く。言語データのダウンロードはしない（足りなければ失敗して知らせる）。
//
//   swift transcribe.swift <入力> <出力.txt>
//
// 出力は「[mm:ss] 文」を 1 行ずつ。かかった時間を標準エラーに出す
import AVFoundation
import Foundation
import Speech

let args = CommandLine.arguments
guard args.count == 3 else {
    FileHandle.standardError.write("使い方: swift transcribe.swift <入力> <出力.txt>\n".data(using: .utf8)!)
    exit(2)
}
let input = URL(fileURLWithPath: args[1])
let output = URL(fileURLWithPath: args[2])

func stamp(_ time: CMTime) -> String {
    let seconds = Int(time.seconds.rounded(.down))
    return String(format: "%02d:%02d", seconds / 60, seconds % 60)
}

let started = Date()
guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: "ja-JP")) else {
    print("ja-JP は対応外"); exit(1)
}
let transcriber = SpeechTranscriber(
    locale: locale,
    transcriptionOptions: [],
    reportingOptions: [],
    attributeOptions: [.audioTimeRange]
)
let analyzer = SpeechAnalyzer(modules: [transcriber])
let file = try AVAudioFile(forReading: input)
print("長さ: \(Double(file.length) / file.fileFormat.sampleRate) 秒")

let collect = Task {
    var lines: [String] = []
    for try await result in transcriber.results {
        let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { continue }
        lines.append("[\(stamp(result.range.start))] \(text)")
    }
    return lines
}
if let last = try await analyzer.analyzeSequence(from: file) {
    try await analyzer.finalizeAndFinish(through: last)
} else {
    await analyzer.cancelAndFinishNow()
}
let lines = try await collect.value
try (lines.joined(separator: "\n") + "\n").write(to: output, atomically: true, encoding: .utf8)
let elapsed = Date().timeIntervalSince(started)
print("文字起こし: \(String(format: "%.1f", elapsed)) 秒 / \(lines.count) 区切り / \(lines.joined().count) 字")
