fn main() {
    // 「について」に出すビルド日時（要望 2026-09-10）。`make app` / `make dmg` が
    // 環境変数で渡す。渡されなければ開発版（`cargo tauri dev` / `cargo test`）。
    // env が変わったときだけ組み直す — 毎回組み直すと check が遅くなる
    println!("cargo:rerun-if-env-changed=OBOEGAKI_BUILD_TIME");
    let stamp = std::env::var("OBOEGAKI_BUILD_TIME").unwrap_or_else(|_| "開発版".to_string());
    println!("cargo:rustc-env=OBOEGAKI_BUILD_TIME={stamp}");
    tauri_build::build()
}
