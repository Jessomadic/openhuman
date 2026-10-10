//! Encrypted-file keyring backend.
//!
//! Stores all secrets in a single ChaCha20-Poly1305-encrypted file on disk,
//! keyed by an app-scoped master key. The key is loaded once at core startup
//! via [`init_master_key`] — from the environment when an operator supplies
//! it ([`MASTER_KEY_ENV`] / [`MASTER_KEY_FILE_ENV`], for headless deployments
//! with no OS keychain), otherwise from the OS keychain — and cached in a
//! process-wide static. The backend itself never touches the OS keychain.
//!
//! This design reduces OS keychain access to exactly ONE call per process
//! lifetime, avoiding the N-prompt problem where dev-signed macOS builds
//! block on each individual keychain entry.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use crate::security::keyring::backend::KeyringBackend;
use crate::security::keyring::crypto::{self, KEY_LEN};
use crate::security::keyring::error::KeyringError;
use crate::security::keyring::file_store;
use crate::security::keyring::store::BackendKind;

const KEYCHAIN_SERVICE: &str = "openhuman";
const KEYCHAIN_MASTER_KEY_USERNAME: &str = "app:master_key";
/// Environment variable carrying the master key inline as `2 * KEY_LEN` hex
/// characters (`openssl rand -hex 32`). Lets a headless `openhuman-core
/// serve` — a container with no Secret Service or keychain — keep the
/// `encrypted_file` backend instead of falling back to the plaintext `file`
/// backend (#6926). Operators inject it from their secret manager the same
/// way they inject `OPENHUMAN_CORE_TOKEN`.
pub const MASTER_KEY_ENV: &str = "OPENHUMAN_KEYRING_MASTER_KEY";
/// Environment variable naming a file whose contents are the master key in
/// the same hex form (surrounding whitespace ignored), for Docker/Kubernetes
/// secret mounts. Mutually exclusive with [`MASTER_KEY_ENV`].
pub const MASTER_KEY_FILE_ENV: &str = "OPENHUMAN_KEYRING_MASTER_KEY_FILE";
const SECRETS_FILENAME: &str = "secrets.enc";
const LEGACY_DEV_KEYCHAIN: &str = "dev-keychain.json";

/// Outcome of the one-time master-key initialization: the key (`None` when
/// the backend needs none or the OS keychain could not provide it), or the
/// configuration error that rejected an operator-supplied source.
type MasterKeyInit = Result<Option<[u8; KEY_LEN]>, String>;

/// Process-wide master-key outcome, set once by [`init_master_key`].
static MASTER_KEY: OnceLock<MasterKeyInit> = OnceLock::new();

/// Set when [`init_master_key`] found the OS keychain unable to provide the
/// key, so storage secrets reuse that outcome instead of retrying the
/// keychain (and its prompt) on their first operation.
static KEYCHAIN_UNAVAILABLE: OnceLock<()> = OnceLock::new();

// ── Public API for core startup ──────────────────────────────────────────────

/// Initialize the keyring subsystem: set the workspace directory and load
/// the master encryption key (whenever encrypted storage is selected) — from
/// [`MASTER_KEY_ENV`] or [`MASTER_KEY_FILE_ENV`] when an operator set one,
/// otherwise from the OS keychain.
///
/// Call this once at core startup before any keyring operations. In dev
/// environments that explicitly select the plain file backend, the master key
/// is not loaded. The result is cached process-wide; subsequent calls are
/// no-ops. Which source supplied the key is logged at `info`; the key never
/// is.
///
/// # Errors
///
/// Returns `Err` only when an operator-supplied source ([`MASTER_KEY_ENV`] /
/// [`MASTER_KEY_FILE_ENV`]) is set but unusable — both set, unreadable file,
/// wrong length, not hex. That is a configuration error the process should
/// not start with: continuing would run with secrets unreadable and fail
/// later, on the first store, with a less specific message. An OS-keychain
/// failure is **not** an error here: it keeps the #3311 behaviour (log,
/// notify the frontend, run with secrets inaccessible until keychain access
/// is restored). The outcome, error included, is cached process-wide, so
/// every later call after a configuration error returns the same `Err`.
pub fn init_master_key() -> Result<(), String> {
    // Ensure workspace dir is set for the backend before anything else.
    let dir = crate::security::keyring::store::workspace_dir_for_file_backend();
    log::info!(
        "[keyring] init_master_key: resolved workspace_dir={}",
        dir.display()
    );
    crate::security::keyring::init_workspace(&dir);

    init_once(&MASTER_KEY, || {
        let backend_kind = crate::security::keyring::store::effective_backend_kind();
        if backend_kind != BackendKind::EncryptedFile {
            log::debug!(
                "[keyring:encrypted_file] skipping master key init backend={backend_kind:?}"
            );
            return Ok(None);
        }

        match try_load_master_key() {
            Ok((key, source)) => {
                log::info!("[keyring:encrypted_file] master key loaded from {source}");
                Ok(Some(key))
            }
            Err(MasterKeyError::Configured(e)) => {
                log::error!(
                    "[keyring:encrypted_file] operator-supplied master key rejected; refusing \
                     to start with secrets unreadable. Cause: {e}"
                );
                Err(e)
            }
            Err(MasterKeyError::Keychain(e)) => {
                log::error!(
                    "[keyring:encrypted_file] master key load FAILED — refusing to mint a \
                     replacement (that would orphan existing secrets, #3311). Secrets are \
                     inaccessible this session and recover once OS keychain access is \
                     restored. Cause: {e}"
                );
                // Surface the denied state to the frontend instead of silently
                // resetting — this is the "warn before reset" the issue asks for.
                crate::security::keyring_consent::policy::notify_master_key_unavailable(&e);
                let _ = KEYCHAIN_UNAVAILABLE.set(());
                Ok(None)
            }
        }
    })
}

