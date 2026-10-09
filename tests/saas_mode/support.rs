//! Helpers shared by the SaaS end-to-end suites (`saas_mode_e2e`,
//! `saas_profile_isolation_e2e`): a deployment on a temp root, a real
//! `openhuman-core run --mode saas` child, signed gateway calls for a user,
//! their `/events` stream, and fake backends.

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

pub const BEARER: &str = "saas-e2e-gateway-bearer-0123456789abcdef";

/// Environment a developer machine may carry that would point the child at a
/// single user, or that the boot guard refuses outright.
pub const SCRUBBED_ENV: &[&str] = &[
    "OPENHUMAN_WORKSPACE",
    "OPENHUMAN_DEV_CONNECT",
    "OPENHUMAN_BACKEND_SESSION_TOKEN",
    "OPENHUMAN_BACKEND_API_KEY",
    "OPENHUMAN_CORE_TOKEN",
    "OPENHUMAN_APPROVAL_GATE",
    "OPENHUMAN_SANDBOX",
    "OPENHUMAN_MODE",
    "OPENHUMAN_STORAGE_URL",
    "OPENHUMAN_NODE_ID",
];

pub struct Deployment {
    pub tmp: tempfile::TempDir,
    pub root: PathBuf,
    pub config: PathBuf,
}

pub fn deployment(write_token: bool) -> Deployment {
    let tmp = tempfile::tempdir().expect("temp dir");
    let root = tmp.path().join("saas");
    std::fs::create_dir(&root).unwrap();
    set_mode(&root, 0o700);
    if write_token {
        let token = root.join("service.token");
        std::fs::write(&token, format!("{BEARER}\n")).unwrap();
        set_mode(&token, 0o600);
    }
    let config = tmp.path().join("operator.toml");
    std::fs::write(
        &config,
        format!("root = {:?}\n", root.display().to_string()),
    )
    .unwrap();
    Deployment { tmp, root, config }
}

#[cfg(unix)]
pub fn set_mode(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).unwrap();
}

#[cfg(not(unix))]
pub fn set_mode(_: &Path, _: u32) {}

pub fn core_command(d: &Deployment, extra: &[&str]) -> Command {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_openhuman-core"));
    cmd.args(["run", "--mode", "saas", "--saas-config"])
        .arg(&d.config)
        .args(extra)
        // Keep the child away from the developer's real `~/.openhuman`.
        .env("HOME", d.tmp.path())
        .env("USERPROFILE", d.tmp.path());
    for var in SCRUBBED_ENV {
        cmd.env_remove(var);
    }
    cmd
}

pub struct Server(pub Child);

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

pub fn rpc(
    client: &reqwest::blocking::Client,
    pub base: &str,
    bearer: Option<&str>,
    method: &str,
) -> (u16, Value) {
    rpc_with(client, base, bearer, method, json!({}))
}

pub fn rpc_with(
    client: &reqwest::blocking::Client,
    pub base: &str,
    bearer: Option<&str>,
    method: &str,
    params: Value,
) -> (u16, Value) {
    let mut request = client.post(format!("{base}/rpc")).json(&json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params
    }));
    if let Some(bearer) = bearer {
        request = request.bearer_auth(bearer);
    }
    let response = request.send().expect("POST /rpc");
    let status = response.status().as_u16();
    (status, response.json().unwrap_or(Value::Null))
}

