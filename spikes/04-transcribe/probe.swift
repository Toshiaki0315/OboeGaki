// 日本語の文字起こし（SpeechTranscriber）が使えるか・言語データが入っているかを見るだけ。
// 何もダウンロードしない
import Foundation
import Speech

let locale = Locale(identifier: "ja-JP")
let supported = await SpeechTranscriber.supportedLocales
print("対応している日本語:", supported.filter { $0.identifier.hasPrefix("ja") }.map(\.identifier))
let installed = await SpeechTranscriber.installedLocales
print("入っている日本語:", installed.filter { $0.identifier.hasPrefix("ja") }.map(\.identifier))
if let equivalent = await SpeechTranscriber.supportedLocale(equivalentTo: locale) {
    let transcriber = SpeechTranscriber(locale: equivalent, preset: .transcription)
    let status = await AssetInventory.status(forModules: [transcriber])
    print("言語データの状態:", status)
} else {
    print("ja-JP は対応外")
}
