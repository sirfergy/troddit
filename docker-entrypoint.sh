#!/bin/sh

# Start Copilot CLI in server mode in the background
echo "Starting Copilot CLI server on port ${COPILOT_CLI_PORT:-4321}..."
copilot --server --port ${COPILOT_CLI_PORT:-4321} &
COPILOT_PID=$!

# Give it a moment to start
sleep 2

# Check if Copilot CLI started successfully
if kill -0 $COPILOT_PID 2>/dev/null; then
    echo "Copilot CLI server started successfully (PID: $COPILOT_PID)"
else
    echo "Warning: Copilot CLI server failed to start, continuing without it..."
fi

# Start Next.js server in the foreground
echo "Starting Next.js server on port ${PORT:-3000}..."
exec node server.js