/// The master key that encrypts secrets on a configured storage backend
/// ([`crate::storage::secrets`]): the key [`init_master_key`] loaded when
/// there is one, otherwise the same resolution run once for storage —
/// [`MASTER_KEY_ENV`] / [`MASTER_KEY_FILE_ENV`] first, then the OS keychain.
///
/// # Errors
///
/// When no source can provide the key. Storage secrets then fail closed:
/// they are never written unencrypted or under a freshly minted key that
/// would orphan the ones already stored.
pub(crate) fn storage_master_key() -> Result<[u8; KEY_LEN], String> {
    // Only a loaded key is cached: a failure (locked keychain, denied prompt)
    // is retried on the next call so secrets recover once access is restored.
    static STORAGE_MASTER_KEY: OnceLock<[u8; KEY_LEN]> = OnceLock::new();
    if let Some(Ok(Some(key))) = MASTER_KEY.get() {
        return Ok(*key);
    }
    // `init_master_key` already tried the keychain this session and it
    // failed: reuse that outcome, do not prompt again. (`Ok(None)` alone also
    // means "backend needs no key / init skipped", which must still load.)
    if KEYCHAIN_UNAVAILABLE.get().is_some() {
        return Err("OS keychain master key unavailable this session".into());
    }
    if let Some(key) = STORAGE_MASTER_KEY.get() {
        return Ok(*key);
    }
    match try_load_master_key() {
        Ok((key, source)) => {
            log::info!("[keyring:storage] master key loaded from {source}");
            Ok(*STORAGE_MASTER_KEY.get_or_init(|| key))
        }
        Err(MasterKeyError::Configured(_) | MasterKeyError::Keychain(_)) => {
            // Fixed message: the underlying error can carry a path taken
            // from `MASTER_KEY_FILE_ENV`.
            log::error!("[keyring:storage] master key unavailable");
            Err("master key unavailable".into())
        }
    }
}

/// Runs `init` at most once per `cell` and reports its outcome on every call.
///
/// A configuration error is stored in the cell rather than leaving it empty
/// or storing `None`: `OnceLock::get_or_init` never reruns its closure, so a
/// later call (a second embedded boot in the same process) must still see the
/// error instead of a silent `Ok` with no key loaded.
fn init_once(
    cell: &OnceLock<MasterKeyInit>,
    init: impl FnOnce() -> MasterKeyInit,
) -> Result<(), String> {
    match cell.get_or_init(init) {
        Ok(_) => Ok(()),
        Err(e) => Err(e.clone()),
    }
}

/// Why the master key could not be loaded. The two kinds are handled
/// differently at startup — see [`init_master_key`].
#[derive(Debug)]
enum MasterKeyError {
    /// An operator-supplied source is set but unusable. Fatal at startup.
    Configured(String),
    /// The OS keychain could not provide (or safely mint) the key. Not fatal:
    /// the process runs with secrets inaccessible, as before.
    Keychain(String),
}

