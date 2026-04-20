# @cap-feature(feature:F-046) String-literal exclusion fixture.
# Real comment above is a legitimate tag.

def fake_message():
    # The next line embeds the cap-feature marker INSIDE a string, not a comment.
    # The scanner must NOT extract it as a tag and SHOULD emit a warning.
    return "@cap-feature(feature:F-999) this is NOT a real tag"


def another_fake():
    msg = '@cap-todo(ac:F-999/AC-1) also not a real tag'
    return msg
