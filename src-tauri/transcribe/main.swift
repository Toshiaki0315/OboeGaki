// 音声・動画の文字起こし（TASKS 28-1 / ADR-0070）。おぼえがきが子プロセスで呼ぶ。
//
// macOS 26 の SpeechAnalyzer（SpeechTranscriber・ja_JP）を**この Mac の中だけで**使う。
// Swift からしか呼べないので、Rust から直に呼べる Vision（ADR-0041）と違い、ここだけ Swift。
// Rust（transcribe.rs）とは標準出力のタブ区切りの行で話す:
//
//   duration<TAB>秒          … 最初に 1 回（進み具合の分母）
//   segment<TAB>秒<TAB>文    … 確定した区切りごと（文の中のタブと改行は空白にする）
//
// 終わり方（Rust の transcribe::Failure と揃える）:
//   0 = 済んだ / 2 = 使い方 / 3 = macOS 26 未満 / 4 = 日本語の言語データが無い /
//   5 = ファイルを読めない / 6 = 文字起こしに失敗
//
//   oboegaki-transcribe --probe         使えるかだけを見る（何もダウンロードしない）
//   oboegaki-transcribe <音声か動画>     文字起こし

import AVFoundation
import Foundation
import Speech

func fail(_ code: Int32, _ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(code)
}

func emit(_ line: String) {
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

@available(macOS 26, *)
func japanese() async -> Locale? {
    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: "ja-JP")) else {
        return nil
    }
    let installed = await SpeechTranscriber.installedLocales
    return installed.contains { $0.identifier(.bcp47) == locale.identifier(.bcp47) } ? locale : nil
}

/// 動画など AVAudioFile が直に読めない入れ物は、音声だけを一時の .m4a に書き出して読む
@available(macOS 26, *)
func audioFile(_ url: URL) async throws -> (AVAudioFile, URL?) {
    if let file = try? AVAudioFile(forReading: url) {
        return (file, nil)
    }
    let asset = AVURLAsset(url: url)
    guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
        fail(5, "音声を取り出せません: \(url.lastPathComponent)")
    }
    let temporary = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString)
        .appendingPathExtension("m4a")
    try await export.export(to: temporary, as: .m4a)
    return (try AVAudioFile(forReading: temporary), temporary)
}

@available(macOS 26, *)
func run(_ path: String) async {
    guard let locale = await japanese() else {
        fail(4, "日本語の音声認識の言語データが入っていません")
    }
    let url = URL(fileURLWithPath: path)
    let file: AVAudioFile
    let temporary: URL?
    do {
        (file, temporary) = try await audioFile(url)
    } catch {
        fail(5, "ファイルを読めません: \(error.localizedDescription)")
    }
    defer { if let temporary { try? FileManager.default.removeItem(at: temporary) } }
    emit("duration\t\(Double(file.length) / file.fileFormat.sampleRate)")

    let transcriber = SpeechTranscriber(
        locale: locale,
        transcriptionOptions: [],
        reportingOptions: [],
        attributeOptions: [.audioTimeRange]
    )
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    do {
        let collect = Task {
            for try await result in transcriber.results {
                let text = String(result.text.characters)
                    .replacingOccurrences(of: "\t", with: " ")
                    .replacingOccurrences(of: "\n", with: " ")
                    .trimmingCharacters(in: .whitespaces)
                if text.isEmpty { continue }
                emit("segment\t\(result.range.start.seconds)\t\(text)")
            }
        }
        if let last = try await analyzer.analyzeSequence(from: file) {
            try await analyzer.finalizeAndFinish(through: last)
        } else {
            await analyzer.cancelAndFinishNow()
        }
        try await collect.value
    } catch {
        fail(6, "文字起こしに失敗しました: \(error.localizedDescription)")
    }
}

@main
struct Transcribe {
    static func main() async {
        let args = CommandLine.arguments
        guard args.count == 2 else { fail(2, "使い方: oboegaki-transcribe --probe | <音声か動画>") }
        guard #available(macOS 26, *) else { fail(3, "文字起こしには macOS 26 以降が要ります") }
        if args[1] == "--probe" {
            guard await japanese() != nil else { fail(4, "日本語の音声認識の言語データが入っていません") }
            exit(0)
        }
        await run(args[1])
        exit(0)
    }
}
