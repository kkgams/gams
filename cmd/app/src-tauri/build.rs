fn main() {
    let date_script = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../scripts/build-date.py");
    println!("cargo:rerun-if-changed={}", date_script.display());
    println!("cargo:rerun-if-env-changed=GAMS_BUILD_DATE");
    let output = std::process::Command::new("python3")
        .arg(&date_script)
        .arg("--script")
        .output()
        .expect("Python 3 is required to bake the app release date");
    assert!(
        output.status.success(),
        "failed to bake app release date: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let target = std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo sets OUT_DIR"))
        .join("release-date.js");
    std::fs::write(target, output.stdout).expect("failed to write app release date");

    let msvc = std::env::var("CARGO_CFG_TARGET_OS").expect("Cargo sets the target OS") == "windows"
        && std::env::var("CARGO_CFG_TARGET_ENV").expect("Cargo sets the target environment") == "msvc";
    let mut attributes = tauri_build::Attributes::new();
    if msvc {
        // Keep Tauri's icon/version resources, but generate the manifest once
        // through the linker for app, library-test and integration executables.
        // Tauri's default app-only copy would duplicate that manifest resource.
        attributes = attributes.windows_attributes(
            tauri_build::WindowsAttributes::new_without_app_manifest(),
        );
    }
    tauri_build::try_build(attributes).expect("failed to prepare native application resources");
    if msvc {
        // Tauri's UI imports require Common Controls v6 before Rust main runs,
        // even when a REPL/test harness never opens a window.
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
}
