// @cap-feature(feature:F-046) JS string-comment fixture for AC-3.
// The annotation above is a real tag and SHOULD be extracted.
//
// The lines below embed comment-style tokens INSIDE string literals. After the AC-3 fix the
// scanner correctly classifies the embedded tokens as inside-string and emits warnings
// instead of extracting fake tags.

const x = "// @cap-feature(feature:F-999) fake-comment-in-string";

const y = "/* @cap-feature(feature:F-998) fake-block-in-string */";

const z = '// @cap-todo(ac:F-999/AC-1) fake-todo-in-single-quote';

const t = `// @cap-feature(feature:F-997) fake-in-template-literal`;
