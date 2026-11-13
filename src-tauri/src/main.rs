// Styleprint desktop shell: runs the bundled Express+SQLite server on the
// Node.js runtime the installer ships next to the app (a Tauri sidecar,
// fetched at build time by scripts/fetch-node.mjs), shows a startup page
// while it comes up, then points the window at it. No Rust reimplementation
// of app logic — the server is the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// The app's usual port. Keeping it fixed keeps the window's origin, and with
/// it the UI's saved settings, the same from one launch to the next.
const PREFERRED_PORT: u16 = 47821;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
const STDERR_TAIL_LINES: usize = 40;

/// The running server, stopped when the app exits.
struct ServerProcess(Mutex<Option<Child>>);

/// What the shell needs to find and recognise the server it started.
struct ServerInfo {
    port: u16,
    instance: String,
    stderr_tail: Arc<Mutex<VecDeque<String>>>,
}

impl ServerInfo {
    fn stderr_tail(&self) -> String {
        let tail = self.stderr_tail.lock().unwrap();
        tail.iter().cloned().collect::<Vec<_>>().join("\n")
    }
}

/// A failure to start, as shown on the startup page.
struct StartupError {
    message: String,
    details: String,
}

impl StartupError {
    fn new(message: impl Into<String>, details: impl Into<String>) -> Self {
        Self { message: message.into(), details: details.into() }
    }

    fn help() -> &'static str {
        if cfg!(target_os = "macos") {
            "If you've just installed Styleprint, macOS may have blocked part of the app. \
             Open System Settings, then Privacy & Security, and choose Open Anyway; or run \
             `xattr -cr /Applications/Styleprint.app` in Terminal. Then open Styleprint again."
        } else if cfg!(windows) {
            "If your antivirus removed or blocked node.exe in the Styleprint folder, restore it \
             or reinstall Styleprint, then open it again."
        } else {
            "Try closing Styleprint and opening it again."
        }
    }

    fn to_json(&self) -> String {
        serde_json::json!({ "message": self.message, "details": self.details, "help": Self::help() }).to_string()
    }
}

/// `resource_dir()` returns a Windows extended-length (`\\?\`-prefixed) path.
/// Node's own file APIs handle that fine, but its CLI entry-point resolver
/// does not — passing a `\\?\C:\...` path as the script argument makes it
/// mis-parse the drive letter and fail with EISDIR on "C:". Strip the prefix
/// for this one use; it's a no-op on non-Windows paths.
fn strip_verbatim_prefix(path: &Path) -> String {
    let s = path.to_string_lossy().to_string();
    s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s)
}

/// The Node.js runtime bundled with the app. Tauri installs `externalBin`
/// sidecars next to the app's own executable, with the target triple
/// dropped from the name: Contents/MacOS/node inside the .app, node.exe
/// beside styleprint.exe on Windows.
fn bundled_node() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("could not locate the app executable: {e}"))?;
    let dir = exe.parent().ok_or("the app executable has no parent directory")?;
    let node = dir.join(if cfg!(windows) { "node.exe" } else { "node" });
    if node.exists() {
        Ok(node)
    } else {
        Err(format!("the bundled Node.js runtime is missing from {}", node.display()))
    }
}

fn server_entry(resource_dir: &Path) -> Result<PathBuf, String> {
    let entry = resource_dir.join("server").join("index.mjs");
    if entry.exists() {
        Ok(entry)
    } else {
        Err(format!("the bundled server is missing from {}", entry.display()))
    }
}

/// `node` on the bundled runtime, without a console window on Windows (the
/// app itself is a GUI program, so a console child would pop one up).
fn node_command(node: &Path) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(node);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn free_port() -> Result<u16, String> {
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|addr| addr.port())
        .map_err(|e| format!("could not find a free local port: {e}"))
}

/// The usual port if it's free, otherwise any free one for this session.
fn choose_port() -> Result<u16, String> {
    if TcpListener::bind(("127.0.0.1", PREFERRED_PORT)).is_ok() {
        Ok(PREFERRED_PORT)
    } else {
        free_port()
    }
}

fn instance_token() -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:x}-{:x}", std::process::id(), nanos)
}

