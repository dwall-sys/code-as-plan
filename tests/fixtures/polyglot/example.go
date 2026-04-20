// @cap-feature(feature:F-046) Go polyglot fixture covering // line + /* */ block.
// @cap-decision Go uses the same comment syntax as JS/TS, so the existing parser works unchanged.

package main

/*
 * @cap-todo(ac:F-046/AC-1) Go block-comment with star-prefixed lines.
 * @cap-risk Star-prefix continuation lines must still be recognized as inside the block.
 */

import "fmt"

// @cap-todo(ac:F-046/AC-1) Go line comment.
func authenticate(user string) bool {
	if user == "" {
		return false
	}
	return true
}

func main() {
	fmt.Println(authenticate("alice"))
}