/// Start a SaaS core on deployment `d` and wait until it is healthy.
pub fn start(d: &Deployment) -> (Server, String, reqwest::blocking::Client) {
    let port = free_port();
    let child = core_command(d, &["--port", &port.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn openhuman-core");
    let mut server = Server(child);
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap();

    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        if let Ok(response) = client.get(format!("{base}/health")).send() {
            if response.status().is_success() {
                break;
            }
        }
        if let Ok(Some(status)) = server.0.try_wait() {
            panic!("SaaS core exited before serving: {status}");
        }
        assert!(Instant::now() < deadline, "SaaS core never became healthy");
        std::thread::sleep(Duration::from_millis(250));
    }
    (server, base, client)
}

pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

/// POST /rpc for gateway user `user`, signed unless `sig` overrides it.
pub fn user_rpc(
    client: &reqwest::blocking::Client,
    pub base: &str,
    bearer: &str,
    user: &str,
    sig: Option<&str>,
    method: &str,
) -> (u16, Value) {
    user_rpc_with(client, base, bearer, user, sig, method, json!({}))
}

pub fn user_rpc_with(
    client: &reqwest::blocking::Client,
    pub base: &str,
    bearer: &str,
    user: &str,
    sig: Option<&str>,
    method: &str,
    params: Value,
) -> (u16, Value) {
    use openhuman_core::profiles::gateway::{sign, USER_HEADER, USER_SIG_HEADER};
    let signature = sig
        .map(str::to_owned)
        .unwrap_or_else(|| sign(BEARER, user, now()));
    let response = client
        .post(format!("{base}/rpc"))
        .bearer_auth(bearer)
        .header(USER_HEADER, user)
        .header(USER_SIG_HEADER, signature)
        .json(&json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params }))
        .send()
        .expect("POST /rpc");
    let status = response.status().as_u16();
    (status, response.json().unwrap_or(Value::Null))
}

pub fn provision(client: &reqwest::blocking::Client, base: &str, user: &str) -> String {
    let (_, body) = rpc_with(
        client,
        base,
        Some(BEARER),
        "openhuman.profiles_provision",
        json!({ "user_id": user }),
    );
    assert!(body.get("result").is_some(), "provision {user}: {body}");
    openhuman_core::profiles::ProfileId::for_user(
        user,
        openhuman_core::profiles::ProfileIdMode::Raw,
    )
    .unwrap()
    .to_string()
}

pub fn thread_ids(body: &Value) -> Vec<String> {
    let text = body.to_string();
    let mut ids = Vec::new();
    for part in text.split("\"id\":\"").skip(1) {
        if let Some(end) = part.find('"') {
            ids.push(part[..end].to_string());
        }
    }
    ids
}

/// Open `/events?client_id=` for `user` and forward each SSE `data:` line.
pub fn user_events(base: &str, user: &str, client_id: &str) -> std::sync::mpsc::Receiver<String> {
    use openhuman_core::profiles::gateway::{sign, USER_HEADER, USER_SIG_HEADER};
    use std::io::BufRead;
    let (tx, rx) = std::sync::mpsc::channel();
    let url = format!("{base}/events?client_id={client_id}");
    let user = user.to_string();
    std::thread::spawn(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(None)
            .build()
            .unwrap();
        let Ok(response) = client
            .get(&url)
            .bearer_auth(BEARER)
            .header(USER_HEADER, &user)
            .header(USER_SIG_HEADER, sign(BEARER, &user, now()))
            .send()
        else {
            return;
        };
        let _ = tx.send(format!("status:{}", response.status().as_u16()));
        for line in std::io::BufReader::new(response).lines() {
            let Ok(line) = line else { break };
            if let Some(data) = line.strip_prefix("data:") {
                if tx.send(data.trim().to_string()).is_err() {
                    break;
                }
            }
        }
    });
    rx
}

/// A fake backend: answers every request `500` and reports each request's
/// path and `Authorization` header.
pub fn recording_backend() -> (u16, std::sync::mpsc::Receiver<(String, String)>) {
    use std::io::{BufRead, BufReader, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let tx = tx.clone();
            std::thread::spawn(move || {
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                if reader.read_line(&mut line).is_err() {
                    return;
                }
                let path = line.split_whitespace().nth(1).unwrap_or("").to_string();
                let mut auth = String::new();
                loop {
                    let mut header = String::new();
                    if reader.read_line(&mut header).unwrap_or(0) == 0 || header == "\r\n" {
                        break;
                    }
                    if let Some((name, value)) = header.split_once(':') {
                        if name.eq_ignore_ascii_case("authorization") {
                            auth = value.trim().to_string();
                        }
                    }
                }
                let _ = tx.send((path, auth));
                let mut stream = stream;
                let _ = stream.write_all(
                    b"HTTP/1.1 500 Internal Server Error\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
                );
            });
        }
    });
    (port, rx)
}

