// PDF のページを絵にして読む（実機報告 2026-09-05）。
//
// **絵だけの PDF は文字の層を持たない。** macOS が作る「印刷 → PDF」や
// 取り込んだ紙がそれで、pdf.js は 0 文字を返す。そこは読み取り（OCR）に
// 回すしかない。
//
// **絵にするのは画面ではなく Rust の仕事**（T3）。WebView 側で描くには
// pdf.js のワーカーと canvas が要り、そこが動かないと**読み取りに辿り着く
// 前に終わる**。macOS は CoreGraphics で PDF を描けるので、同じ機械の中で
// 完結させる（参照実装も QtPdf で描いてから読み取りに回していた）。

/// 絵にするときの横幅（画素）。実測では A4 相当を 1,600px で読めている。
const PAGE_WIDTH: f64 = 1600.0;

/// ページ数。読めなければ 0。
#[cfg(target_os = "macos")]
pub fn page_count(bytes: &[u8]) -> usize {
    document(bytes).map_or(0, |pdf| {
        objc2_core_graphics::CGPDFDocument::number_of_pages(Some(&pdf))
    })
}

/// そのページ（1 始まり）を絵にして文字を読む。読めなければ空。
#[cfg(target_os = "macos")]
pub fn read_page(bytes: &[u8], page: usize) -> String {
    match render(bytes, page) {
        Some(image) => crate::ocr::recognize_image(&image),
        None => String::new(),
    }
}

/// PDF を開く。**壊れていても落とさない**（読めないことは壊れることではない）。
#[cfg(target_os = "macos")]
fn document(
    bytes: &[u8],
) -> Option<objc2_core_foundation::CFRetained<objc2_core_graphics::CGPDFDocument>> {
    use objc2_core_foundation::CFData;
    use objc2_core_graphics::{CGDataProvider, CGPDFDocument};
    let data = CFData::from_bytes(bytes);
    let provider = CGDataProvider::with_cf_data(Some(&data))?;
    let pdf = CGPDFDocument::with_provider(Some(&provider))?;
    // 鍵の掛かった PDF は開けても中身が出ない。読めないものとして扱う
    if CGPDFDocument::is_encrypted(Some(&pdf)) && !CGPDFDocument::is_unlocked(Some(&pdf)) {
        return None;
    }
    Some(pdf)
}

/// ページを白地の絵にする。
#[cfg(target_os = "macos")]
fn render(
    bytes: &[u8],
    page: usize,
) -> Option<objc2_core_foundation::CFRetained<objc2_core_graphics::CGImage>> {
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_core_graphics::{
        CGBitmapContextCreate, CGBitmapContextCreateImage, CGColorSpace, CGContext,
        CGImageAlphaInfo, CGPDFBox, CGPDFDocument, CGPDFPage,
    };

    let pdf = document(bytes)?;
    let target = CGPDFDocument::page(Some(&pdf), page)?;
    let media = CGPDFPage::box_rect(Some(&target), CGPDFBox::MediaBox);
    if media.size.width <= 0.0 || media.size.height <= 0.0 {
        return None;
    }
    let scale = PAGE_WIDTH / media.size.width;
    let width = (media.size.width * scale).round().max(1.0) as usize;
    let height = (media.size.height * scale).round().max(1.0) as usize;

    let space = CGColorSpace::new_device_rgb()?;
    let context = unsafe {
        CGBitmapContextCreate(
            std::ptr::null_mut(), // 置き場は CoreGraphics に任せる
            width,
            height,
            8,
            0,
            Some(&space),
            CGImageAlphaInfo::NoneSkipLast.0,
        )
    }?;

    // **白で塗ってから描く。** PDF の地は透明で、そのままだと黒地になり、
    // 黒い文字が読めない
    CGContext::set_rgb_fill_color(Some(&context), 1.0, 1.0, 1.0, 1.0);
    CGContext::fill_rect(
        Some(&context),
        CGRect::new(
            CGPoint::new(0.0, 0.0),
            CGSize::new(width as f64, height as f64),
        ),
    );
    CGContext::scale_ctm(Some(&context), scale, scale);
    CGContext::translate_ctm(Some(&context), -media.origin.x, -media.origin.y);
    CGContext::draw_pdf_page(Some(&context), Some(&target));
    CGBitmapContextCreateImage(Some(&context))
}

#[cfg(not(target_os = "macos"))]
pub fn page_count(_bytes: &[u8]) -> usize {
    0
}

#[cfg(not(target_os = "macos"))]
pub fn read_page(_bytes: &[u8], _page: usize) -> String {
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 絵だけの PDF（macOS の「印刷 → PDF」。実機報告 2026-09-05 の実物）。
    /// **文字の層が無い**ので、ここを読めるかどうかが取り込みの成否を分ける。
    const IMAGE_ONLY: &[u8] = include_bytes!("../../fixtures/image-only.pdf");

    #[test]
    fn test_絵だけのPDFでもページ数が数えられる() {
        assert_eq!(page_count(IMAGE_ONLY), 1);
    }

    #[test]
    fn test_絵だけのPDFから文字を読む() {
        // 画面（pdf.js）を通さずに、絵にして読み取れること
        let text = read_page(IMAGE_ONLY, 1);
        assert!(
            text.chars().count() > 100,
            "読めた文字数: {}",
            text.chars().count()
        );
        assert!(text.contains("テンプレート"));
    }

    #[test]
    fn test_無いページは空() {
        assert_eq!(read_page(IMAGE_ONLY, 99), "");
        assert_eq!(read_page(IMAGE_ONLY, 0), "");
    }

    #[test]
    fn test_pdfでなければ0ページ() {
        // 読めないことは壊れることではない（F-2 と同じ約束）
        let not_pdf = "これは PDF ではない".as_bytes();
        assert_eq!(page_count(not_pdf), 0);
        assert_eq!(read_page(not_pdf, 1), "");
    }
}