/// Abstraction over the OS-keychain entry that holds the master key.
///
/// Exists solely so the load-vs-mint decision in [`load_or_mint_master_key`]
/// can be unit-tested against injected `keyring::Error` variants. A real
/// `keyring::Entry` cannot be exercised non-interactively under `cargo test`
/// (the first access blocks on a GUI permission prompt), so the decision logic
/// is split out behind this trait and tested with a fake.
trait MasterKeyEntry {
    fn get_password(&self) -> Result<String, keyring::Error>;
    fn set_password(&self, value: &str) -> Result<(), keyring::Error>;
}

impl MasterKeyEntry for keyring::Entry {
    fn get_password(&self) -> Result<String, keyring::Error> {
        keyring::Entry::get_password(self)
    }
    fn set_password(&self, value: &str) -> Result<(), keyring::Error> {
        keyring::Entry::set_password(self, value)
    }
}

/// Loads the master key, returning it with a human-readable description of
/// the source it came from (for the startup log; never the value).
///
/// Uncached: every call reads the environment (and the key file) afresh.
/// Only [`init_master_key`] stores an outcome in [`MASTER_KEY`].
///
/// The environment is consulted first so a headless deployment never touches
/// the OS keychain. An environment variable that is set but unusable is an
/// error, not a fall-through: silently continuing to the keychain would mask
/// the misconfiguration and, in a container, fail later with a less specific
/// "master key unavailable".
fn try_load_master_key() -> Result<([u8; KEY_LEN], String), MasterKeyError> {
    let inline = env_value(MASTER_KEY_ENV, std::env::var(MASTER_KEY_ENV))
        .map_err(MasterKeyError::Configured)?;
    let file = env_value(MASTER_KEY_FILE_ENV, std::env::var(MASTER_KEY_FILE_ENV))
        .map_err(MasterKeyError::Configured)?;
    if let Some(from_env) =
        master_key_from_env(inline.as_deref(), file.as_deref(), read_master_key_file)
            .map_err(MasterKeyError::Configured)?
    {
        return Ok(from_env);
    }
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_MASTER_KEY_USERNAME)
        .map_err(|e| MasterKeyError::Keychain(format!("keychain entry creation failed: {e}")))?;
    load_or_mint_master_key(&entry)
        .map(|key| (key, "OS keychain".to_string()))
        .map_err(MasterKeyError::Keychain)
}

/// Interprets one `std::env::var` result for a master-key variable.
///
/// Only `NotPresent` means unset. A value that is not valid Unicode is a
/// misconfiguration and must not be treated as unset: that would fall
/// through to the OS keychain, where [`load_or_mint_master_key`] could mint
/// a different key and orphan every secret in `secrets.enc`. The rejected
/// value is never formatted into the error (`VarError`'s `Display` would
/// include it).
fn env_value(
    name: &str,
    raw: Result<String, std::env::VarError>,
) -> Result<Option<String>, String> {
    match raw {
        Ok(value) => Ok(Some(value)),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(std::env::VarError::NotUnicode(_)) => {
            Err(format!("{name} is set but is not valid Unicode"))
        }
    }
}

/// Resolves an operator-supplied master key from the two environment
/// sources, given their raw values.
///
/// `Ok(None)` when neither is set (an empty or whitespace-only value counts
/// as unset, matching how Compose passes an undefined `${VAR}`), so the
/// caller falls through to the OS keychain. `Err` when a source is set but
/// unusable: both set at once, an unreadable file, or a value that is not
/// exactly `2 * KEY_LEN` hex characters. Error messages and the returned
/// source label name the variable and the problem but never include its
/// value — not even the file path, which may be a mistakenly pasted key.
///
/// `read_file` is injected so the decision logic is testable without touching
/// the filesystem; production passes [`read_master_key_file`].
fn master_key_from_env(
    inline: Option<&str>,
    file: Option<&str>,
    read_file: impl FnOnce(&Path) -> Result<String, String>,
) -> Result<Option<([u8; KEY_LEN], String)>, String> {
    let inline = inline.map(str::trim).filter(|value| !value.is_empty());
    let file = file.map(str::trim).filter(|value| !value.is_empty());
    match (inline, file) {
        (None, None) => Ok(None),
        (Some(_), Some(_)) => Err(format!(
            "{MASTER_KEY_ENV} and {MASTER_KEY_FILE_ENV} are both set; set exactly one"
        )),
        (Some(hex), None) => parse_master_key_hex(hex)
            .map(|key| Some((key, MASTER_KEY_ENV.to_string())))
            .map_err(|e| format!("{MASTER_KEY_ENV}: {e}")),
        (None, Some(path)) => {
            // Named by the variable, never by its value: an operator who puts
            // the key itself in the `_FILE` variable would otherwise have it
            // copied into the error and the startup log.
            let contents =
                read_file(Path::new(path)).map_err(|e| format!("{MASTER_KEY_FILE_ENV}: {e}"))?;
            parse_master_key_hex(contents.trim())
                .map(|key| Some((key, MASTER_KEY_FILE_ENV.to_string())))
                .map_err(|e| format!("{MASTER_KEY_FILE_ENV}: {e}"))
        }
    }
}

