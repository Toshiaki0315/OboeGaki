// 画像から文字を読む（TASKS 4-7 / ADR-0027 の Tauri 版）。
//
// 参照実装は **Swift の小さな実行ファイルを同梱**していた。Python から
// Vision を呼ぶには pyobjc（30MB）が要り、それを断るための道具立てだった
// （実測: Swift 63KB で 0.85 秒・全文正しい / pyobjc はその場で結果が
// 返らなかった）。
//
// **Rust からは Vision を直に呼べる。** objc2 の束はもう依存の中にあり
// （wry が使っている）、`objc2-vision` を足すだけで同じ Vision に届く。
// 同梱物も、署名の対象も、`swiftc` の要る作り分けも増えない（ADR-0041）。
//
// **元のファイルは触らない。** 読み取った文字を返すだけで、書くのは
// 呼び出し側の仕事。

/// 読み取る言語（この順で当てる）。日本語の資料が主なので日本語が先。
const LANGUAGES: [&str; 2] = ["ja-JP", "en-US"];

/// 絵（CGImage）から文字を読む。**PDF のページを描いたものを渡す**
/// （pdf.rs）。バイト列に直さずに済むので、間に画像形式を挟まない。
#[cfg(target_os = "macos")]
pub fn recognize_image(image: &objc2_core_graphics::CGImage) -> String {
    use objc2::AllocAnyThread;
    use objc2_foundation::NSDictionary;
    use objc2_vision::VNImageRequestHandler;

    unsafe {
        let options = NSDictionary::new();
        let handler = VNImageRequestHandler::initWithCGImage_options(
            VNImageRequestHandler::alloc(),
            image,
            &options,
        );
        run(&handler)
    }
}

/// 画像のバイト列から文字を読む。読めなければ空文字。
///
/// **読めないことは壊れることではない**（F-2 と同じ約束）。画像で
/// なくても、文字が無くても、空を返して呼び出し側に知らせる。
#[cfg(target_os = "macos")]
pub fn recognize(image: &[u8]) -> String {
    use objc2::AllocAnyThread;
    use objc2_foundation::{NSData, NSDictionary};
    use objc2_vision::VNImageRequestHandler;

    let data = NSData::with_bytes(image);
    let options = NSDictionary::new();
    let handler = VNImageRequestHandler::initWithData_options(
        VNImageRequestHandler::alloc(),
        &data,
        &options,
    );
    run(&handler)
}

/// 読み取りを頼んで、返ってきた行を繋ぐ。**入口（バイト列 / 絵）が違っても
/// 頼み方は 1 つ**（言語も精度も揃えないと、経路で結果が変わる）。
#[cfg(target_os = "macos")]
fn run(handler: &objc2_vision::VNImageRequestHandler) -> String {
    use objc2::rc::Retained;
    use objc2_foundation::{NSArray, NSString};
    use objc2_vision::{VNRecognizeTextRequest, VNRequest, VNRequestTextRecognitionLevel};

    unsafe {
        let request = VNRecognizeTextRequest::new();
        // 速さより正しさ（会議メモの金額や日付を読み違えない）
        request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
        request.setUsesLanguageCorrection(true);
        let languages: Vec<Retained<NSString>> = LANGUAGES
            .iter()
            .map(|name| NSString::from_str(name))
            .collect();
        request.setRecognitionLanguages(&NSArray::from_retained_slice(&languages));

        let requests: Vec<Retained<VNRequest>> = vec![Retained::cast_unchecked(request.clone())];
        if handler
            .performRequests_error(&NSArray::from_retained_slice(&requests))
            .is_err()
        {
            return String::new();
        }

        let Some(results) = request.results() else {
            return String::new();
        };
        // **並びは Vision が返したまま。** 傾き補正も段組の解析もしない
        // （凝ると「元と違う順で読める」不具合を自分で作り込む）
        results
            .iter()
            .filter_map(|observation| {
                let candidates = observation.topCandidates(1);
                candidates
                    .firstObject()
                    .map(|text| text.string().to_string())
            })
            .collect::<Vec<String>>()
            .join("\n")
    }
}

#[cfg(not(target_os = "macos"))]
pub fn recognize(_image: &[u8]) -> String {
    // 読み手が無ければ「使えない」と答える（機能ごと畳む）
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 文字を書いた小さな絵（fixtures/ocr/text-sample.png）。
    /// **本物の読み手を通す**ためのもので、作り物では確かめられない
    /// （参照実装が「作り物のせいで試験をすり抜けた」と書いた穴）。
    fn sample_png() -> Vec<u8> {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../fixtures/ocr/text-sample.png");
        std::fs::read(path).expect("読み取り用の絵が要る")
    }

    #[test]
    fn test_recognize_書いた文字を読み取れる() {
        let text = recognize(&sample_png());
        // 読み取りは OS の版で揺れるので、**含まれるか**だけを見る
        assert!(
            text.contains("OboeGaki") || text.contains("2026"),
            "読み取れなかった: {text:?}"
        );
        assert!(text.contains("覚書"), "日本語を読み取れなかった: {text:?}");
    }

    #[test]
    fn test_recognize_速さを測る() {
        // ADR-0027 の実測（Swift の実行ファイルで 0.85 秒）と並べるため
        let image = sample_png();
        let started = std::time::Instant::now();
        let text = recognize(&image);
        let elapsed = started.elapsed();
        println!("読み取り: {elapsed:?} / {} 文字", text.chars().count());
        assert!(elapsed.as_secs() < 10, "遅すぎる: {elapsed:?}");
    }

    #[test]
    fn test_recognize_画像でなければ空() {
        // 読めないことは壊れることではない
        assert_eq!(recognize("これは画像ではない".as_bytes()), "");
    }
}
