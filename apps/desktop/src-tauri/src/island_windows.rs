// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Windows-only: the island must never take focus from the app being typed in. Tauri's
//! `focusable(false)` already sets `WS_EX_NOACTIVATE` at creation; this re-applies the full
//! extended style (no activation, tool window, topmost) on the live handle so the choice does
//! not depend on that one builder flag. The style bits come from `island_platform`.
//!
//! Compiled only on Windows. Not run on Windows by the author; CI builds it.

use crate::island_platform::windows_ex_style;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE};

pub fn apply_no_activate(hwnd: HWND) {
    // SAFETY: `hwnd` is the live handle of the island window, owned by Tauri; these calls only
    // read and write that window's extended style word.
    unsafe {
        let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, windows_ex_style(current) as isize);
    }
}
