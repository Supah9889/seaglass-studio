//! SG-05: replace a saved file only after its new contents are completely on disk.
//!
//! Bytes go to a uniquely created sibling staging file, are flushed, and then take the
//! destination's place with a single rename. On Windows, `std::fs::rename` uses
//! `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` semantics, which either replaces the file or
//! leaves the previous destination untouched (for example when it is locked or read-only).

use std::fmt;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Runtime};
use tauri_plugin_fs::FsExt;

#[derive(Debug, PartialEq, Eq)]
pub enum SaveError {
  /// The path was not approved by the save dialog.
  NotApproved,
  /// The target is not the approved path or the approved path plus an extension.
  UnexpectedTarget,
  /// An extension was appended and a different file with that name already exists.
  OverwriteUnconfirmed(String),
  /// The request body or headers were malformed.
  BadRequest,
  /// The staging file could not be created, written or flushed. The destination is unchanged.
  Stage(String),
  /// The staged file could not replace the destination. The destination is unchanged.
  Finalize(String),
}

impl fmt::Display for SaveError {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    match self {
      SaveError::NotApproved => write!(f, "This location was not chosen in the save dialog; nothing was written."),
      SaveError::UnexpectedTarget => write!(f, "The save location changed unexpectedly; nothing was written."),
      SaveError::OverwriteUnconfirmed(name) => write!(f, "{name} already exists. Choose it explicitly to replace it; nothing was written."),
      SaveError::BadRequest => write!(f, "The save request was incomplete; nothing was written."),
      SaveError::Stage(reason) => write!(f, "The file could not be written ({reason}); any existing file was left unchanged."),
      SaveError::Finalize(reason) => write!(f, "The existing file could not be replaced ({reason}); it was left unchanged."),
    }
  }
}

static STAGING_COUNTER: AtomicU64 = AtomicU64::new(0);

fn describe(error: &io::Error) -> String {
  match error.kind() {
    // Windows reports a destination held open by another program as access denied, too.
    io::ErrorKind::PermissionDenied => "it is read-only, open in another program, or access was denied".into(),
    io::ErrorKind::NotFound => "folder not found".into(),
    io::ErrorKind::StorageFull => "disk full".into(),
    _ => match error.raw_os_error() {
      Some(32) | Some(33) => "the file is open in another program".into(),
      _ => error.to_string(),
    },
  }
}

/// Create a new, uniquely named staging file next to `target`.
fn create_staging(target: &Path) -> io::Result<(PathBuf, fs::File)> {
  let dir = target.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
  let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into());
  let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
  let mut last_error = None;
  for _ in 0..16 {
    let count = STAGING_COUNTER.fetch_add(1, Ordering::Relaxed);
    let staging = dir.join(format!(".{name}.{}-{nanos}-{count}.sgsave", std::process::id()));
    match OpenOptions::new().write(true).create_new(true).open(&staging) {
      Ok(file) => return Ok((staging, file)),
      Err(error) if error.kind() == io::ErrorKind::AlreadyExists => last_error = Some(error),
      Err(error) => return Err(error),
    }
  }
  Err(last_error.unwrap_or_else(|| io::Error::other("could not create a unique staging file")))
}

/// How the staged file takes the destination's place.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Finalize {
  /// The user approved this path in the dialog, including overwriting it.
  Replace,
  /// No overwrite was approved; fail if the destination appears meanwhile.
  CreateOnly,
}

fn finalize_create_only(staging: &Path, target: &Path) -> io::Result<()> {
  finalize_create_only_with(staging, target, |from, to| fs::hard_link(from, to))
}

fn finalize_create_only_with(
  staging: &Path,
  target: &Path,
  link: impl FnOnce(&Path, &Path) -> io::Result<()>,
) -> io::Result<()> {
  // A hard link refuses to overwrite atomically.
  match link(staging, target) {
    Ok(()) => {
      let _ = fs::remove_file(staging);
      Ok(())
    }
    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Err(error),
    Err(_) => {
      // Volumes without hard links (FAT/exFAT): reserve the name exclusively first, so the
      // replacing rename can only ever replace this empty placeholder, never another file.
      OpenOptions::new().write(true).create_new(true).open(target)?;
      fs::rename(staging, target).inspect_err(|_| {
        let _ = fs::remove_file(target);
      })
    }
  }
}

/// Write `bytes` to `target` through a flushed sibling staging file.
pub fn write_atomically(target: &Path, bytes: &[u8], mode: Finalize) -> Result<(), SaveError> {
  write_with(target, bytes, |staging, target| match mode {
    Finalize::Replace => fs::rename(staging, target),
    Finalize::CreateOnly => finalize_create_only(staging, target),
  })
}