/// Reads the file named by [`MASTER_KEY_FILE_ENV`].
///
/// On Unix a key file must not be writable by other users. Read-only group or
/// other permissions are supported for container secret mounts, where the
/// runtime may add group-read access for a non-root core.
fn read_master_key_file(path: &Path) -> Result<String, String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata = std::fs::metadata(path).map_err(|e| {
            format!("cannot inspect master key file permissions ({MASTER_KEY_FILE_ENV}): {e}")
        })?;
        let mode = metadata.permissions().mode() & 0o777;
        if key_file_mode_is_other_writable(mode) {
            return Err(format!(
                "master key file ({MASTER_KEY_FILE_ENV}) is writable by other users; \
                 restrict it to a read-only secret mount"
            ));
        }
    }
    std::fs::read_to_string(path).map_err(|e| format!("cannot read master key file: {e}"))
}

#[cfg(unix)]
fn key_file_mode_is_other_writable(mode: u32) -> bool {
    mode & 0o002 != 0
}

/// Decodes a master key supplied as exactly `2 * KEY_LEN` hex characters.
/// The value never appears in the error.
fn parse_master_key_hex(hex: &str) -> Result<[u8; KEY_LEN], String> {
    let expected = 2 * KEY_LEN;
    let got = hex.chars().count();
    if got != expected {
        return Err(format!("expected {expected} hex characters, got {got}"));
    }
    // `hex_decode` slices by byte; a non-ASCII value of the right character
    // count would panic there instead of being rejected.
    if !hex.is_ascii() {
        return Err("value is not valid hex".to_string());
    }
    let bytes = crypto::hex_decode(hex).map_err(|_| "value is not valid hex".to_string())?;
    let mut key = [0u8; KEY_LEN];
    key.copy_from_slice(&bytes);
    Ok(key)
}

/// Load the existing master key, mint a fresh one, or fail safe.
///
/// **Only a genuine absence (`NoEntry`) may mint a new key.** Every other error
/// — access denied, keychain locked, platform failure — returns `Err` WITHOUT
/// minting or calling `set_password`, leaving the keychain entry untouched.
///
/// This is the fix for #3311. A macOS app update can change the binary's
/// code-signing identity (or the keychain item's ACL trust), so reading the
/// *existing* master key fails with an access error rather than `NoEntry`. The
/// previous code conflated the two and minted a brand-new key on access
/// denial, orphaning every secret encrypted under the old key — a silent
/// API-key wipe plus disconnected connectors, with no warning. Failing safe
/// keeps the ciphertext intact so it recovers on the next launch once keychain
/// access is restored. The catch-all `Err(e)` arm makes this independent of
/// which exact `keyring` error variant macOS returns on the denial.
fn load_or_mint_master_key<E: MasterKeyEntry>(entry: &E) -> Result<[u8; KEY_LEN], String> {
    match entry.get_password() {
        Ok(hex_str) => {
            let bytes = crypto::hex_decode(hex_str.trim())?;
            if bytes.len() != KEY_LEN {
                return Err(format!(
                    "master key has wrong length ({} bytes, expected {KEY_LEN})",
                    bytes.len()
                ));
            }
            let mut key = [0u8; KEY_LEN];
            key.copy_from_slice(&bytes);
            Ok(key)
        }
        Err(keyring::Error::NoEntry) => {
            let key_bytes = crypto::generate_random_bytes(KEY_LEN);
            let hex_value = crypto::hex_encode(&key_bytes);
            entry
                .set_password(&hex_value)
                .map_err(|e| format!("failed to store new master key in keychain: {e}"))?;

            let readback = entry
                .get_password()
                .map_err(|e| format!("master key readback failed: {e}"))?;
            if readback.trim() != hex_value {
                return Err("master key write verification failed".to_string());
            }

            let mut key = [0u8; KEY_LEN];
            key.copy_from_slice(&key_bytes);
            log::info!(
                "[keyring:encrypted_file] no existing master key — generated and stored a new one"
            );
            Ok(key)
        }
        Err(e) => Err(format!(
            "OS keychain access unavailable; refusing to mint a replacement master key so \
             existing secrets are preserved (#3311): {e}"
        )),
    }
}

