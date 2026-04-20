# @cap-feature(feature:F-046) Python module exercising line + block comment styles.
# @cap-decision Triple-quote docstrings are treated as block comments by the scanner.

"""
@cap-todo(ac:F-046/AC-1) Python triple-quote docstrings are recognized as block comments.
@cap-risk Triple-quote can be ambiguous with raw strings — scanner errs on the side of treating them as comments.
"""


def authenticate(user, password):
    # @cap-todo(ac:F-046/AC-1) Python line comment with full @cap-todo metadata.
    if not user:
        return False
    return True


# @cap-decision Single-quote triple block also recognized.
'''
@cap-feature(feature:F-046) Single-quote triple-string block.
'''
