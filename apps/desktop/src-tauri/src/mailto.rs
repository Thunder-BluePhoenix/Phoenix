// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! `open_mailto`: the web page asks the shell to open the user's mail app with a draft. The shell
//! never sends mail and holds no mail credentials; it only checks that what it is about to hand
//! to the operating system really is a `mailto:` link, so a compromised page cannot use this
//! command to open `file:`, `javascript:` or an arbitrary program's URL scheme.

use serde::Serialize;

/// Longest accepted URL, in characters (the web page builds URLs of at most 1900).
pub const MAX_MAILTO_CHARS: usize = 2000;
const SCHEME: &str = "mailto:";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MailtoError {
    NotMailto,
    TooLong,
    ControlCharacters,
}

impl MailtoError {
    pub fn message(self) -> &'static str {
        match self {
            MailtoError::NotMailto => "Only mailto: links can be opened.",
            MailtoError::TooLong => "That mail link is too long.",
            MailtoError::ControlCharacters => "That mail link contains control characters.",
        }
    }
}

/// Is `url` safe to hand to the mail app? The scheme must be exactly lowercase `mailto:`
/// (no leading space, no other case, no `mailto://`-style tricks are special-cased because
/// `mailto://x` is still just a mailto link), the URL at most `MAX_MAILTO_CHARS` characters,
/// and free of control characters (C0, DEL, C1, line and paragraph separators) and of
/// the bidirectional-override and zero-width characters that can disguise an address.
pub fn validate(url: &str) -> Result<(), MailtoError> {
    if !url.starts_with(SCHEME) {
        return Err(MailtoError::NotMailto);
    }
    if url.chars().count() > MAX_MAILTO_CHARS {
        return Err(MailtoError::TooLong);
    }
    if url.chars().any(is_forbidden) {
        return Err(MailtoError::ControlCharacters);
    }
    Ok(())
}

fn is_forbidden(c: char) -> bool {
    c.is_control()
        || matches!(
            c,
            '\u{200B}'..='\u{200F}'
                | '\u{2028}'..='\u{202E}'
                | '\u{2060}'
                | '\u{2066}'..='\u{2069}'
                | '\u{FEFF}'
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_plain_draft() {
        assert_eq!(validate("mailto:"), Ok(()));
        assert_eq!(validate("mailto:ada@example.org"), Ok(()));
        assert_eq!(
            validate("mailto:?subject=About%3A%20notes.txt&body=Hello%0AWorld"),
            Ok(())
        );
        // A non-ASCII but harmless subject is fine.
        assert_eq!(validate("mailto:?subject=caf\u{e9}"), Ok(()));
    }

    #[test]
    fn rejects_every_other_scheme() {
        for url in [
            "",
            "http://example.org",
            "https://example.org/mailto:",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,hi",
            "tel:+10000000",
            "x-apple.systempreferences:com.apple.preference.security",
            "ssh://host",
            "mailto",
            "//mailto:a@b.c",
        ] {
            assert_eq!(validate(url), Err(MailtoError::NotMailto), "{url:?}");
        }
    }

    #[test]
    fn the_scheme_must_be_exactly_lowercase_and_at_the_start() {
        for url in [
            "MAILTO:a@b.c",
            "Mailto:a@b.c",
            " mailto:a@b.c",
            "\tmailto:a@b.c",
            "\nmailto:a@b.c",
            "xmailto:a@b.c",
        ] {
            assert_eq!(validate(url), Err(MailtoError::NotMailto), "{url:?}");
        }
    }

    #[test]
    fn the_length_cap_is_inclusive_and_counts_characters() {
        let at_cap = format!("mailto:{}", "a".repeat(MAX_MAILTO_CHARS - SCHEME.len()));
        assert_eq!(at_cap.chars().count(), MAX_MAILTO_CHARS);
        assert_eq!(validate(&at_cap), Ok(()));
        let over = format!("{at_cap}a");
        assert_eq!(validate(&over), Err(MailtoError::TooLong));
        // Multi-byte characters count once: 1999 two-byte characters plus the scheme fit...
        let wide = format!(
            "mailto:{}",
            "\u{e9}".repeat(MAX_MAILTO_CHARS - SCHEME.len())
        );
        assert!(wide.len() > MAX_MAILTO_CHARS);
        assert_eq!(validate(&wide), Ok(()));
        // ...and one more does not.
        assert_eq!(
            validate(&format!("{wide}\u{e9}")),
            Err(MailtoError::TooLong)
        );
    }

    #[test]
    fn control_characters_are_rejected_wherever_they_are() {
        for bad in [
            "mailto:a@b.c\n",
            "mailto:a@b.c\r\nBcc: x@y.z",
            "mailto:a\u{0}@b.c",
            "mailto:a@b.c\u{7f}",
            "mailto:\u{1b}[31m",
            "mailto:\tx",
            "mailto:a@b.c\u{85}",
            "mailto:a@b.c\u{9f}",
            "mailto:a@b.c\u{2028}",
        ] {
            assert_eq!(
                validate(bad),
                Err(MailtoError::ControlCharacters),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn bidi_and_zero_width_characters_are_rejected() {
        for c in [
            '\u{200B}', '\u{200C}', '\u{200D}', '\u{200E}', '\u{200F}', '\u{202A}', '\u{202B}',
            '\u{202C}', '\u{202D}', '\u{202E}', '\u{2060}', '\u{2066}', '\u{2067}', '\u{2068}',
            '\u{2069}', '\u{FEFF}',
        ] {
            let url = format!("mailto:ada{c}@example.org");
            assert_eq!(validate(&url), Err(MailtoError::ControlCharacters), "{c:?}");
        }
    }

    #[test]
    fn errors_have_human_messages() {
        for e in [
            MailtoError::NotMailto,
            MailtoError::TooLong,
            MailtoError::ControlCharacters,
        ] {
            assert!(e.message().ends_with('.'));
        }
        assert_eq!(
            serde_json::to_string(&MailtoError::NotMailto).unwrap(),
            "\"not_mailto\""
        );
    }
}