/// Get a reference to the cached master key, if available.
fn master_key() -> Option<&'static [u8; KEY_LEN]> {
    MASTER_KEY
        .get()
        .and_then(|init| init.as_ref().ok())
        .and_then(Option::as_ref)
}

// ── Backend ──────────────────────────────────────────────────────────────────

/// Every secret in one ChaCha20-Poly1305 file.
///
/// Mutations are a read → decrypt → modify → encrypt → write cycle over the
/// whole set, guarded by the cross-process advisory lock in
/// [`file_store::lock_for_write`]. An in-process mutex would not do: more than
/// one process routinely addresses the same workspace (a desktop core and a
/// second process embedding the same core), and the later writer's snapshot —
/// read before the earlier writer landed — silently drops the earlier secret.
pub struct EncryptedFileBackend {
    path: PathBuf,
    workspace_dir: PathBuf,
}

impl EncryptedFileBackend {
    pub fn new(workspace_dir: &Path) -> Self {
        Self {
            path: workspace_dir.join(SECRETS_FILENAME),
            workspace_dir: workspace_dir.to_path_buf(),
        }
    }

    fn read_map(&self, key: &[u8; KEY_LEN]) -> Result<HashMap<String, String>, KeyringError> {
        self.read_map_with_cleanup(key, |map| self.cleanup_matching_legacy_files(map))
    }

    fn read_map_with_cleanup(
        &self,
        key: &[u8; KEY_LEN],
        cleanup: impl FnOnce(&HashMap<String, String>) -> Result<(), KeyringError>,
    ) -> Result<HashMap<String, String>, KeyringError> {
        if !self.path.exists() {
            return self.migrate_legacy_dev_keychain(key);
        }

        let blob = std::fs::read(&self.path).map_err(|e| KeyringError::MigrationReadFailed {
            path: self.path.display().to_string(),
            source: e,
        })?;

        if blob.is_empty() {
            return Ok(HashMap::new());
        }

        match crypto::chacha20_decrypt(key, &blob) {
            Ok(plaintext) => match serde_json::from_slice::<HashMap<String, String>>(&plaintext) {
                Ok(map) => {
                    if let Err(error) = cleanup(&map) {
                        match error {
                            KeyringError::MigrationDeleteFailed { .. } => {
                                // The encrypted copy is valid. Keep serving it
                                // while leaving the plaintext source for a
                                // later cleanup attempt or manual recovery.
                                log::warn!(
                                    "[keyring:encrypted_file] could not remove verified legacy copy: {error}"
                                );
                            }
                            _ => return Err(error),
                        }
                    }
                    Ok(map)
                }
                Err(e) => {
                    log::warn!(
                        "[keyring:encrypted_file] decrypted data is not valid JSON: {e}; \
                         treating as corrupt"
                    );
                    self.handle_corruption();
                    Ok(HashMap::new())
                }
            },
            Err(e) => {
                log::error!(
                    "[keyring:encrypted_file] decryption failed: {e}; master key may have \
                     changed or file is corrupt"
                );
                self.handle_corruption();
                Ok(HashMap::new())
            }
        }
    }

    fn write_map(
        &self,
        key: &[u8; KEY_LEN],
        map: &HashMap<String, String>,
    ) -> Result<(), KeyringError> {
        let json = serde_json::to_vec(map)
            .map_err(|e| KeyringError::Backend(format!("failed to serialize secrets: {e}")))?;

        let blob = crypto::chacha20_encrypt(key, &json)
            .map_err(|e| KeyringError::Backend(format!("encryption failed: {e}")))?;

        file_store::write_atomic(&self.path, &blob)
    }

