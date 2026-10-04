#!/bin/sh
# The eval runner gives scaffold scripts a bare environment (case execution.env is not passed), so settings live here.
export EVAL_SEED='[{"url":"http://127.0.0.1:8790/fixtures/recipe.html","note":"#recipes"}]'
exec sh "$(dirname "$0")/../scaffold.sh"
