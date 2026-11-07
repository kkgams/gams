fn main() {
    tauri_build::build();
    if std::env::var("CARGO_CFG_TARGET_OS").expect("Cargo sets the target OS") == "windows"
        && std::env::var("CARGO_CFG_TARGET_ENV").expect("Cargo sets the target environment") == "msvc"
    {
        // Cargo's library/integration test executables do not inherit Tauri's
        // application resource. Its UI imports require Common Controls v6 even
        // when a harness never opens a window. Cover all linked target kinds.
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
}