/// Starts the server on the bundled runtime, listening on 127.0.0.1 only.
/// Its stdin stays piped and open for as long as the returned `Child` lives;
/// the server exits when that pipe closes (STYLEPRINT_EXIT_WITH_PARENT), so
/// it can't outlive the app even if the app is force-quit.
fn spawn_server(node: &Path, entry: &Path, port: u16, home: Option<&Path>) -> Result<(Child, ServerInfo), String> {
    let instance = instance_token();
    let mut command = node_command(node);
    command
        .arg(strip_verbatim_prefix(entry))
        .env("PORT", port.to_string())
        .env("STYLEPRINT_HOST", "127.0.0.1")
        .env("STYLEPRINT_INSTANCE", &instance)
        .env("STYLEPRINT_EXIT_WITH_PARENT", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(home) = home {
        command.env("STYLEPRINT_HOME", home);
    }
    let mut child = command.spawn().map_err(|e| format!("could not run {}: {e}", node.display()))?;

    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                println!("[server] {line}");
            }
        });
    }
    let stderr_tail = Arc::new(Mutex::new(VecDeque::new()));
    if let Some(stderr) = child.stderr.take() {
        let tail = Arc::clone(&stderr_tail);
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                eprintln!("[server] {line}");
                let mut tail = tail.lock().unwrap();
                if tail.len() == STDERR_TAIL_LINES {
                    tail.pop_front();
                }
                tail.push_back(line);
            }
        });
    }
    Ok((child, ServerInfo { port, instance, stderr_tail }))
}

/// A minimal HTTP/1.1 GET against the local server: (status, body).
fn http_get(port: u16, path: &str) -> std::io::Result<(u16, String)> {
    let mut stream = TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_secs(2))?;
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    write!(stream, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n")?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    let status = response.split(' ').nth(1).and_then(|code| code.parse().ok()).unwrap_or(0);
    let body = response.split_once("\r\n\r\n").map(|(_, body)| body.to_string()).unwrap_or_default();
    Ok((status, body))
}