    fn migrate_legacy_dev_keychain(
        &self,
        key: &[u8; KEY_LEN],
    ) -> Result<HashMap<String, String>, KeyringError> {
        let legacy_path = self.workspace_dir.join(LEGACY_DEV_KEYCHAIN);
        if !legacy_path.exists() {
            return Ok(HashMap::new());
        }
        // The plaintext backend uses this same sidecar lock. Keep it across
        // the read, encrypted write, verification, and source removal so a
        // concurrent plaintext writer cannot lose an update during migration.
        let _legacy_guard = file_store::lock_for_write(&legacy_path)?;
        if !legacy_path.exists() {
            return Ok(HashMap::new());
        }
        let metadata = std::fs::symlink_metadata(&legacy_path).map_err(|source| {
            KeyringError::MigrationReadFailed {
                path: legacy_path.display().to_string(),
                source,
            }
        })?;
        if !metadata.file_type().is_file() {
            return Err(KeyringError::Backend(format!(
                "legacy {LEGACY_DEV_KEYCHAIN} is not a regular file; preserving it for recovery"
            )));
        }

        log::info!(
            "[keyring:encrypted_file] found legacy {} — migrating to encrypted file",
            LEGACY_DEV_KEYCHAIN
        );

        let bytes = std::fs::read(&legacy_path).map_err(|e| KeyringError::MigrationReadFailed {
            path: legacy_path.display().to_string(),
            source: e,
        })?;

        let map: HashMap<String, String> = if bytes.is_empty() {
            HashMap::new()
        } else {
            serde_json::from_slice(&bytes).map_err(|e| {
                KeyringError::Backend(format!(
                    "legacy {LEGACY_DEV_KEYCHAIN} is invalid JSON; preserving it for recovery: {e}"
                ))
            })?
        };

        self.write_map(key, &map)?;
        self.verify_migrated_map(key, &map)?;

        std::fs::remove_file(&legacy_path).map_err(|source| {
            KeyringError::MigrationDeleteFailed {
                path: legacy_path.display().to_string(),
                source,
            }
        })?;
        log::info!(
            "[keyring:encrypted_file] legacy {LEGACY_DEV_KEYCHAIN} migrated \
             ({} entries), verified, and removed",
            map.len()
        );
        if let Err(e) = self.cleanup_matching_legacy_file(
            &legacy_path.with_extension("json.migrated"),
            &map,
            false,
        ) {
            log::warn!("[keyring:encrypted_file] could not clean up older legacy copy: {e}");
        }

        Ok(map)
    }

    /// Read the encrypted file back without the normal corruption quarantine.
    /// A failed verification must leave the plaintext source available to retry.
    fn verify_migrated_map(
        &self,
        key: &[u8; KEY_LEN],
        expected: &HashMap<String, String>,
    ) -> Result<(), KeyringError> {
        let blob = std::fs::read(&self.path).map_err(|e| {
            KeyringError::Backend(format!("cannot read encrypted migration result: {e}"))
        })?;
        let plaintext = crypto::chacha20_decrypt(key, &blob)
            .map_err(|e| KeyringError::Backend(format!("cannot decrypt migration result: {e}")))?;
        let actual: HashMap<String, String> = serde_json::from_slice(&plaintext).map_err(|e| {
            KeyringError::Backend(format!("cannot parse decrypted migration result: {e}"))
        })?;
        if &actual != expected {
            return Err(KeyringError::Backend(
                "encrypted migration result differs from plaintext source".into(),
            ));
        }
        Ok(())
    }

