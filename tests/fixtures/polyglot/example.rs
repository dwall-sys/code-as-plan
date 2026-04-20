// @cap-feature(feature:F-046) Rust polyglot fixture covering //, ///, and /* */ comment styles.
// @cap-decision Rust /// doc-comments must be matched before // so we list /// first in the COMMENT_STYLES table.

/// @cap-todo(ac:F-046/AC-1) Rust /// doc-comment recognized as a line comment variant.
fn authenticate(user: &str) -> bool {
    /* @cap-risk Rust block comments can nest; the scanner does NOT track nesting depth — it closes on the first */ */
    if user.is_empty() {
        return false;
    }
    true
}

/* @cap-decision Inline single-line block-comment variant also recognized. */
fn main() {
    println!("{}", authenticate("alice"));
}