/// Like [`write_atomically`], with an injectable finalization step for failure tests.
pub fn write_with(
  target: &Path,
  bytes: &[u8],
  finalize: impl FnOnce(&Path, &Path) -> io::Result<()>,
) -> Result<(), SaveError> {
  let (staging, mut file) = create_staging(target).map_err(|e| SaveError::Stage(describe(&e)))?;
  let staged = file.write_all(bytes).and_then(|()| file.sync_all());
  drop(file);
  if let Err(error) = staged {
    let _ = fs::remove_file(&staging);
    return Err(SaveError::Stage(describe(&error)));
  }
  if let Err(error) = finalize(&staging, target) {
    let _ = fs::remove_file(&staging);
    if error.kind() == io::ErrorKind::AlreadyExists {
      let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
      return Err(SaveError::OverwriteUnconfirmed(name));
    }
    return Err(SaveError::Finalize(describe(&error)));
  }
  Ok(())
}

/// Decide how to finalize `target` given the dialog-approved path.
pub fn finalize_mode(approved: &Path, target: &Path) -> Result<Finalize, SaveError> {
  if target == approved {
    return Ok(Finalize::Replace);
  }
  // Only an appended extension is allowed, e.g. "Sketch" -> "Sketch.seaglass".
  let (Some(approved_name), Some(target_name)) = (approved.file_name(), target.file_name()) else {
    return Err(SaveError::UnexpectedTarget);
  };
  let (approved_name, target_name) = (approved_name.to_string_lossy(), target_name.to_string_lossy());
  let suffix = target_name.strip_prefix(approved_name.as_ref()).unwrap_or("");
  let extension = suffix.strip_prefix('.').unwrap_or("");
  let valid_extension = !extension.is_empty() && extension.len() <= 16 && extension.chars().all(|c| c.is_ascii_alphanumeric());
  if approved.parent() != target.parent() || !valid_extension {
    return Err(SaveError::UnexpectedTarget);
  }
  Ok(Finalize::CreateOnly)
}

/// Percent-decode a header value encoded with `encodeURIComponent`.
pub fn decode_header(value: &str) -> Option<String> {
  let bytes = value.as_bytes();
  let mut out = Vec::with_capacity(bytes.len());
  let mut i = 0;
  while i < bytes.len() {
    if bytes[i] == b'%' {
      let hex = bytes.get(i + 1..i + 3)?;
      if !hex.iter().all(u8::is_ascii_hexdigit) {
        return None;
      }
      out.push(u8::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok()?);
      i += 3;
    } else {
      out.push(bytes[i]);
      i += 1;
    }
  }
  String::from_utf8(out).ok()
}

fn header_path(request: &Request<'_>, name: &str) -> Result<PathBuf, SaveError> {
  let value = request.headers().get(name).and_then(|v| v.to_str().ok()).ok_or(SaveError::BadRequest)?;
  decode_header(value).filter(|p| !p.is_empty()).map(PathBuf::from).ok_or(SaveError::BadRequest)
}

