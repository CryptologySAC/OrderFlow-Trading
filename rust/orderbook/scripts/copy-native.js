const fs = require("fs");
const path = require("path");

// Ensure native directory exists
const nativeDir = path.join(__dirname, "..", "native");
if (!fs.existsSync(nativeDir)) {
    fs.mkdirSync(nativeDir, { recursive: true });
}

// Copy the built library (workspace build puts it in parent target directory)
const targetDir = path.join(__dirname, "..", "..", "target", "release");
const libName =
    process.platform === "win32"
        ? "orderbook.dll"
        : process.platform === "darwin"
          ? "liborderbook.dylib"
          : "liborderbook.so";

const sourcePath = path.join(targetDir, libName);
const destPath = path.join(nativeDir, "index.node");

if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, destPath);
    console.log(`Copied ${sourcePath} to ${destPath}`);
} else {
    console.error(`Source file not found: ${sourcePath}`);
    process.exit(1);
}
