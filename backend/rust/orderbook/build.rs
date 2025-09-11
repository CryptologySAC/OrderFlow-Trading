use std::env;
use std::path::Path;

fn main() {
    // Build the native Node.js addon
    let out_dir = env::var("OUT_DIR").unwrap();
    let target_dir = Path::new(&out_dir).parent().unwrap().parent().unwrap();
    let native_dir = target_dir.join("native");

    // Create native directory if it doesn't exist
    std::fs::create_dir_all(&native_dir).unwrap();

    // Copy the built library to the native directory
    let profile = env::var("PROFILE").unwrap();
    let lib_name = if cfg!(target_os = "windows") {
        "orderbook.dll"
    } else if cfg!(target_os = "macos") {
        "liborderbook.dylib"
    } else {
        "liborderbook.so"
    };

    let source_path = target_dir.join(&profile).join(&lib_name);
    let dest_path = native_dir.join("index.node");

    if source_path.exists() {
        std::fs::copy(&source_path, &dest_path).unwrap();
        println!("Copied {} to {}", source_path.display(), dest_path.display());
    } else {
        println!("Warning: {} not found", source_path.display());
    }

    // Tell cargo to rerun this build script if the source changes
    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=src/orderbook.rs");
    println!("cargo:rerun-if-changed=src/types.rs");
    println!("cargo:rerun-if-changed=src/financial_math.rs");
}