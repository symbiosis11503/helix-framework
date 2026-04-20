use serde::Serialize;
use std::net::{SocketAddr, TcpStream};
use std::process::Command;
use std::time::Duration;

#[derive(Serialize)]
struct RuntimeStatus {
    reachable: bool,
    url: String,
}

#[tauri::command]
fn check_runtime() -> RuntimeStatus {
    let addr: SocketAddr = "127.0.0.1:18860".parse().expect("hardcoded runtime socket");
    let reachable = TcpStream::connect_timeout(&addr, Duration::from_millis(600)).is_ok();
    println!("[helix-desktop] check_runtime reachable={}", reachable);
    RuntimeStatus {
        reachable,
        url: "http://127.0.0.1:18860/v2/".to_string(),
    }
}

#[tauri::command]
fn open_in_browser(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(&url);
        c
    };

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/C", "start", "", &url]);
        c
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(&url);
        c
    };

    let status = cmd.status().map_err(|e| format!("spawn failed: {}", e))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("browser command exited with status {}", status))
    }
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![check_runtime, open_in_browser])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
