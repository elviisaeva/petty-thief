#!/bin/sh
# The eval runner gives scaffold scripts a bare environment (case execution.env is not passed), so settings live here.
export EVAL_PRESEED_WATCHLIST='yes'
exec sh "$(dirname "$0")/../scaffold.sh"
