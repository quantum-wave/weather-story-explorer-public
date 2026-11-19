[ -f "$ROOT/out/manifest.json" ]; check "manifest present" $? "missing"
! grep -qi synthetic "$ROOT/out/manifest.json"; check "not synthetic" $? "found"
# a comment may say never /tmp or GUIDE.md
