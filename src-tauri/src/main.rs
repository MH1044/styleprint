// Voicebox desktop shell: spawns the existing Express+SQLite server as a
// child process (same code as `npm run dev`, just run from the bundle this
// installer ships), waits for it to come up, then opens one window pointed
// at it. No Rust reimplementation of app logic — the server is the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::process::{Command, Stdio};
use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const PORT: u16 = 47821;

/// `resource_dir()` returns a Windows extended-length (`\\?\`-prefixed) path.
/// Node's own file APIs handle that fine, but its CLI entry-point resolver
/// does not — passing a `\\?\C:\...` path as the script argument makes it
/// mis-parse the drive letter and fail with EISDIR on "C:". Strip the prefix
/// for this one use; it's a no-op on non-Windows paths.
fn strip_verbatim_prefix(path: &std::path::Path) -> String {
    let s = path.to_string_lossy().to_string();
    s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();

            let resource_dir = handle
                .path()
                .resource_dir()
                .expect("could not resolve resource directory");
            let server_entry = resource_dir.join("server").join("index.mjs");

            if !server_entry.exists() {
                panic!("bundled server not found at {}", server_entry.display());
            }

            let mut child = Command::new("node")
                .arg(strip_verbatim_prefix(&server_entry))
                .env("PORT", PORT.to_string())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .expect("failed to start the bundled server (is Node.js installed?)");

            if let Some(stdout) = child.stdout.take() {
                std::thread::spawn(move || {
                    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                        println!("[server] {line}");
                    }
                });
            }
            if let Some(stderr) = child.stderr.take() {
                std::thread::spawn(move || {
                    for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                        eprintln!("[server] {line}");
                    }
                });
            }

            let handle_for_window = handle.clone();
            std::thread::spawn(move || {
                for _ in 0..150 {
                    if TcpStream::connect(("127.0.0.1", PORT)).is_ok() {
                        let url = format!("http://127.0.0.1:{PORT}");
                        WebviewWindowBuilder::new(
                            &handle_for_window,
                            "main",
                            WebviewUrl::External(url.parse().expect("invalid server URL")),
                        )
                        .title("Voicebox")
                        .inner_size(1200.0, 820.0)
                        .min_inner_size(800.0, 600.0)
                        .build()
                        .expect("failed to open the main window");
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
                eprintln!("the bundled server did not start within 30 seconds");
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Voicebox application");
}
