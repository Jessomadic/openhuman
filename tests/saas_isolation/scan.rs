//! After-the-run audits: what every user's files hold, and which credential
//! carried which user's content to the backend.

use std::path::Path;

use super::mock_llm::Recorded;
use super::world::{owners_in, USERS};

/// Every file under `dir`, recursively.
fn files(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(t) if t.is_dir() => files(&path, out),
            Ok(t) if t.is_file() => out.push(path),
            _ => {}
        }
    }
}

/// The user whose `users/<id>/` tree holds `path`, if any.
fn owner_of(root: &Path, path: &Path) -> Option<usize> {
    let rel = path.strip_prefix(root.join("users")).ok()?;
    let first = rel.components().next()?.as_os_str().to_str()?;
    USERS.iter().position(|u| *u == first)
}

/// Files that hold a canary they must not: another user's under a user's
/// tree, any user's outside every user's tree (the operator plane, shared
/// state, the child's `$HOME`). Returns the violations and, per user, how
/// many of their own files carry their canaries (proof the scan saw data).
pub fn scan_files(root: &Path, home: &Path) -> (Vec<String>, [usize; 3]) {
    let mut violations = Vec::new();
    let mut own = [0usize; 3];
    for base in [root, home] {
        let mut all = Vec::new();
        files(base, &mut all);
        for path in all {
            if base == home && path.starts_with(root) {
                continue;
            }
            // The child's own log sits beside the root; it is the operator's.
            if path.extension().is_some_and(|e| e == "log") && !path.starts_with(root) {
                continue;
            }
            let Ok(meta) = std::fs::metadata(&path) else {
                continue;
            };
            if meta.len() > 64 * 1024 * 1024 {
                continue;
            }
            let Ok(bytes) = std::fs::read(&path) else {
                continue;
            };
            let text = String::from_utf8_lossy(&bytes);
            let found = owners_in(&text);
            if found.is_empty() {
                continue;
            }
            let owner = if base == root {
                owner_of(root, &path)
            } else {
                None
            };
            for user in found {
                if Some(user) == owner {
                    own[user] += 1;
                } else {
                    violations.push(format!(
                        "{} holds {}'s canary (owner: {})",
                        path.display(),
                        USERS[user],
                        owner.map(|o| USERS[o]).unwrap_or("nobody"),
                    ));
                }
            }
        }
    }
    (violations, own)
}

/// Requests whose content and credential disagree: any request carrying a
/// user's canary must carry that user's credential and no one else's
/// content, and every inference request must carry exactly one user's
/// credential. Returns the violations and inference requests per user.
pub fn audit_backend(requests: &[Recorded]) -> (Vec<String>, [usize; 3]) {
    let mut violations = Vec::new();
    let mut per_user = [0usize; 3];
    for r in requests {
        let by = owners_in(&r.auth);
        let content = owners_in(&r.body);
        if by.len() > 1 {
            violations.push(format!("{} carried several credentials: {:?}", r.path, by));
            continue;
        }
        let by = by.first().copied();
        if r.is_inference() {
            match by {
                Some(user) => per_user[user] += 1,
                None if !content.is_empty() => violations.push(format!(
                    "inference for {:?} without that user's credential (auth `{}`)",
                    content.iter().map(|&u| USERS[u]).collect::<Vec<_>>(),
                    redact(&r.auth),
                )),
                None => {}
            }
        }
        for user in content {
            if Some(user) != by {
                violations.push(format!(
                    "{} carried {}'s content under {}'s credential",
                    r.path,
                    USERS[user],
                    by.map(|b| USERS[b]).unwrap_or("no user"),
                ));
            }
        }
    }
    (violations, per_user)
}

fn redact(auth: &str) -> String {
    auth.chars().take(12).collect::<String>() + "…"
}
