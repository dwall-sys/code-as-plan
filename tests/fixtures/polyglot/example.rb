# @cap-feature(feature:F-046) Ruby polyglot fixture covering # line + =begin/=end block.
# @cap-risk Ruby has heredocs and percent-strings which we do NOT classify as comments.

=begin
@cap-todo(ac:F-046/AC-1) Ruby block comment via begin/end markers.
@cap-decision Multi-line block content is recognized across multiple lines.
=end

def authenticate(user, password)
  # @cap-todo(ac:F-046/AC-1) Ruby line comment.
  return false if user.nil?
  true
end