/// Start a SaaS core whose backend is a closed port, so every turn fails fast
/// and its failure is itself the reply, without any real inference.
pub fn start_offline(d: &Deployment) -> (Server, String, reqwest::blocking::Client) {
    let port = free_port();
    let child = core_command(d, &["--port", &port.to_string()])
        .env("BACKEND_URL", "http://127.0.0.1:9")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn openhuman-core");
    let server = Server(child);
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(120);
    while !client
        .get(format!("{base}/health"))
        .send()
        .is_ok_and(|r| r.status().is_success())
    {
        assert!(Instant::now() < deadline, "SaaS core never became healthy");
        std::thread::sleep(Duration::from_millis(250));
    }
    (server, base, client)
}

/// One core of a deployment.
pub struct Node {
    pub name: String,
    pub server: Server,
    pub base: String,
    pub log: PathBuf,
}

impl Node {
    fn log_tail(&self) -> String {
        let log = std::fs::read_to_string(&self.log).unwrap_or_default();
        // The polling RPCs drown everything else out.
        let lines: Vec<&str> = log
            .lines()
            .filter(|line| !line.contains("rpc_handler [rpc]"))
            .collect();
        lines[lines.len().saturating_sub(80)..].join("\n")
    }

    fn kill(&mut self) {
        // SIGKILL on Unix: no shutdown hook runs, no lease is released.
        self.server.0.kill().expect("kill core");
        let _ = self.server.0.wait();
    }
}

/// Write node `name`'s operator file on deployment `d` and start it.
pub fn start_node(
    d: &Deployment,
    pub name: &str,
    storage_url: Option<&str>,
    extra: &str,
    backend: Option<u16>,
) -> Node {
    let port = free_port();
    let base = format!("http://127.0.0.1:{port}");
    let mut config = format!(
        "root = {:?}\nnode_id = \"core-{name}\"\noperator_dir = {:?}\nlease_ttl_secs = 3\n",
        d.root.display().to_string(),
        d.tmp
            .path()
            .join(format!("operator-{name}"))
            .display()
            .to_string(),
    );
    if let Some(url) = storage_url {
        config.push_str(&format!(
            "storage_url = {url:?}\nadvertise_url = {base:?}\n"
        ));
    }
    config.push_str(extra);
    let config_path = d.tmp.path().join(format!("operator-{name}.toml"));
    std::fs::write(&config_path, config).unwrap();

    let log = d.tmp.path().join(format!("core-{name}.log"));
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_openhuman-core"));
    cmd.args(["run", "--mode", "saas", "--saas-config"])
        .arg(&config_path)
        .args(["--port", &port.to_string()])
        .env("HOME", d.tmp.path())
        .env("USERPROFILE", d.tmp.path())
        .env("RUST_LOG", "info,openhuman::storage::lease=debug")
        .stdout(std::fs::File::create(&log).unwrap())
        .stderr(Stdio::null());
    for var in SCRUBBED_ENV {
        cmd.env_remove(var);
    }
    match backend {
        Some(port) => cmd.env("BACKEND_URL", format!("http://127.0.0.1:{port}")),
        None => cmd.env("BACKEND_URL", "http://127.0.0.1:9"),
    };
    let child: Child = cmd.spawn().expect("spawn openhuman-core");
    let mut node = Node {
        name: name.to_string(),
        server: Server(child),
        base,
        log,
    };
    let client = client();
    let deadline = Instant::now() + Duration::from_secs(120);
    while !client
        .get(format!("{}/health", node.base))
        .send()
        .is_ok_and(|r| r.status().is_success())
    {
        if let Ok(Some(status)) = node.server.0.try_wait() {
            panic!(
                "core {} exited before serving: {status}\n{}",
                node.name,
                node.log_tail()
            );
        }
        assert!(
            Instant::now() < deadline,
            "core {} never became healthy",
            name
        );
        std::thread::sleep(Duration::from_millis(250));
    }
    node
}