/// Waits until this server, and not anything else that happens to hold the
/// port, answers /health with the instance token it was started with.
fn wait_until_ready(child: &Mutex<Option<Child>>, server: &ServerInfo) -> Result<(), StartupError> {
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    let expected = format!("\"instance\":\"{}\"", server.instance);
    loop {
        let exited = child.lock().unwrap().as_mut().and_then(|c| c.try_wait().ok().flatten());
        if let Some(status) = exited {
            // Let the stderr relay catch up with the last lines it printed.
            std::thread::sleep(Duration::from_millis(300));
            return Err(StartupError::new(
                format!("The Styleprint server stopped while starting ({status})."),
                server.stderr_tail(),
            ));
        }
        if let Ok((200, body)) = http_get(server.port, "/health") {
            if body.contains(&expected) {
                return Ok(());
            }
        }
        if Instant::now() > deadline {
            return Err(StartupError::new(
                format!("The Styleprint server did not start within {} seconds.", STARTUP_TIMEOUT.as_secs()),
                server.stderr_tail(),
            ));
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// Resolves the bundled runtime and server, starts it, and hands the child to
/// app state so it's stopped on exit.
fn start_server(handle: &AppHandle) -> Result<ServerInfo, StartupError> {
    let resource_dir = handle
        .path()
        .resource_dir()
        .map_err(|e| StartupError::new("Styleprint could not find its own files.", e.to_string()))?;
    let entry = server_entry(&resource_dir).map_err(|e| StartupError::new("Styleprint's installation is incomplete.", e))?;
    let node = bundled_node().map_err(|e| StartupError::new("Styleprint's installation is incomplete.", e))?;
    let port = choose_port().map_err(|e| StartupError::new("Styleprint could not start its local server.", e))?;
    let (child, info) = spawn_server(&node, &entry, port, None)
        .map_err(|e| StartupError::new("Styleprint could not start its local server.", e))?;
    *handle.state::<ServerProcess>().0.lock().unwrap() = Some(child);
    Ok(info)
}

fn stop_server(handle: &AppHandle) {
    if let Some(state) = handle.try_state::<ServerProcess>() {
        if let Some(mut child) = state.0.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn show_startup_error(window: &WebviewWindow, error: &StartupError) {
    let json = error.to_json();
    let _ = window.eval(&format!(
        "window.__STYLEPRINT_STARTUP_ERROR__ = {json}; if (window.showStartupError) window.showStartupError({json});"
    ));
}

fn main() {
    // Builder check for the publik API wiring: `PUBLIK_SELF_TEST=1 styleprint.exe`
    // runs the bundled server's own self-test and exits, no window. See
    // https://publikhq.com/skills/setup.md step 6 — this proves the real,
    // built release artifact calls publik, not a dev server or a script.
    if std::env::var_os("PUBLIK_SELF_TEST").is_some() {
        std::process::exit(run_self_test());
    }
    // Release check for an installed copy, run in CI against every installer:
    // `STYLEPRINT_SMOKE_TEST=1 styleprint.exe`. No publik call, no window.
    if std::env::var_os("STYLEPRINT_SMOKE_TEST").is_some() {
        std::process::exit(run_smoke_test());
    }

    let app = tauri::Builder::default()
        .setup(|app| {
            app.manage(ServerProcess(Mutex::new(None)));
            let handle = app.handle().clone();
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Styleprint")
                .inner_size(1200.0, 820.0)
                .min_inner_size(800.0, 600.0);

            match start_server(&handle) {
                Ok(server) => {
                    let window = builder.build()?;
                    std::thread::spawn(move || {
                        let state = handle.state::<ServerProcess>();
                        match wait_until_ready(&state.0, &server) {
                            Ok(()) => {
                                let url = format!("http://127.0.0.1:{}", server.port);
                                if let Ok(url) = tauri::Url::parse(&url) {
                                    let _ = window.navigate(url);
                                }
                            }
                            Err(error) => show_startup_error(&window, &error),
                        }
                    });
                }
                Err(error) => {
                    builder
                        .initialization_script(format!("window.__STYLEPRINT_STARTUP_ERROR__ = {};", error.to_json()))
                        .build()?;
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Styleprint application");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            stop_server(handle);
        }
    });
}

/// The resource directory, resolved the same way the real app does (so it
/// matches the macOS .app layout too, not just Windows), without starting the
/// event loop or opening a window.
fn resource_dir_without_window() -> Result<PathBuf, String> {
    let app = tauri::Builder::default()
        .build(tauri::generate_context!())
        .map_err(|e| format!("could not initialise the app context: {e}"))?;
    app.path().resource_dir().map_err(|e| format!("could not resolve the resource directory: {e}"))
}

/// Runs the bundled server with PUBLIK_SELF_TEST=1 and relays its exit code.
fn run_self_test() -> i32 {
    let paths = resource_dir_without_window().and_then(|dir| Ok((bundled_node()?, server_entry(&dir)?)));
    let (node, entry) = match paths {
        Ok(paths) => paths,
        Err(e) => {
            eprintln!("publik self-test: failed: {e}");
            return 1;
        }
    };
    match node_command(&node).arg(strip_verbatim_prefix(&entry)).env("PUBLIK_SELF_TEST", "1").status() {
        Ok(status) => status.code().unwrap_or(1),
        Err(e) => {
            eprintln!("publik self-test: failed: could not run {}: {e}", node.display());
            1
        }
    }
}

fn run_smoke_test() -> i32 {
    match smoke_test() {
        Ok(runtime) => {
            println!("smoke test: ok (Node.js {runtime})");
            0
        }
        Err(e) => {
            eprintln!("smoke test: failed: {e}");
            1
        }
    }
}

/// Starts the bundled server on the bundled runtime exactly as a launch would,
/// but on a free port and a throwaway data folder, then checks that it
/// answers, can open its SQLite database (the one native module), and serves
/// the UI.
fn smoke_test() -> Result<String, String> {
    let resource_dir = resource_dir_without_window()?;
    let node = bundled_node()?;
    let entry = server_entry(&resource_dir)?;

    let output = node_command(&node)
        .args(["-p", "process.version + ' ' + process.platform + '-' + process.arch"])
        .output()
        .map_err(|e| format!("could not run {}: {e}", node.display()))?;
    if !output.status.success() {
        return Err(format!("the bundled Node.js failed to run: {}", String::from_utf8_lossy(&output.stderr)));
    }
    let runtime = String::from_utf8_lossy(&output.stdout).trim().to_string();
    println!("smoke test: bundled Node.js {runtime} at {}", node.display());

    let home = std::env::temp_dir().join(format!("styleprint-smoke-{}", std::process::id()));
    let port = free_port()?;
    let (child, info) = spawn_server(&node, &entry, port, Some(&home))?;
    let child = Mutex::new(Some(child));

    let expect = |path: &str, what: &str, ok: &dyn Fn(&str) -> bool| -> Result<(), String> {
        match http_get(port, path) {
            Ok((200, body)) if ok(&body) => {
                println!("smoke test: {what} ok");
                Ok(())
            }
            Ok((status, body)) => Err(format!("{what}: GET {path} returned {status}: {}", body.chars().take(300).collect::<String>())),
            Err(e) => Err(format!("{what}: GET {path} failed: {e}")),
        }
    };
    let result = wait_until_ready(&child, &info)
        .map_err(|e| format!("{}\n{}", e.message, e.details))
        .and_then(|()| expect("/api/profiles", "database", &|body| body.trim_start().starts_with('[')))
        .and_then(|()| expect("/", "web UI", &|body| body.contains("<div id=\"root\">")));

    if let Some(mut child) = child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let _ = std::fs::remove_dir_all(&home);
    result.map(|()| runtime)
}
