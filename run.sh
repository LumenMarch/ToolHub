#!/bin/bash
cleanup() {
  echo "Shutting down..."
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
  wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

echo "Starting backend..."
cd backend
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

echo "Starting frontend..."
cd ../frontend
bun run dev &
FRONTEND_PID=$!

echo "Both services started."
echo "Backend: http://localhost:8000"
echo "Frontend: http://localhost:5173"

wait
