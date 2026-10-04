#!/bin/sh
# The eval runner gives scaffold scripts a bare environment (case execution.env is not passed), so settings live here.
export EVAL_USE='creator, watchlist'
export EVAL_SEED='[{"url":"http://127.0.0.1:8790/fixtures/anime.html","note":null}]'
exec sh "$(dirname "$0")/../scaffold.sh"
