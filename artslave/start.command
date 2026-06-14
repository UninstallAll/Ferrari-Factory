#!/usr/bin/env bash
# =====================================================================
# ArtSlave 一键控制台  (macOS)
# ---------------------------------------------------------------------
# 用法：
#   · 在 Finder 里【双击本文件】           → 干净重启全部服务（最常用）
#   · 终端： ./start.command [动作]
#        start    只启动（不杀旧进程）
#        stop     停止全部服务
#        restart  先停后启（=双击效果，默认）
#        status   查看各端口运行状态
#        logs     实时跟踪日志
#   · 跳过 n8n：  WITH_N8N=0 ./start.command
#
# 管理的三个后台服务：
#   1) Next.js 前端      http://localhost:3000
#   2) fake-llm 本地LLM  http://localhost:8787   (模式读 .env 的 FAKE_LLM_MODE)
#   3) n8n 工作流引擎    http://localhost:5678
# =====================================================================
set -uo pipefail

# ---- 定位项目目录（双击时工作目录不是脚本目录，必须用 BASH_SOURCE）----
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR" || { echo "找不到项目目录"; exit 1; }

# ---- 确保能找到 node/npm（Finder 双击时 PATH 很精简，必须显式加入）----
export PATH="/Users/liushuai/.local/node/node-v22.22.3-darwin-x64/bin:$PATH"
if ! command -v npm >/dev/null 2>&1; then
  echo "❌ 找不到 npm。请确认 node 路径，或改本脚本顶部的 PATH。"; exit 1
fi

LOG_DIR="$DIR/logs"
mkdir -p "$LOG_DIR"

# ---- 从 .env 读取配置（去掉引号）----
get_env() { grep -E "^$1=" "$DIR/.env" 2>/dev/null | head -1 | sed -E 's/^[^=]+=//; s/^["'\'']//; s/["'\'']$//'; }
NEXT_PORT=3000
FAKE_PORT="$(get_env FAKE_LLM_PORT)"; FAKE_PORT="${FAKE_PORT:-8787}"
FAKE_MODE="$(get_env FAKE_LLM_MODE)"; FAKE_MODE="${FAKE_MODE:-mock}"
N8N_PORT="$(get_env N8N_PORT)";       N8N_PORT="${N8N_PORT:-5678}"
WITH_N8N="${WITH_N8N:-1}"   # 设 WITH_N8N=0 跳过 n8n

free_port() {  # 释放某端口上的监听进程
  local p="$1" pids
  pids="$(lsof -nP -iTCP:"$p" -sTCP:LISTEN -t 2>/dev/null)"
  if [ -n "$pids" ]; then kill $pids 2>/dev/null; sleep 1; fi
  pids="$(lsof -nP -iTCP:"$p" -sTCP:LISTEN -t 2>/dev/null)"
  if [ -n "$pids" ]; then kill -9 $pids 2>/dev/null; fi
}

stop_all() {
  echo "⏹  停止旧服务..."
  pkill -f "$DIR/node_modules/.bin/next dev" 2>/dev/null
  pkill -f "fake-llm.js" 2>/dev/null
  pkill -f "n8n start"   2>/dev/null
  for p in "$NEXT_PORT" 3001 3002 "$FAKE_PORT" "$N8N_PORT"; do free_port "$p"; done
  sleep 1
  echo "   已清理。"
}

wait_port() {  # $1=端口 $2=名称 $3=超时秒
  local p="$1" label="$2" t="${3:-30}" i=0
  while [ "$i" -lt "$t" ]; do
    if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "   ✓ $label  →  http://localhost:$p"; return 0
    fi
    sleep 1; i=$((i+1))
  done
  echo "   ⏳ $label 尚未就绪（看 logs/，端口 $p）"; return 1
}

start_all() {
  echo "▶️  启动服务（日志写入 logs/）..."
  nohup npm run dev > "$LOG_DIR/next.log" 2>&1 &
  FAKE_LLM_MODE="$FAKE_MODE" FAKE_LLM_PORT="$FAKE_PORT" \
    nohup npm run fake-llm > "$LOG_DIR/fake-llm.log" 2>&1 &
  if [ "$WITH_N8N" = "1" ]; then
    nohup npm run n8n:start > "$LOG_DIR/n8n.log" 2>&1 &
  else
    echo "   （已跳过 n8n）"
  fi
  echo
  echo "🔎 健康检查（首次编译/下载较慢，请耐心）："
  wait_port "$NEXT_PORT" "Next.js 前端" 40 || wait_port 3001 "Next.js 前端(备用端口)" 5
  wait_port "$FAKE_PORT" "fake-llm[$FAKE_MODE 模式]" 20
  [ "$WITH_N8N" = "1" ] && wait_port "$N8N_PORT" "n8n 工作流" 90
}

status() {
  echo "📊 端口状态："
  for entry in "$NEXT_PORT:Next.js 前端" "3001:Next.js(备用)" "$FAKE_PORT:fake-llm" "$N8N_PORT:n8n 工作流"; do
    p="${entry%%:*}"; name="${entry#*:}"
    if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "   ✅ $name  (:$p)  http://localhost:$p"
    else
      echo "   ⬜ $name  (:$p)  未运行"
    fi
  done
}

ACTION="${1:-restart}"
echo "════════ ArtSlave 控制台  ▸ $ACTION ════════"
case "$ACTION" in
  start)   start_all ;;
  stop)    stop_all ;;
  restart) stop_all; start_all ;;
  status)  status ;;
  logs)    echo "（Ctrl+C 退出日志跟踪）"; tail -n 40 -F "$LOG_DIR"/*.log ;;
  *) echo "用法: ./start.command [start|stop|restart|status|logs]"; exit 1 ;;
esac

if [ "$ACTION" = "start" ] || [ "$ACTION" = "restart" ]; then
  echo
  status
  echo
  echo "🌐 前端 http://localhost:$NEXT_PORT   ·   n8n http://localhost:$N8N_PORT   ·   fake-llm :$FAKE_PORT"
  echo "📜 日志目录： $LOG_DIR"
fi

# 双击运行（无参数）时，跑完保持窗口别立刻关
if [ $# -eq 0 ]; then
  echo
  read -r -p "按回车键关闭此窗口..." _ 2>/dev/null || true
fi