#[tauri::command]
pub async fn save_file_atomically<R: Runtime>(app: AppHandle<R>, request: Request<'_>) -> Result<(), String> {
  let approved = header_path(&request, "approved-path").map_err(|e| e.to_string())?;
  let target = header_path(&request, "target-path").map_err(|e| e.to_string())?;
  if !app.fs_scope().is_allowed(&approved) {
    return Err(SaveError::NotApproved.to_string());
  }
  let mode = finalize_mode(&approved, &target).map_err(|e| e.to_string())?;
  let bytes = match request.body() {
    InvokeBody::Raw(data) => data.clone(),
    _ => return Err(SaveError::BadRequest.to_string()),
  };
  tauri::async_runtime::spawn_blocking(move || write_atomically(&target, &bytes, mode))
    .await
    .map_err(|_| SaveError::Finalize("the save task stopped".into()).to_string())?
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_dir(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("seaglass-atomic-{label}-{}-{}", std::process::id(), STAGING_COUNTER.fetch_add(1, Ordering::Relaxed)));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  fn leftovers(dir: &Path) -> Vec<String> {
    fs::read_dir(dir).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.ends_with(".sgsave")).collect()
  }

  #[test]
  fn creates_a_new_file() {
    let dir = temp_dir("new");
    let target = dir.join("Art.seaglass");
    write_atomically(&target, b"new", Finalize::Replace).unwrap();
    assert_eq!(fs::read(&target).unwrap(), b"new");
    assert!(leftovers(&dir).is_empty());
  }

  #[test]
  fn overwrites_an_approved_existing_file() {
    let dir = temp_dir("overwrite");
    let target = dir.join("Art.seaglass");
    fs::write(&target, b"old").unwrap();
    write_atomically(&target, b"replacement", Finalize::Replace).unwrap();
    assert_eq!(fs::read(&target).unwrap(), b"replacement");
    assert!(leftovers(&dir).is_empty());
  }

  #[test]
  fn keeps_the_original_when_finalization_fails() {
    let dir = temp_dir("finalize");
    let target = dir.join("Art.seaglass");
    fs::write(&target, b"original").unwrap();
    let result = write_with(&target, b"partial", |_, _| Err(io::Error::other("injected")));
    assert!(matches!(result, Err(SaveError::Finalize(_))));
    assert_eq!(fs::read(&target).unwrap(), b"original");
    assert!(leftovers(&dir).is_empty());
  }

  #[test]
  fn keeps_the_original_when_staging_fails() {
    let dir = temp_dir("stage");
    let target = dir.join("missing-folder").join("Art.seaglass");
    let result = write_atomically(&target, b"data", Finalize::Replace);
    assert!(matches!(result, Err(SaveError::Stage(_))));
    assert!(!target.exists());
  }

  #[test]
  fn leaves_a_read_only_destination_unchanged() {
    let dir = temp_dir("readonly");
    let target = dir.join("Art.seaglass");
    fs::write(&target, b"protected").unwrap();
    let mut permissions = fs::metadata(&target).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&target, permissions.clone()).unwrap();
    let result = write_atomically(&target, b"new", Finalize::Replace);
    assert!(matches!(result, Err(SaveError::Finalize(_))), "{result:?}");
    assert_eq!(fs::read(&target).unwrap(), b"protected");
    assert!(leftovers(&dir).is_empty());
    #[allow(clippy::permissions_set_readonly_false)]
    permissions.set_readonly(false);
    fs::set_permissions(&target, permissions).unwrap();
  }

  #[cfg(windows)]
  #[test]
  fn leaves_a_locked_destination_unchanged() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = temp_dir("locked");
    let target = dir.join("Art.seaglass");
    fs::write(&target, b"in use").unwrap();
    // Another program holds the file open without sharing delete or write access.
    let lock = OpenOptions::new().read(true).share_mode(1 /* FILE_SHARE_READ */).open(&target).unwrap();
    let result = write_atomically(&target, b"new", Finalize::Replace);
    drop(lock);
    assert!(matches!(result, Err(SaveError::Finalize(_))), "{result:?}");
    assert_eq!(fs::read(&target).unwrap(), b"in use");
    assert!(leftovers(&dir).is_empty());
  }

  #[test]
  fn refuses_to_overwrite_when_only_an_extension_was_appended() {
    let dir = temp_dir("create-only");
    let target = dir.join("Art.seaglass");
    fs::write(&target, b"someone else's file").unwrap();
    let result = write_atomically(&target, b"new", Finalize::CreateOnly);
    assert_eq!(result, Err(SaveError::OverwriteUnconfirmed("Art.seaglass".into())));
    assert_eq!(fs::read(&target).unwrap(), b"someone else's file");
    assert!(leftovers(&dir).is_empty());
    let fresh = dir.join("Fresh.seaglass");
    write_atomically(&fresh, b"new", Finalize::CreateOnly).unwrap();
    assert_eq!(fs::read(&fresh).unwrap(), b"new");
    assert!(leftovers(&dir).is_empty());
  }

  #[test]
  fn accepts_only_the_approved_path_or_an_appended_extension() {
    let approved = Path::new(r"C:\Art\Sketch");
    assert_eq!(finalize_mode(approved, approved), Ok(Finalize::Replace));
    assert_eq!(finalize_mode(approved, Path::new(r"C:\Art\Sketch.seaglass")), Ok(Finalize::CreateOnly));
    assert_eq!(finalize_mode(approved, Path::new(r"C:\Other\Sketch.seaglass")), Err(SaveError::UnexpectedTarget));
    assert_eq!(finalize_mode(approved, Path::new(r"C:\Art\Sketchy.seaglass")), Err(SaveError::UnexpectedTarget));
    assert_eq!(finalize_mode(approved, Path::new(r"C:\Art\Sketch.sea glass")), Err(SaveError::UnexpectedTarget));
    assert_eq!(finalize_mode(approved, Path::new(r"C:\Art\Sketch.seaglass\..\x")), Err(SaveError::UnexpectedTarget));
  }

  #[test]
  fn decodes_uri_component_headers() {
    assert_eq!(decode_header("C%3A%5CArt%5CSea%20Glass%20%C3%A9.seaglass").as_deref(), Some("C:\\Art\\Sea Glass é.seaglass"));
    assert_eq!(decode_header("bad%2"), None);
    assert_eq!(decode_header("bad%+1"), None);
  }

  #[test]
  fn fallback_without_hard_links_never_overwrites_another_file() {
    let dir = temp_dir("fallback");
    let no_links = |_: &Path, _: &Path| Err(io::Error::new(io::ErrorKind::Unsupported, "no hard links"));
    // A file that appeared after the dialog closed must survive.
    let taken = dir.join("Taken.seaglass");
    fs::write(&taken, b"someone else's").unwrap();
    let result = write_with(&taken, b"new", |s, t| finalize_create_only_with(s, t, no_links));
    assert_eq!(result, Err(SaveError::OverwriteUnconfirmed("Taken.seaglass".into())));
    assert_eq!(fs::read(&taken).unwrap(), b"someone else's");
    // A free name is written through the reserved placeholder.
    let free = dir.join("Free.seaglass");
    write_with(&free, b"new", |s, t| finalize_create_only_with(s, t, no_links)).unwrap();
    assert_eq!(fs::read(&free).unwrap(), b"new");
    assert!(leftovers(&dir).is_empty());
  }
}
