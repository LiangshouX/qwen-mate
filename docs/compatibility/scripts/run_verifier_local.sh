#!/usr/bin/env bash
# 本地复跑 IntelliJ Plugin Verifier（不需要 JetBrains 账号、不依赖 Gradle 解析 IDE）
#
# 用法:
#   bash scripts/run_verifier_local.sh <plugin.zip> <ide-dir> [更多 ide-dir...]
#
# 例:
#   bash scripts/run_verifier_local.sh \
#     ../../build/distributions/qwen-mate-1.1.1.zip \
#     /path/to/ideaIU-233.15619.7 \
#     "/path/to/IntelliJ IDEA 2026.1.4"
#
# 设计要点（都是踩过坑换来的）：
#   1. IDE 直接吃本地目录 —— 可以是已安装的 IDE，也可以是从 Gradle 缓存里解压出来的 zip。
#      不走 Gradle 的坐标解析，因此不受 JetBrains CDN 抽风影响。
#   2. 必须加 -offline —— 否则 verifier 会去 Marketplace 查插件依赖，网络不通时整条命令挂死
#      （表现为 CPU 占用为 0、只有 Established 的 TLS 连接）。
#   3. verifier CLI 从 packages.jetbrains.team 下载，实测可达（与 JetBrains IDE 的 CDN 不同源）。
#
# 环境变量:
#   VERIFIER_VERSION  默认 1.411
#   VERIFIER_WORK     默认 <脚本所在目录>/../.verifier-work
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "用法: bash $0 <plugin.zip> <ide-dir> [更多 ide-dir...]" >&2
  exit 2
fi

PLUGIN="$1"; shift
VERIFIER_VERSION="${VERIFIER_VERSION:-1.411}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${VERIFIER_WORK:-$SCRIPT_DIR/../.verifier-work}"
JAR="$WORK/verifier-cli-all.jar"
REPORTS="$WORK/reports"

mkdir -p "$WORK" "$REPORTS"

if [ ! -f "$JAR" ]; then
  echo "[1/3] 下载 Plugin Verifier CLI ${VERIFIER_VERSION} ..."
  curl -sS -L --retry 5 --retry-all-errors -o "$JAR" \
    "https://packages.jetbrains.team/maven/p/intellij-plugin-verifier/intellij-plugin-verifier/org/jetbrains/intellij/plugins/verifier-cli/${VERIFIER_VERSION}/verifier-cli-${VERIFIER_VERSION}-all.jar"
fi

if [ ! -f "$PLUGIN" ]; then
  echo "找不到插件包: $PLUGIN" >&2
  echo "先构建: ./gradlew.bat buildPlugin -PskipWebview=true" >&2
  exit 1
fi

echo "[2/3] 验证: $PLUGIN"
echo "      IDE: $*"

# JAVA_HOME 优先；否则用 PATH 里的 java（Git Bash 下会自动补 .exe）
if [ -n "${JAVA_HOME:-}" ]; then
  JAVA_BIN="$JAVA_HOME/bin/java"
else
  JAVA_BIN="java"
fi

"$JAVA_BIN" -jar "$JAR" check-plugin \
  "$PLUGIN" "$@" \
  -offline \
  -verification-reports-dir "$REPORTS" \
  -verification-reports-formats plain,html,markdown

echo
echo "[3/3] 完成。报告目录: $REPORTS"
find "$REPORTS" -name 'verification-verdict.txt' -exec sh -c 'echo "--- {}"; cat {}' \;
