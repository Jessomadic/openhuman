//! Cached cell-wrapped blocks and indexed viewport lookup.
use super::state::{EntryKind, TranscriptState};
use super::theme::safe_text;
use unicode_width::UnicodeWidthChar;

#[derive(Default)]
pub struct ViewportCache {
    width: u16,
    blocks: Vec<CachedBlock>,
    ends: Vec<usize>,
}
struct CachedBlock {
    revision: u64,
    height: usize,
    rows: Vec<String>,
}

#[derive(Clone)]
pub struct VisibleRow {
    pub text: String,
    pub entry: usize,
    pub first: bool,
    pub kind: EntryKind,
}

impl ViewportCache {
    pub fn rows(
        &mut self,
        state: &TranscriptState,
        width: u16,
        height: u16,
        offset: usize,
    ) -> (Vec<VisibleRow>, usize) {
        let width = width.max(1);
        if self.width != width {
            self.blocks.clear();
            self.width = width;
        }
        self.blocks.truncate(state.entries().len());
        self.ends.clear();
        let mut total = 0usize;
        for (index, entry) in state.entries().iter().enumerate() {
            let fresh = self
                .blocks
                .get(index)
                .is_none_or(|block| block.revision != entry.revision);
            if fresh {
                let rows = entry_rows(entry, width);
                let block = CachedBlock {
                    revision: entry.revision,
                    height: rows.len(),
                    rows,
                };
                if index == self.blocks.len() {
                    self.blocks.push(block);
                } else {
                    self.blocks[index] = block;
                }
            }
            total += self.blocks[index].height;
            self.ends.push(total);
        }
        let max_scroll = total.saturating_sub(height as usize);
        let top = max_scroll.saturating_sub(offset.min(max_scroll));
        let mut index = self.ends.partition_point(|end| *end <= top);
        let first_visible = index;
        let mut absolute = if index == 0 { 0 } else { self.ends[index - 1] };
        let mut rows = Vec::with_capacity(height as usize);
        while index < self.blocks.len() && rows.len() < height as usize {
            if self.blocks[index].rows.is_empty() {
                self.blocks[index].rows = entry_rows(&state.entries()[index], width);
            }
            for (line, text) in self.blocks[index].rows.iter().enumerate() {
                if absolute >= top && rows.len() < height as usize {
                    rows.push(VisibleRow {
                        text: text.clone(),
                        entry: index,
                        first: line == 0,
                        kind: state.entries()[index].kind,
                    });
                }
                absolute += 1;
            }
            index += 1;
        }
        for (index, block) in self.blocks.iter_mut().enumerate() {
            if index < first_visible.saturating_sub(64) || index > first_visible + 128 {
                block.rows.clear();
                block.rows.shrink_to_fit();
            }
        }
        (rows, max_scroll)
    }
    pub fn total_rows(&self) -> usize {
        self.ends.last().copied().unwrap_or(0)
    }
}

fn entry_rows(entry: &super::state::Entry, width: u16) -> Vec<String> {
    let text = if entry.kind == EntryKind::Thinking && !entry.expanded {
        "Reasoning · click to expand".to_string()
    } else if let Some(activity) = &entry.activity {
        if entry.expanded {
            format!(
                "{}\n{}",
                activity.summary(),
                activity
                    .details()
                    .lines()
                    .take(20)
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        } else {
            activity.summary()
        }
    } else {
        entry.text.clone()
    };
    let mut rows = wrap_cells(&safe_text(&text), width as usize);
    if matches!(entry.kind, EntryKind::User | EntryKind::Assistant) {
        rows.insert(
            0,
            if entry.kind == EntryKind::User {
                "You".into()
            } else {
                "OpenHuman".into()
            },
        );
    }
    if entry.activity.is_some() && entry.expanded {
        rows.push("[Open /tools for stored output details]".into());
    }
    rows.push(String::new());
    rows
}

/// Wrap by terminal cells without splitting UTF-8 or counting combining marks.
pub fn wrap_cells(value: &str, width: usize) -> Vec<String> {
    let width = width.max(1);
    let mut rows = vec![String::new()];
    let mut used = 0;
    for ch in value.chars() {
        if ch == '\n' {
            rows.push(String::new());
            used = 0;
            continue;
        }
        let cells = ch.width().unwrap_or(0);
        if cells > 0 && used + cells > width && used > 0 {
            rows.push(String::new());
            used = 0;
        }
        rows.last_mut().unwrap().push(ch);
        used += cells;
    }
    rows
}

#[cfg(test)]
#[path = "viewport_tests.rs"]
mod tests;
