#!/bin/bash
# 使用包内运行时；不修改系统 PATH，也不自动下载模型。
set -eu
cd "$(dirname "$0")"
studio_node=""
for candidate in "$PWD"/runtime/node-*-darwin-*/bin/node; do
  if [ -x "$candidate" ]; then studio_node="$candidate"; break; fi
done
if [ -z "$studio_node" ]; then
  studio_node="$(command -v node || true)"
fi
if [ -z "$studio_node" ]; then
  echo '找不到运行时，请完整解压 Mac 下载包后再打开。'
  read -r -p '按回车关闭…' _
  exit 1
fi
exec "$studio_node" --env-file-if-exists=.env scripts/macos/start-macos.mjs "$@"