pub fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap()
}

/// POST /rpc for `user` on `node`: status, `X-OpenHuman-Profile-Owner`, body.
pub fn call(node: &Node, user: &str, method: &str, params: Value) -> (u16, Option<String>, Value) {
    use openhuman_core::profiles::gateway::{sign, USER_HEADER, USER_SIG_HEADER};
    let response = client()
        .post(format!("{}/rpc", node.base))
        .bearer_auth(BEARER)
        .header(USER_HEADER, user)
        .header(USER_SIG_HEADER, sign(BEARER, user, now()))
        .json(&json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params }))
        .send()
        .expect("POST /rpc");
    let status = response.status().as_u16();
    let owner = response
        .headers()
        .get("x-openhuman-profile-owner")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    (status, owner, response.json().unwrap_or(Value::Null))
}

pub fn operator(node: &Node, method: &str, params: Value) -> Value {
    let (_, body) = rpc_with(&client(), &node.base, Some(BEARER), method, params);
    body
}

/// Provision `user` (through `node`) with a session credential, so their
/// turns reach inference.
pub fn provision_with_credential(node: &Node, user: &str) -> String {
    let profile = provision(&client(), &node.base, user);
    let body = operator(
        node,
        "openhuman.profiles_set_credential",
        json!({ "profile_id": profile, "kind": "session", "token": format!("{user}-jwt") }),
    );
    assert!(body.get("result").is_some(), "{body}");
    profile
}

pub fn start_turn(node: &Node, user: &str, thread: &str) -> Value {
    let (status, _, body) = call(
        node,
        user,
        "openhuman.channel_web_chat",
        json!({ "client_id": "c1", "thread_id": thread, "message": "hello" }),
    );
    assert_eq!(status, 200, "{user} starts a turn on {thread}: {body}");
    assert!(body.get("result").is_some(), "{body}");
    body
}

/// Whether `user`'s turn on `thread` is in flight on `node`.
pub fn active(node: &Node, user: &str, thread: &str) -> bool {
    let (status, _, body) = call(
        node,
        user,
        "openhuman.channel_web_queue_status",
        json!({ "thread_id": thread }),
    );
    status == 200 && body.to_string().contains("\"active\":true")
}

pub fn wait_until(what: &str, node: &Node, timeout: Duration, mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + timeout;
    while !done() {
        assert!(
            Instant::now() < deadline,
            "timed out waiting for {what}; core {} log:\n{}",
            node.name,
            node.log_tail()
        );
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// The lifecycle of `user`'s latest turn snapshot on `thread`, if any.
pub fn turn_state(node: &Node, user: &str, thread: &str) -> Option<String> {
    let (status, _, body) = call(
        node,
        user,
        "openhuman.threads_turn_state_get",
        json!({ "thread_id": thread }),
    );
    assert_eq!(status, 200, "{body}");
    body.pointer("/result/data/turnState/lifecycle")
        .or_else(|| body.pointer("/result/result/data/turnState/lifecycle"))
        .and_then(Value::as_str)
        .map(str::to_owned)
}

/// The first value under `key` anywhere in `value`.
pub fn find_key<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    match value {
        Value::Object(map) => map
            .get(key)
            .or_else(|| map.values().find_map(|v| find_key(v, key))),
        Value::Array(items) => items.iter().find_map(|v| find_key(v, key)),
        _ => None,
    }
}