    /// Remove an old plaintext copy only when every entry is present with the
    /// same value in the decrypted store. A changed or invalid copy may hold
    /// data needed for recovery and is left in place for manual inspection.
    fn cleanup_matching_legacy_file(
        &self,
        path: &Path,
        encrypted: &HashMap<String, String>,
        strict: bool,
    ) -> Result<(), KeyringError> {
        if !path.exists() {
            return Ok(());
        }
        let _guard = file_store::lock_for_write(path)?;
        let metadata = match std::fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(source) => {
                return Err(KeyringError::MigrationReadFailed {
                    path: path.display().to_string(),
                    source,
                });
            }
        };
        if !metadata.file_type().is_file() {
            if strict {
                return Err(KeyringError::Backend(format!(
                    "legacy {LEGACY_DEV_KEYCHAIN} is not a regular file; preserving it for recovery"
                )));
            }
            log::warn!("[keyring:encrypted_file] legacy path {} is not a regular file; leaving it untouched", path.display());
            return Ok(());
        }
        let bytes = std::fs::read(path).map_err(|source| KeyringError::MigrationReadFailed {
            path: path.display().to_string(),
            source,
        })?;
        let legacy: HashMap<String, String> = match serde_json::from_slice(&bytes) {
            Ok(map) => map,
            Err(e) => {
                if strict {
                    return Err(KeyringError::Backend(format!(
                        "legacy {LEGACY_DEV_KEYCHAIN} is invalid JSON; preserving it for recovery: {e}"
                    )));
                }
                log::warn!("[keyring:encrypted_file] legacy copy {} is invalid JSON ({e}); leaving it for recovery", path.display());
                return Ok(());
            }
        };
        if !legacy
            .iter()
            .all(|(key, value)| encrypted.get(key) == Some(value))
        {
            if strict {
                return Err(KeyringError::Backend(format!(
                    "legacy {LEGACY_DEV_KEYCHAIN} differs from encrypted secrets; preserving it for recovery"
                )));
            }
            log::warn!("[keyring:encrypted_file] legacy copy {} differs from encrypted secrets; leaving it for recovery", path.display());
            return Ok(());
        }
        std::fs::remove_file(path).map_err(|source| KeyringError::MigrationDeleteFailed {
            path: path.display().to_string(),
            source,
        })?;
        log::info!(
            "[keyring:encrypted_file] removed verified legacy plaintext copy {}",
            path.display()
        );
        Ok(())
    }

    fn cleanup_matching_legacy_files(
        &self,
        encrypted: &HashMap<String, String>,
    ) -> Result<(), KeyringError> {
        let legacy_path = self.workspace_dir.join(LEGACY_DEV_KEYCHAIN);
        self.cleanup_matching_legacy_file(&legacy_path, encrypted, true)?;
        if let Err(e) = self.cleanup_matching_legacy_file(
            &legacy_path.with_extension("json.migrated"),
            encrypted,
            false,
        ) {
            log::warn!("[keyring:encrypted_file] could not clean up older legacy copy: {e}");
        }
        Ok(())
    }

    /// Move an undecryptable / unparseable secrets file aside so the next call
    /// starts fresh without destroying the bytes.
    fn handle_corruption(&self) {
        file_store::quarantine_corrupt(&self.path, "enc");
    }

    /// [`KeyringBackend::get`] under an explicit master key.
    fn get_with_key(
        &self,
        key: &[u8; KEY_LEN],
        namespaced_key: &str,
    ) -> Result<Option<String>, KeyringError> {
        // `read_map` can mutate the filesystem: it migrates a missing file and
        // quarantines corrupt ciphertext. Hold the same lock as writers for
        // either case so a delayed quarantine cannot rename a replacement a
        // concurrent `set` just published.
        let _guard = file_store::lock_for_write(&self.path)?;
        let map = self.read_map(key)?;
        Ok(map.get(namespaced_key).cloned())
    }

    /// [`KeyringBackend::set`] under an explicit master key.
    fn set_with_key(
        &self,
        key: &[u8; KEY_LEN],
        namespaced_key: &str,
        value: &str,
    ) -> Result<(), KeyringError> {
        // Held across the read as well as the write: taking it around the write
        // alone would still let a stale map overwrite a concurrent one.
        let _guard = file_store::lock_for_write(&self.path)?;
        let mut map = self.read_map(key)?;
        map.insert(namespaced_key.to_string(), value.to_string());
        self.write_map(key, &map)
    }
}

impl KeyringBackend for EncryptedFileBackend {
    fn get(&self, namespaced_key: &str) -> Result<Option<String>, KeyringError> {
        let Some(key) = master_key() else {
            return Ok(None);
        };
        self.get_with_key(key, namespaced_key)
    }

    fn set(&self, namespaced_key: &str, value: &str) -> Result<(), KeyringError> {
        let Some(key) = master_key() else {
            return Err(KeyringError::Backend(
                "master key unavailable — cannot store secrets".to_string(),
            ));
        };
        self.set_with_key(key, namespaced_key, value)
    }

    fn delete(&self, namespaced_key: &str) -> Result<(), KeyringError> {
        let Some(key) = master_key() else {
            return Ok(());
        };
        let _guard = file_store::lock_for_write(&self.path)?;
        let mut map = self.read_map(key)?;
        if map.remove(namespaced_key).is_some() {
            self.write_map(key, &map)?;
        }
        Ok(())
    }

    fn name(&self) -> &'static str {
        "encrypted_file"
    }
}

#[cfg(test)]
#[path = "encrypted_file_backend_tests.rs"]
mod tests;
